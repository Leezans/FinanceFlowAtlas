"""Explicit BOP ingestion and read-only country-flow API; no network calls on GET."""
import argparse
import hashlib
import os
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal
from urllib.request import Request as URLRequest, build_opener, HTTPRedirectHandler

from fastapi import APIRouter, HTTPException, Request, Response
from .source_bop import BopSnapshot, MAX_BYTES, UnitEvidence, normalize, source_url


class BopStore:
    def __init__(self, path):
        self.path = str(path)
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS bop_snapshots(version TEXT PRIMARY KEY, payload TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS bop_current(period TEXT, indicator TEXT, version TEXT NOT NULL,
                    PRIMARY KEY(period,indicator));
                CREATE TABLE IF NOT EXISTS bop_checks(period TEXT, indicator TEXT, checked_at TEXT NOT NULL,
                    error TEXT, PRIMARY KEY(period,indicator));
            ''')

    def connect(self):
        return sqlite3.connect(self.path, timeout=30)

    def save(self, snapshot):
        snapshot = BopSnapshot.model_validate(snapshot.model_dump())
        with self.connect() as db:
            # Reserve the writer before reading prior metadata, making comparison and publication atomic.
            db.execute('BEGIN IMMEDIATE')
            prior = db.execute('SELECT s.payload FROM bop_snapshots s JOIN bop_current c ON s.version=c.version '
                'WHERE c.period=? AND c.indicator=?', (snapshot.period, snapshot.indicator)).fetchone()
            if prior:
                previous = BopSnapshot.model_validate_json(prior[0])
                for field in ('retrieved_at', 'dataset_updated_at'):
                    old, new = getattr(previous, field), getattr(snapshot, field)
                    if old and (not new or datetime.fromisoformat(new) < datetime.fromisoformat(old)):
                        raise ValueError('Refusing to regress BOP revision metadata')
            db.execute('INSERT OR REPLACE INTO bop_snapshots VALUES (?,?)', (snapshot.version, snapshot.model_dump_json()))
            db.execute('INSERT OR REPLACE INTO bop_current VALUES (?,?,?)',
                (snapshot.period, snapshot.indicator, snapshot.version))
            db.execute('INSERT OR REPLACE INTO bop_checks VALUES (?,?,?,NULL)',
                (snapshot.period, snapshot.indicator, snapshot.retrieved_at))

    def fail(self, period, indicator, checked_at, error):
        with self.connect() as db:
            db.execute('INSERT OR REPLACE INTO bop_checks VALUES (?,?,?,?)', (period, indicator, checked_at, error))

    def get(self, period, indicator):
        with self.connect() as db:
            row = db.execute('SELECT s.payload FROM bop_snapshots s JOIN bop_current c ON s.version=c.version '
                'WHERE c.period=? AND c.indicator=?', (period, indicator)).fetchone()
        return BopSnapshot.model_validate_json(row[0]) if row else None

    def status(self, period, indicator, now=None):
        snapshot = self.get(period, indicator)
        with self.connect() as db:
            row = db.execute('SELECT checked_at,error FROM bop_checks WHERE period=? AND indicator=?',
                (period, indicator)).fetchone()
        state = 'unavailable'
        if snapshot:
            old = not row or (now or datetime.now(timezone.utc)) - datetime.fromisoformat(row[0]) > timedelta(hours=48)
            state = 'stale' if old or row[1] else 'available'
        return {'state': state, 'period': period, 'indicator': indicator,
            'unit_status': snapshot.unit_status if snapshot else 'review_required',
            'last_checked_at': row[0] if row else None,
            'source_check_failed': bool(row and row[1])}


def router(data_dir=None):
    store = BopStore(Path(data_dir or os.getenv('FFA_DATA_DIR', 'var')) / 'bop.sqlite')
    api = APIRouter()

    @api.get('/api/v1/flows/bop/status')
    def status(period: str, indicator: Literal['P_F51', 'P_F5'] = 'P_F51'):
        try:
            source_url(period, indicator)
        except ValueError as error:
            raise HTTPException(422, detail=str(error)) from error
        return store.status(period, indicator)

    @api.get('/api/v1/flows/bop', response_model=BopSnapshot)
    def snapshot(request: Request, response: Response, period: str,
                 indicator: Literal['P_F51', 'P_F5'] = 'P_F51'):
        try:
            source_url(period, indicator)
        except ValueError as error:
            raise HTTPException(422, detail=str(error)) from error
        result = store.get(period, indicator)
        if result is None:
            raise HTTPException(503, detail='No BOP snapshot for this period/indicator. Run explicit ingestion first.')
        state = store.status(period, indicator)['state']
        identity = result.version + ':' + result.retrieved_at + ':' + state
        etag = '"' + hashlib.sha256(identity.encode()).hexdigest()[:32] + '"'
        headers = {'ETag': etag, 'Cache-Control': 'private, no-cache', 'X-Data-Status': state,
                   'X-Unit-Status': result.unit_status}
        if state == 'stale':
            headers['Warning'] = '110 - "Last validated response; source check is stale or failed"'
        if request.headers.get('if-none-match') == etag:
            return Response(status_code=304, headers=headers)
        response.headers.update(headers)
        return result
    return api


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('BOP redirect refused')


def fetch_response(url):
    request = URLRequest(url, headers={'User-Agent': 'FinanceFlowAtlas/0.3 (personal statistical research)',
        'Accept': 'application/vnd.sdmx.structurespecificdata+xml;version=2.1'})
    with build_opener(NoRedirect()).open(request, timeout=90) as response:
        if response.status != 200 or response.geturl() != url:
            raise ValueError('Unexpected BOP response status or final URL')
        raw = response.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise ValueError('Oversized BOP response')
    return raw


def main():
    parser = argparse.ArgumentParser(description='Read IMF BOP transactions, separate from PIP holdings and TIC')
    parser.add_argument('--period', required=True, help='YYYY or YYYY-Q1..Q4; one period per snapshot')
    parser.add_argument('--indicator', choices=['P_F51', 'P_F5'], default='P_F51')
    parser.add_argument('--data-dir', default=os.getenv('FFA_DATA_DIR', 'var'))
    parser.add_argument('--unit-evidence', help='Reviewed exact-response reconciliation JSON; omit to withhold USD amounts')
    args = parser.parse_args()
    url = source_url(args.period, args.indicator)
    evidence = UnitEvidence.model_validate_json(Path(args.unit_evidence).read_text()) if args.unit_evidence else None
    store = BopStore(Path(args.data_dir) / 'bop.sqlite')
    now = datetime.now(timezone.utc).isoformat()
    try:
        raw = fetch_response(url)
        result = normalize(raw, args.period, now, args.indicator, evidence)
        # Store normalized facts only; raw provider data is never added to source control.
        store.save(result)
    except Exception as error:
        store.fail(args.period, args.indicator, now, type(error).__name__)
        raise
    print(f'{result.indicator} {result.period}: {result.reporting_economy_count} reporting economies; '
          f'unit status: {result.unit_status}; delayed transactions, not live trading')


if __name__ == '__main__':
    main()
