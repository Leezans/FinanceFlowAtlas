"""Validated N-PORT fund-share snapshots, separate from positions and TIC trades.

Import local source members through this CLI. GET requests never download data.
No aggregation or fund/sector/country classification is inferred.
"""
import argparse
import hashlib
import json
import os
import re
import sqlite3
from collections import defaultdict
from datetime import date, datetime, timezone
from decimal import Decimal, localcontext
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, model_validator

from .source_sec_nport import _amount, normalize

Money = Annotated[str, Field(pattern=r'^-?(?:\d+(?:\.\d+)?|\.\d+)$', max_length=64)]
Month = Annotated[str, Field(pattern=r'^\d{4}-(0[1-9]|1[0-2])$')]
LIMITATIONS = (
    'Reported fund-share subscriptions minus redemptions, excluding reinvestment. '
    'Monthly observations in quarterly bulk publications, delayed and not live. '
    'Not equity-only, cash-only, an exhaustive market total, sector flows, '
    'individual-stock trades, investor geography or country flows. '
    'Exchanges, mergers/acquisitions, liquidations and omnibus netting may contribute. '
    'Latest filing within this vintage only; do not sum overlapping vintages. '
    'Filing date and HTTP Last-Modified are not verified public dissemination dates. '
    'As-filed values may contain errors; negative gross amounts are flagged, not corrected.'
)


class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)


class FundRecord(StrictModel):
    series_id: Annotated[str, Field(pattern=r'^S\d{9}$')]
    series_name: str
    accession_number: Annotated[str, Field(pattern=r'^\d{10}-\d{2}-\d{6}$')]
    filing_type: Literal['NPORT-P', 'NPORT-P/A']
    report_date: str
    filing_date: str
    period: Month
    source_month_index: Literal[1, 2, 3]
    sales_excluding_reinvestment_usd: Money | None
    reinvestment_usd: Money | None
    redemptions_usd: Money | None
    net_external_flow_usd: Money | None
    quality_flags: list[Literal['negative_reported_gross_flow']]

    @model_validator(mode='after')
    def reconcile(self):
        report = date.fromisoformat(self.report_date)
        filed = date.fromisoformat(self.filing_date)
        if filed < report:
            raise ValueError('Filing precedes report date')
        ordinal = report.year * 12 + report.month - 1 - (3 - self.source_month_index)
        if self.period != f'{ordinal // 12:04d}-{ordinal % 12 + 1:02d}':
            raise ValueError('Period does not match source month index')
        values = [None if v is None else _amount(v) for v in (
            self.sales_excluding_reinvestment_usd, self.reinvestment_usd, self.redemptions_usd)]
        sales, _, redemptions = values
        with localcontext() as ctx:
            ctx.prec = 80
            expected = None if sales is None or redemptions is None else sales - redemptions
        actual = None if self.net_external_flow_usd is None else Decimal(self.net_external_flow_usd)
        if actual != expected:
            raise ValueError('Net flow does not reconcile to sales minus redemptions')
        flags = ['negative_reported_gross_flow'] if any(v is not None and v < 0 for v in values) else []
        if self.quality_flags != flags:
            raise ValueError('Quality flags inconsistent with gross values')
        return self


class FundSnapshot(StrictModel):
    source_id: Literal['us-sec-nport-fund-share-flows']
    adapter_version: Literal['sec-nport-b6-v1']
    concept: Literal['reported_fund_share_subscriptions_minus_redemptions']
    unit: Literal['USD']
    frequency: Literal['monthly']
    is_live: Literal[False]
    report_month: Month
    bulk_vintage: Annotated[str, Field(pattern=r'^20\d{2}q[1-4]$')]
    source_url: str
    retrieved_at: str
    source_http_last_modified: str | None
    observation_publication_date: None
    raw_member_sha256: dict[str, str]
    excluded_records: dict[str, Annotated[int, Field(ge=0)]]
    fund_count: Annotated[int, Field(gt=0)]
    records: Annotated[list[FundRecord], Field(min_length=3)]
    limitations: str

    @model_validator(mode='after')
    def validate_snapshot(self):
        retrieved = datetime.fromisoformat(self.retrieved_at.replace('Z', '+00:00'))
        if retrieved.tzinfo is None:
            raise ValueError('Retrieval time must have timezone')
        if self.source_url != f'https://www.sec.gov/files/dera/data/form-n-port-data-sets/{self.bulk_vintage}_nport.zip':
            raise ValueError('Unexpected SEC source URL')
        if set(self.raw_member_sha256) != {'SUBMISSION.tsv', 'FUND_REPORTED_INFO.tsv'} or any(
            not re.fullmatch(r'[a-f0-9]{64}', h) for h in self.raw_member_sha256.values()
        ):
            raise ValueError('Missing or invalid raw member hashes')
        if set(self.excluded_records) != {'other_report_month', 'unsupported_submission', 'missing_series_id',
                                         'superseded_in_vintage', 'ambiguous_same_day_series'}:
            raise ValueError('Invalid exclusion counters')
        groups = defaultdict(list)
        accession_series = {}
        for record in self.records:
            if record.report_date[:7] != self.report_month or date.fromisoformat(record.filing_date) > retrieved.date():
                raise ValueError('Record chronology differs from snapshot')
            owner = accession_series.setdefault(record.accession_number, record.series_id)
            if owner != record.series_id:
                raise ValueError('Accession assigned to multiple fund series')
            groups[record.series_id].append(record)
        if len(groups) != self.fund_count:
            raise ValueError('Fund count differs from unique series')
        for records in groups.values():
            if sorted(r.source_month_index for r in records) != [1, 2, 3]:
                raise ValueError('Each series requires exactly three unique months')
            if len({(r.accession_number, r.report_date, r.filing_date, r.filing_type, r.series_name) for r in records}) != 1:
                raise ValueError('Inconsistent filing identity for a series')
        return self

    def canonical(self):
        return json.dumps(self.model_dump(), sort_keys=True, separators=(',', ':'), ensure_ascii=False)

    @property
    def version(self):
        return hashlib.sha256(self.canonical().encode()).hexdigest()


def validated(payload):
    # Revalidate model instances too: callers can mutate their nested records.
    if isinstance(payload, FundSnapshot):
        payload = payload.model_dump()
    result = FundSnapshot.model_validate(payload)
    result.limitations = LIMITATIONS  # Always serve explicit, non-editable caveats.
    return result


class FundStore:
    def __init__(self, path):
        self.path = str(path)
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS snapshots(version TEXT PRIMARY KEY, report_month TEXT NOT NULL,
                    vintage TEXT NOT NULL, retrieved_at TEXT NOT NULL, payload TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS current(id INTEGER PRIMARY KEY CHECK(id=1), version TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS check_state(id INTEGER PRIMARY KEY CHECK(id=1), checked_at TEXT NOT NULL, failed INTEGER NOT NULL);
            ''')

    def connect(self):
        return sqlite3.connect(self.path, timeout=30)

    def save(self, payload):
        snapshot = validated(payload)
        with self.connect() as db:
            row = db.execute('SELECT s.report_month,s.vintage,s.retrieved_at FROM snapshots s JOIN current c ON s.version=c.version').fetchone()
            if row and ((snapshot.report_month, snapshot.bulk_vintage) < (row[0], row[1]) or
                        datetime.fromisoformat(snapshot.retrieved_at) < datetime.fromisoformat(row[2])):
                raise ValueError('Refusing to regress active SEC snapshot')
            db.execute('INSERT OR IGNORE INTO snapshots VALUES (?,?,?,?,?)', (
                snapshot.version, snapshot.report_month, snapshot.bulk_vintage, snapshot.retrieved_at, snapshot.canonical()))
            db.execute('INSERT OR REPLACE INTO current VALUES (1,?)', (snapshot.version,))
            db.execute('INSERT OR REPLACE INTO check_state VALUES (1,?,0)', (snapshot.retrieved_at,))
        return snapshot

    def fail(self, checked_at):
        # Never expose paths, credentials, upstream bodies, or exception strings.
        with self.connect() as db:
            db.execute('INSERT OR REPLACE INTO check_state VALUES (1,?,1)', (checked_at,))

    def latest(self):
        with self.connect() as db:
            row = db.execute('SELECT s.version,s.payload FROM snapshots s JOIN current c ON s.version=c.version').fetchone()
        if not row:
            return None
        snapshot = validated(json.loads(row[1]))
        if snapshot.version != row[0]:
            raise ValueError('SEC snapshot integrity check failed')
        return snapshot

    def status(self):
        with self.connect() as db:
            row = db.execute('SELECT checked_at,failed FROM check_state WHERE id=1').fetchone()
        try:
            current = self.latest()
        except (ValueError, TypeError):
            current = None
        return {
            'state': 'unavailable' if current is None else ('stale' if row and row[1] else 'available'),
            'last_checked_at': row[0] if row else None,
            'last_check_failed': bool(row and row[1]),
            'report_month': current.report_month if current else None,
            'bulk_vintage': current.bulk_vintage if current else None,
            'is_live': False, 'bulk_publication_frequency': 'quarterly',
            'freshness_note': 'Available means a validated local snapshot, not confirmation of the latest SEC release.',
        }


def router(data_dir=None):
    store = FundStore(Path(data_dir or os.getenv('FFA_DATA_DIR', 'var')) / 'sec-nport.sqlite')
    api = APIRouter()

    @api.get('/api/v1/flows/sec-nport/status')
    def status():
        return store.status()

    @api.get('/api/v1/flows/sec-nport')
    def snapshot(request: Request, response: Response):
        try:
            result = store.latest()
        except (ValueError, TypeError):
            result = None
        if result is None:
            raise HTTPException(503, detail='No validated SEC fund-share flow snapshot. Run SEC ingestion first.')
        state = store.status()['state']
        etag = '"' + hashlib.sha256((result.version + ':' + state).encode()).hexdigest() + '"'
        headers = {'ETag': etag, 'Cache-Control': 'no-cache', 'X-Data-Status': state}
        if state != 'available':
            headers['Warning'] = '110 - "Last validated SEC snapshot; latest ingestion failed"'
        if request.headers.get('if-none-match') == etag:
            return Response(status_code=304, headers=headers)
        response.headers.update(headers)
        return {'version': result.version, 'bulk_publication_frequency': 'quarterly',
                'status': state, 'snapshot': result.model_dump()}
    return api


def main():
    parser = argparse.ArgumentParser(description='Ingest local SEC TSV members as delayed fund-share flow snapshots')
    parser.add_argument('--submission', required=True, type=Path)
    parser.add_argument('--fund', required=True, type=Path)
    parser.add_argument('--report-month', required=True)
    parser.add_argument('--vintage', required=True)
    parser.add_argument('--retrieved-at', required=True, help='Actual timezone-aware source retrieval timestamp, not import time')
    parser.add_argument('--data-dir', default=os.getenv('FFA_DATA_DIR', 'var'))
    args = parser.parse_args()
    store = FundStore(Path(args.data_dir) / 'sec-nport.sqlite')
    now = datetime.now(timezone.utc).isoformat()
    try:
        members = []
        for path in (args.submission, args.fund):
            with path.open('rb') as source:
                raw = source.read(32_000_001)
            if len(raw) > 32_000_000:
                raise ValueError('SEC source member exceeds size limit')
            members.append(raw)
        result = store.save(normalize(*members, report_month=args.report_month,
                                      vintage=args.vintage, retrieved_at=args.retrieved_at))
    except Exception:
        store.fail(now)
        raise
    print(f'SEC {result.report_month}: {result.fund_count} series, version {result.version}; delayed fund-share flows, not live')


if __name__ == '__main__':
    main()
