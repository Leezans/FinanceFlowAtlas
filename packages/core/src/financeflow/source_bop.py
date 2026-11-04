"""IMF BOP country-level transactions. Never generates bilateral edges or holdings."""
import hashlib
import json
import re
import xml.etree.ElementTree as ET
from collections import Counter
from datetime import datetime
from decimal import Decimal, InvalidOperation, localcontext
from typing import Literal

from pydantic import BaseModel, ConfigDict, model_validator
from .registry import countries

FLOW = 'IMF.STA,BOP,21.0.0'
ADAPTER = 'imf-bop-transactions-v1'
INDICATORS = {'P_F51': 'Portfolio investment, Equity',
              'P_F5': 'Portfolio investment, Equity and investment fund shares'}
ENTRIES = {'A_NFA_T': 'net_acquisition_of_foreign_assets',
           'L_NIL_T': 'net_incurrence_of_domestic_liabilities'}
MAX_BYTES = 20_000_000


def exact_amount(value, factor='1'):
    if len(value) > 128 or not re.fullmatch(r'[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d{1,3})?', value):
        raise ValueError('Invalid or oversized source decimal')
    amount = Decimal(value)
    if not amount.is_finite() or abs(amount.as_tuple().exponent) > 100 or abs(amount.adjusted()) > 100:
        raise ValueError('Source decimal exponent outside supported range')
    with localcontext() as ctx:
        ctx.prec = 256
        return format(amount * Decimal(factor), 'f')


def snapshot_version(digest, period, indicator, evidence, facts):
    return hashlib.sha256(json.dumps({'raw': digest, 'period': period, 'indicator': indicator,
        'adapter': ADAPTER, 'registry': 'pycountry-24.6.1',
        'facts': [f.model_dump() for f in facts],
        'units': evidence.model_dump() if evidence else None}, sort_keys=True).encode()).hexdigest()[:24]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid', revalidate_instances='always')


class UnitEvidence(StrictModel):
    """An operator-reviewed, exact-response reconciliation, not a magnitude heuristic."""
    raw_sha256: str
    indicator: Literal['P_F51', 'P_F5']
    factor_to_usd: Literal['1', '1000000']
    official_reference_url: str
    reconciliation_note: str


class BopFact(StrictModel):
    reporter_iso3: str
    accounting_entry: Literal['A_NFA_T', 'L_NIL_T']
    direction: str
    period: str
    frequency: Literal['A', 'Q']
    indicator: Literal['P_F51', 'P_F5']
    methodology: Literal['BPM6', 'BPM7']
    source_value: str
    source_unit: Literal['USD'] = 'USD'
    source_scale: Literal['6'] = '6'
    value_usd: str | None = None
    positive_means: str
    negative_means: str
    observation_status: str
    derivation_type: str | None = None


class BopSnapshot(StrictModel):
    source_id: Literal['imf-bop-portfolio-equity-transactions'] = 'imf-bop-portfolio-equity-transactions'
    version: str
    adapter_version: str = ADAPTER
    source_url: str
    source_sha256: str
    retrieved_at: str
    response_prepared_at: str | None
    dataset_published_at: str | None
    dataset_updated_at: str | None
    period: str
    frequency: Literal['A', 'Q']
    indicator: Literal['P_F51', 'P_F5']
    indicator_label: str
    unit_status: Literal['review_required', 'verified']
    unit_evidence: UnitEvidence | None
    reporting_economy_count: int
    both_directions_economy_count: int
    excluded_records: dict[str, int]
    facts: list[BopFact]
    coverage_note: str
    license_note: str = 'IMF terms apply. Personal-use connector; public redistribution is not certified.'


    @model_validator(mode='after')
    def consistent(self):
        if (self.adapter_version != ADAPTER or self.frequency != validate_period(self.period)
                or self.source_url != source_url(self.period, self.indicator)
                or self.indicator_label != INDICATORS[self.indicator]
                or not re.fullmatch(r'[0-9a-f]{64}', self.source_sha256)):
            raise ValueError('Inconsistent snapshot identity')
        for timestamp in (self.retrieved_at, self.response_prepared_at, self.dataset_published_at, self.dataset_updated_at):
            _timestamp(timestamp)
        evidence = self.unit_evidence
        if (self.unit_status == 'verified') != (evidence is not None):
            raise ValueError('Inconsistent unit verification status')
        if evidence and (evidence.raw_sha256 != self.source_sha256 or evidence.indicator != self.indicator
                or not re.match(r'^https://(?:[A-Za-z0-9-]+\.)*(?:imf\.org|bea\.gov|statcan\.gc\.ca|ons\.gov\.uk)/', evidence.official_reference_url)
                or not evidence.reconciliation_note.strip()):
            raise ValueError('Invalid unit reconciliation identity')
        if self.version != snapshot_version(self.source_sha256, self.period, self.indicator, evidence, self.facts):
            raise ValueError('Inconsistent snapshot version')
        valid, seen, counts = {c.iso3 for c in countries()}, set(), Counter()
        if not self.facts or any(v < 0 for v in self.excluded_records.values()):
            raise ValueError('Invalid snapshot counts')
        for fact in self.facts:
            key = (fact.reporter_iso3, fact.accounting_entry)
            asset = fact.accounting_entry == 'A_NFA_T'
            positive = 'resident_net_acquisition_abroad_outflow' if asset else 'nonresident_net_investment_in_reporter_inflow'
            negative = 'resident_net_disposal_abroad_inflow' if asset else 'nonresident_net_disinvestment_from_reporter_outflow'
            if (fact.reporter_iso3 not in valid or key in seen or fact.period != self.period
                    or fact.frequency != self.frequency or fact.indicator != self.indicator
                    or fact.direction != ENTRIES[fact.accounting_entry] or fact.positive_means != positive
                    or fact.negative_means != negative or fact.observation_status not in ('', 'A')):
                raise ValueError('Inconsistent transaction fact')
            exact_amount(fact.source_value)
            expected = exact_amount(fact.source_value, evidence.factor_to_usd) if evidence else None
            if fact.value_usd != expected:
                raise ValueError('Inconsistent monetary value')
            seen.add(key); counts[fact.reporter_iso3] += 1
        if self.reporting_economy_count != len(counts) or self.both_directions_economy_count != sum(v == 2 for v in counts.values()):
            raise ValueError('Inconsistent coverage counts')
        return self


def validate_period(period):
    if not re.fullmatch(r'\d{4}(?:-Q[1-4])?', period):
        raise ValueError('Expected YYYY or YYYY-Q1..Q4')
    return 'Q' if '-Q' in period else 'A'


def source_url(period, indicator='P_F51'):
    frequency = validate_period(period)
    if indicator not in INDICATORS:
        raise ValueError('Unsupported BOP indicator')
    return (f'https://api.imf.org/external/sdmx/2.1/data/{FLOW}/'
            f'.A_NFA_T+L_NIL_T.{indicator}.USD.{frequency}'
            f'?startPeriod={period}&endPeriod={period}')


def _timestamp(value):
    if value is not None:
        dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if dt.tzinfo is None:
            raise ValueError('Source and retrieval timestamps must be timezone-aware')
    return value


def normalize(raw: bytes, period: str, retrieved_at: str, indicator='P_F51',
              unit_evidence: UnitEvidence | None = None) -> BopSnapshot:
    url = source_url(period, indicator)
    frequency = validate_period(period)
    _timestamp(retrieved_at)
    if not raw or len(raw) > MAX_BYTES:
        raise ValueError('Empty or oversized BOP response')
    try:
        xml_text = raw.decode('utf-8-sig', errors='strict')
    except UnicodeDecodeError as error:
        raise ValueError('Only UTF-8 IMF XML is accepted') from error
    if '\x00' in xml_text:
        raise ValueError('NUL bytes/non-UTF-8 XML are not accepted')
    if '<!DOCTYPE' in xml_text.upper() or '<!ENTITY' in xml_text.upper():
        raise ValueError('DTD/entity declarations are not accepted')
    root = ET.fromstring(xml_text)
    ns = '{http://www.sdmx.org/resources/sdmxml/schemas/v2_1/message}'
    if root.tag != ns + 'StructureSpecificData':
        raise ValueError('Expected IMF SDMX 2.1 structure-specific XML')
    refs = [r for r in root.iter('Ref') if r.get('id') == 'BOP']
    if not any(r.get('agencyID') == 'IMF.STA' and r.get('version') == '21.0.0' for r in refs):
        raise ValueError('Unexpected IMF BOP dataflow version')
    datasets = root.findall(ns + 'DataSet')
    if len(datasets) != 1:
        raise ValueError('Expected exactly one BOP dataset')
    dataset = datasets[0]
    if dataset.get('action', 'Replace') != 'Replace':
        raise ValueError('Incremental/delete datasets are unsupported')
    digest = hashlib.sha256(raw).hexdigest()
    if unit_evidence:
        if (unit_evidence.raw_sha256 != digest or unit_evidence.indicator != indicator
                or not re.match(r'^https://(?:[A-Za-z0-9-]+\.)*(?:imf\.org|bea\.gov|statcan\.gc\.ca|ons\.gov\.uk)/', unit_evidence.official_reference_url)
                or not unit_evidence.reconciliation_note.strip()):
            raise ValueError('Unit evidence must reconcile this exact response and indicator against an official source')
    valid = {c.iso3 for c in countries()}
    facts, seen, excluded = [], set(), Counter()
    for series in dataset.findall('Series'):
        for obs in series.findall('Obs'):
            row = {**dataset.attrib, **series.attrib, **obs.attrib}
            if (row.get('INDICATOR') != indicator or row.get('FREQUENCY') != frequency
                    or row.get('TIME_PERIOD') != period or row.get('BOP_ACCOUNTING_ENTRY') not in ENTRIES):
                excluded['outside_selected_series_or_period'] += 1
                continue
            country, entry = row.get('COUNTRY'), row['BOP_ACCOUNTING_ENTRY']
            if country not in valid:
                excluded['aggregate_or_non_iso_geography'] += 1
                continue
            if row.get('UNIT') != 'USD' or row.get('SCALE') != '6':
                raise ValueError('Unexpected BOP unit/scale; source review required')
            if row.get('METHODOLOGY') not in ('BPM6', 'BPM7'):
                raise ValueError('Unknown BOP methodology')
            # Fail closed on embargoed/confidential/non-public or nonnormal observations.
            status = row.get('OBS_STATUS', row.get('STATUS', ''))
            if (status not in ('', 'A') or row.get('ACCESS_SHARING_LEVEL') != 'PUBLIC_OPEN'
                    or row.get('SECURITY_CLASSIFICATION') != 'PUB'):
                excluded['flagged_or_not_public'] += 1
                continue
            value = row.get('OBS_VALUE', '').strip()
            if not value:
                excluded['missing_value'] += 1
                continue
            try:
                amount = Decimal(exact_amount(value))
            except InvalidOperation as error:
                raise ValueError('Invalid source number') from error
            if not amount.is_finite():
                raise ValueError('Non-finite source amount')
            key = (country, entry, indicator, period)
            if key in seen:
                raise ValueError('Duplicate BOP observation')
            seen.add(key)
            asset = entry == 'A_NFA_T'
            facts.append(BopFact(reporter_iso3=country, accounting_entry=entry,
                direction=ENTRIES[entry], period=period, frequency=frequency, indicator=indicator,
                methodology=row['METHODOLOGY'], source_value=value,
                value_usd=exact_amount(value, unit_evidence.factor_to_usd) if unit_evidence else None,
                positive_means='resident_net_acquisition_abroad_outflow' if asset else 'nonresident_net_investment_in_reporter_inflow',
                negative_means='resident_net_disposal_abroad_inflow' if asset else 'nonresident_net_disinvestment_from_reporter_outflow',
                observation_status=status, derivation_type=row.get('DERIVATION_TYPE')))
    if not facts:
        raise ValueError('No eligible BOP transaction observations for selected period/indicator')
    facts.sort(key=lambda x: (x.reporter_iso3, x.accounting_entry))
    counts = Counter(f.reporter_iso3 for f in facts)
    version = snapshot_version(digest, period, indicator, unit_evidence, facts)
    prepared = root.findtext(ns + 'Header/' + ns + 'Prepared')
    return BopSnapshot(version=version, source_url=url, source_sha256=digest,
        retrieved_at=retrieved_at, response_prepared_at=_timestamp(prepared),
        dataset_published_at=_timestamp(dataset.get('PUBLICATION_DATE')),
        dataset_updated_at=_timestamp(dataset.get('UPDATE_DATE')), period=period, frequency=frequency,
        indicator=indicator, indicator_label=INDICATORS[indicator],
        unit_status='verified' if unit_evidence else 'review_required', unit_evidence=unit_evidence,
        reporting_economy_count=len(counts), both_directions_economy_count=sum(v == 2 for v in counts.values()),
        excluded_records=dict(excluded), facts=facts,
        coverage_note='Counts describe this exact period and indicator only. ISO economies include territories. '
        'Country-to-rest-of-world transactions, not bilateral flows, market turnover, or position changes. '
        'Positive asset acquisition is outflow; positive liability incurrence is inflow. Negative values reverse these meanings. '
        'Annual and quarterly observations, and P_F51 and P_F5, must never be added together. '
        'Publication timestamps are dataset-level, not country release times. Missing observations are not zero. '
        'Monetary conversion is withheld unless this exact response has a reviewed unit reconciliation.')
