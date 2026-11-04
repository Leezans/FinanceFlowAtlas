"""TIC SLT table 1 reported equity transactions, never changes in holdings."""
import csv
import hashlib
import io
import json
import re
from collections import Counter
from datetime import date, datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field
from .tic_geography import COUNTRIES

SOURCE_URL = 'https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt_table1.txt'
SOURCE_ID = 'us-tic-slt-equity-transactions'
ADAPTER_VERSION = 'tic-equity-v1.0.0'
# Date of the release for this observation month, NOT the mutable file's revision date.
RELEASES = {'2026-08': ('2026-10-16', 'https://home.treasury.gov/news/press-releases/sb0662/')}

class Flow(BaseModel):
    model_config = ConfigDict(extra='forbid')
    record_id: str
    foreign_economy_iso3: str = Field(pattern=r'^[A-Z]{3}$')
    foreign_economy_name: str
    treasury_country_code: str
    issuer_economy_iso3: Literal['USA'] = 'USA'
    net_foreign_purchases_usd: int
    period: str = Field(pattern=r'^\d{4}-(0[1-9]|1[0-2])$')
    source_id: Literal['us-tic-slt-equity-transactions'] = SOURCE_ID

class FlowSnapshot(BaseModel):
    model_config = ConfigDict(extra='forbid')
    version: str
    concept: Literal['reported_net_transactions'] = 'reported_net_transactions'
    asset_class: Literal['equity'] = 'equity'
    frequency: Literal['monthly'] = 'monthly'
    is_live: Literal[False] = False
    period: str = Field(pattern=r'^\d{4}-(0[1-9]|1[0-2])$')
    source_id: Literal['us-tic-slt-equity-transactions'] = SOURCE_ID
    source_url: Literal[SOURCE_URL] = SOURCE_URL
    source_field: Literal['for_lt_eqty_net'] = 'for_lt_eqty_net'
    source_unit: Literal['USD millions'] = 'USD millions'
    output_unit: Literal['USD'] = 'USD'
    observation_release_date: date | None = None
    release_url: str | None = None
    source_revision_published_at: datetime | None = None
    retrieved_at: datetime
    raw_sha256: str
    adapter_version: str = ADAPTER_VERSION
    geography_version: str = 'tic-table1-2026-08-v1'
    excluded_records: dict[str, int]
    country_flows: list[Flow]
    grand_total_net_foreign_purchases_usd: int | None = None
    direction_note: str = 'Positive = foreign net purchases of U.S. equity (money into U.S.); negative = net sales (money out). Do not reverse investor/issuer identities on negative observations.'
    coverage_note: str = 'U.S.-centric monthly transactions in U.S. corporate equity, including fund shares. Geographic attribution is reported foreign residence, subject to custodial/intermediary bias, not ultimate beneficial ownership or exchange location. Listed country rows are not exhaustive; do not sum them as the world total. Not real time and not comparable to IMF holdings levels.'
    license_note: str = 'Treasury federal statistical data; source attribution retained. Repository software license does not license provider data or Treasury branding. No third-party materials or blanket worldwide reuse guarantee implied.'
    rights_url: str = 'https://www.copyright.gov/history/copyright-exhibit/lifecycle/'


def normalize(raw: bytes, period: str, retrieved_at: str) -> FlowSnapshot:
    if not re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])', period):
        raise ValueError('Expected YYYY-MM')
    if period < '2023-02':
        raise ValueError('Expanded SLT transaction series begins 2023-02; do not splice legacy Form S')
    timestamp = datetime.fromisoformat(retrieved_at.replace('Z', '+00:00'))
    if timestamp.tzinfo is None:
        raise ValueError('retrieved_at must include timezone')
    lines = raw.decode('utf-8-sig').splitlines()
    if not lines or not lines[0].startswith('Table 1: U.S. Long-Term Securities Held by Foreign Residents'):
        raise ValueError('Unexpected TIC table title')
    if not any(line.split('\t')[0] == 'Millions of dollars' for line in lines[:10]):
        raise ValueError('Unverified source unit')
    headers = [i for i,line in enumerate(lines) if line.startswith('country\tcountry_code\tdate\t')]
    if len(headers) != 1:
        raise ValueError('Missing or duplicate machine header')
    footers = [i for i, line in enumerate(lines) if line.split('\t')[0] == 'Definitions:']
    if len(footers) != 1 or footers[0] <= headers[0]:
        raise ValueError('Missing source footer; possibly truncated table')
    reader = csv.DictReader(io.StringIO('\n'.join(lines[headers[0]:footers[0]])), delimiter='\t')
    if not {'country', 'country_code', 'date', 'for_lt_eqty_net'}.issubset(reader.fieldnames or ()):
        raise ValueError('Missing equity transaction column')
    if len(set(reader.fieldnames)) != len(reader.fieldnames):
        raise ValueError('Duplicate source columns')
    excluded = Counter(); records = []; seen = set(); total = None
    for row in reader:
        if None in row or any(value is None for value in row.values()):
            raise ValueError('Malformed data row')
        if all(not value.strip() for value in row.values()):
            continue
        if not re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])', row.get('date', '')):
            raise ValueError('Missing or malformed data-row date')
        if row['date'] != period:
            excluded['other_period'] += 1
            continue
        code = row['country_code']
        if code in seen:
            raise ValueError('Duplicate country/month observation')
        seen.add(code)
        if code not in COUNTRIES and code != '99996':
            excluded['aggregate_or_unmapped_geography'] += 1
            continue
        if code in COUNTRIES and row['country'] != COUNTRIES[code][0]:
            raise ValueError('Country code/name changed; mapping needs review')
        if code == '99996' and row['country'] != 'Grand Total':
            raise ValueError('Grand total code/name mismatch')
        value = row['for_lt_eqty_net'].strip()
        if value in ('', 'n.a.'):
            excluded['missing_transaction_value'] += 1
            continue
        # Treasury publishes integral millions. Reject changed units, flags and nonfinite values.
        if not re.fullmatch(r'-?\d+', value):
            raise ValueError('Unexpected transaction value: ' + value)
        usd = int(value) * 1_000_000
        if code == '99996':
            total = usd
            continue
        name, iso3 = COUNTRIES[code]
        records.append(Flow(record_id=f'{SOURCE_ID}:{code}:{period}', foreign_economy_iso3=iso3,
                            foreign_economy_name=name, treasury_country_code=code,
                            net_foreign_purchases_usd=usd, period=period))
    if not records:
        raise ValueError('No valid country equity transactions for requested month')
    if total is None:
        raise ValueError('Missing published grand total; incomplete transaction month')
    digest = hashlib.sha256(raw).hexdigest()
    release_date, release_url = RELEASES.get(period, (None, None))
    version = hashlib.sha256(json.dumps({'raw': digest, 'period': period, 'adapter': ADAPTER_VERSION,
                            'geography': COUNTRIES, 'release': (release_date, release_url)}, sort_keys=True).encode()).hexdigest()[:20]
    return FlowSnapshot(version=version, period=period, retrieved_at=timestamp, raw_sha256=digest,
                        observation_release_date=release_date, release_url=release_url,
                        excluded_records=dict(excluded), country_flows=sorted(records, key=lambda r:r.foreign_economy_iso3),
                        grand_total_net_foreign_purchases_usd=total)
