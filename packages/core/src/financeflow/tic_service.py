"""Separate TIC storage/API/CLI. Does not write IMF's position database."""
import argparse
import hashlib
import os
import sqlite3
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.request import Request as URLRequest, urlopen
from fastapi import APIRouter, HTTPException, Request, Response
from .source_tic import FlowSnapshot, SOURCE_URL, normalize

class FlowStore:
    def __init__(self, path):
        self.path = str(path)
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript('''CREATE TABLE IF NOT EXISTS snapshots(version TEXT PRIMARY KEY, period TEXT NOT NULL, payload TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS current(id INTEGER PRIMARY KEY CHECK(id=1), version TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS check_state(id INTEGER PRIMARY KEY CHECK(id=1), checked_at TEXT NOT NULL, error TEXT);''')

    def connect(self):
        return sqlite3.connect(self.path, timeout=30)

    def save(self, snapshot):
        with self.connect() as db:
            db.execute('INSERT OR REPLACE INTO snapshots VALUES (?,?,?)',
                       (snapshot.version, snapshot.period, snapshot.model_dump_json()))
            current = db.execute('SELECT s.period FROM snapshots s JOIN current c ON c.version=s.version').fetchone()
            if current and current[0] > snapshot.period:
                raise ValueError('Refusing to regress active TIC observation period')
            db.execute('INSERT OR REPLACE INTO current VALUES (1,?)', (snapshot.version,))
            db.execute('INSERT OR REPLACE INTO check_state VALUES (1,?,NULL)', (snapshot.retrieved_at.isoformat(),))

    def fail(self, checked_at, error):
        with self.connect() as db:
            db.execute('INSERT OR REPLACE INTO check_state VALUES (1,?,?)', (checked_at, error))

    def latest(self):
        with self.connect() as db:
            row = db.execute('SELECT s.payload FROM snapshots s JOIN current c ON s.version=c.version').fetchone()
        return FlowSnapshot.model_validate_json(row[0]) if row else None

    def status(self, now=None):
        now = now or datetime.now(timezone.utc)
        with self.connect() as db:
            row = db.execute('SELECT checked_at,error FROM check_state WHERE id=1').fetchone()
        if not row:
            return {'state':'unavailable', 'last_checked_at':None, 'error':None}
        old = now - datetime.fromisoformat(row[0]) > timedelta(hours=48)
        return {'state':'stale' if row[1] or old else 'available', 'last_checked_at':row[0], 'error':row[1]}


def router(data_dir=None):
    store = FlowStore(Path(data_dir or os.getenv('FFA_DATA_DIR', 'var')) / 'tic.sqlite')
    api = APIRouter()

    @api.get('/api/v1/flows/tic/status')
    def status():
        return store.status()

    @api.get('/api/v1/flows/tic', response_model=FlowSnapshot)
    def snapshot(request:Request, response:Response):
        result = store.latest()
        if result is None:
            raise HTTPException(503, detail='No validated TIC equity transaction snapshot. Run TIC ingestion first.')
        state = store.status()['state']
        # Include state in cache validator so a freshness transition is never hidden by 304.
        identity = result.version + ':' + result.retrieved_at.isoformat() + ':' + state
        etag = '"' + hashlib.sha256(identity.encode()).hexdigest()[:32] + '"'
        headers = {'ETag':etag, 'Cache-Control':'no-cache', 'X-Data-Status':state}
        if state != 'available':
            headers['Warning'] = '110 - "Last validated TIC snapshot; source check is stale or failed"'
        if request.headers.get('if-none-match') == etag:
            return Response(status_code=304, headers=headers)
        response.headers.update(headers)
        return result
    return api


def main():
    parser = argparse.ArgumentParser(description='Ingest delayed monthly TIC equity net transactions, separately from IMF holdings')
    parser.add_argument('--period', required=True, help='YYYY-MM, 2023-02 or later')
    parser.add_argument('--data-dir', default=os.getenv('FFA_DATA_DIR', 'var'))
    args = parser.parse_args()
    store = FlowStore(Path(args.data_dir) / 'tic.sqlite')
    now = datetime.now(timezone.utc).isoformat()
    try:
        request = URLRequest(SOURCE_URL, headers={'User-Agent':'FinanceFlowAtlas/0.2 (public statistical data)'})
        with urlopen(request, timeout=60) as response:
            raw = response.read(10_000_001)
        if len(raw) > 10_000_000:
            raise ValueError('TIC response exceeds size limit')
        snapshot = normalize(raw, args.period, now)
        archive = Path(args.data_dir) / 'raw' / 'tic'
        archive.mkdir(parents=True, exist_ok=True)
        (archive / (hashlib.sha256(raw).hexdigest() + '.txt')).write_bytes(raw)
        store.save(snapshot)
    except Exception as error:
        store.fail(now, type(error).__name__ + ': ' + str(error))
        raise
    print(f'TIC {snapshot.period}: {len(snapshot.country_flows)} country observations, version {snapshot.version}; monthly, not live')

if __name__ == '__main__':
    main()
