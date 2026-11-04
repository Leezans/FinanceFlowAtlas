"""SEC N-PORT B.6 fund-share flows. Not security trades or country flows."""
import csv
import hashlib
import io
import re
from datetime import datetime
from decimal import Decimal, InvalidOperation, localcontext

SOURCE_ID = 'us-sec-nport-fund-share-flows'
ADAPTER_VERSION = 'sec-nport-b6-v1'
SOURCE_PAGE = 'https://www.sec.gov/data-research/sec-markets-data/form-n-port-data-sets'
FLOW_FIELDS = {f'{kind}_FLOW_MON{i}' for kind in ('SALES', 'REINVESTMENT', 'REDEMPTION') for i in (1, 2, 3)}


def _rows(raw, required):
    reader = csv.DictReader(io.StringIO(raw.decode('utf-8-sig')), delimiter='\t')
    if not required.issubset(reader.fieldnames or []) or len(set(reader.fieldnames)) != len(reader.fieldnames):
        raise ValueError('Missing or duplicate SEC columns')
    result = {}
    for row in reader:
        if None in row or any(v is None for v in row.values()):
            raise ValueError('Malformed SEC TSV row')
        accession = row['ACCESSION_NUMBER']
        if not re.fullmatch(r'\d{10}-\d{2}-\d{6}', accession) or accession in result:
            raise ValueError('Invalid or duplicate accession')
        result[accession] = row
    return result


def _date(value):
    # SEC bulk files use DD-MON-YYYY, not ISO dates.
    try:
        return datetime.strptime(value, '%d-%b-%Y').date()
    except ValueError as exc:
        raise ValueError('Invalid SEC date') from exc


def _amount(value):
    if value == '':
        return None
    if not re.fullmatch(r'-?(?:\d+(?:\.\d+)?|\.\d+)', value):
        raise ValueError('Invalid SEC dollar amount')
    integer, _, fraction = value.lstrip('-').partition('.')
    if len(integer.lstrip('0')) > 24 or len(fraction) > 12:
        raise ValueError('Amount exceeds SEC NUMBER(36,12) bounds')
    try:
        number = Decimal(value)
    except InvalidOperation as exc:
        raise ValueError('Invalid SEC dollar amount') from exc
    if not number.is_finite():
        raise ValueError('Non-finite gross flow')
    return number


def normalize(submission_raw: bytes, fund_raw: bytes, *, report_month: str,
              vintage: str, retrieved_at: str, source_last_modified: str | None = None):
    """Select one report month within one bulk vintage; keep latest filed amendment.

    Amounts serialize as decimal strings. Missing remains null. This is not a
    cross-vintage history resolver and does not claim the entire fund universe.
    """
    if not re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])', report_month):
        raise ValueError('Expected report month YYYY-MM')
    if not re.fullmatch(r'20\d{2}q[1-4]', vintage):
        raise ValueError('Expected bulk vintage YYYYqN')
    timestamp = datetime.fromisoformat(retrieved_at.replace('Z', '+00:00'))
    if timestamp.tzinfo is None:
        raise ValueError('retrieved_at requires timezone')
    submissions = _rows(submission_raw, {'ACCESSION_NUMBER', 'FILING_DATE', 'SUB_TYPE', 'REPORT_DATE'})
    funds = _rows(fund_raw, {'ACCESSION_NUMBER', 'SERIES_ID', 'SERIES_NAME'} | FLOW_FIELDS)
    selected = {}; candidates = {}; excluded = {'other_report_month': 0, 'unsupported_submission': 0,
                                'missing_series_id': 0, 'superseded_in_vintage': 0, 'ambiguous_same_day_series': 0}
    for accession, fund in funds.items():
        if accession not in submissions:
            raise ValueError('Fund has no matching submission')
        sub = submissions[accession]
        if sub['SUB_TYPE'] not in ('NPORT-P', 'NPORT-P/A'):
            excluded['unsupported_submission'] += 1; continue
        report_date = _date(sub['REPORT_DATE'])
        if report_date.strftime('%Y-%m') != report_month:
            excluded['other_report_month'] += 1; continue
        series = fund['SERIES_ID']
        if not series:
            excluded['missing_series_id'] += 1; continue
        if not re.fullmatch(r'S\d{9}', series):
            raise ValueError('Invalid series identifier')
        filing_date = _date(sub['FILING_DATE'])
        if filing_date < report_date or filing_date > timestamp.date():
            raise ValueError('Inconsistent filing chronology')
        candidates.setdefault(series, []).append((filing_date, accession, fund, sub))
    for series, group in candidates.items():
        if len({item[3]['REPORT_DATE'] for item in group}) != 1:
            raise ValueError('Ambiguous report dates for a series/month')
        excluded['superseded_in_vintage'] += len(group) - 1
        # Any same-day collision excludes the series, regardless of input order.
        if len({item[0] for item in group}) != len(group):
            excluded['ambiguous_same_day_series'] += 1
            continue
        selected[series] = max(group, key=lambda item: item[0])
    records = []
    for series, (filing_date, accession, fund, sub) in sorted(selected.items()):
        for i in (1, 2, 3):
            year, month = map(int, report_month.split('-'))
            ordinal = year * 12 + month - 1 - (3 - i)
            period = f'{ordinal // 12:04d}-{ordinal % 12 + 1:02d}'
            sales, reinvestment, redemptions = [_amount(fund[f'{k}_FLOW_MON{i}']) for k in ('SALES', 'REINVESTMENT', 'REDEMPTION')]
            with localcontext() as context:
                context.prec = 80  # SEC NUMBER(36,12), without binary/decimal rounding loss.
                net = None if sales is None or redemptions is None else sales - redemptions
            records.append({'series_id': series, 'series_name': fund['SERIES_NAME'],
                'accession_number': accession, 'filing_type': sub['SUB_TYPE'],
                'report_date': _date(sub['REPORT_DATE']).isoformat(), 'filing_date': filing_date.isoformat(),
                'period': period, 'source_month_index': i,
                'sales_excluding_reinvestment_usd': None if sales is None else format(sales, 'f'),
                'reinvestment_usd': None if reinvestment is None else format(reinvestment, 'f'),
                'redemptions_usd': None if redemptions is None else format(redemptions, 'f'),
                'quality_flags': ['negative_reported_gross_flow'] if any(v is not None and v < 0 for v in (sales, reinvestment, redemptions)) else [],
                'net_external_flow_usd': None if net is None else format(net, 'f')})
    if not records:
        raise ValueError('No eligible funds for requested report month')
    hashes = {'SUBMISSION.tsv': hashlib.sha256(submission_raw).hexdigest(), 'FUND_REPORTED_INFO.tsv': hashlib.sha256(fund_raw).hexdigest()}
    return {'source_id': SOURCE_ID, 'adapter_version': ADAPTER_VERSION,
        'concept': 'reported_fund_share_subscriptions_minus_redemptions', 'unit': 'USD',
        'frequency': 'monthly', 'is_live': False, 'report_month': report_month,
        'bulk_vintage': vintage, 'source_url': f'https://www.sec.gov/files/dera/data/form-n-port-data-sets/{vintage}_nport.zip',
        'retrieved_at': timestamp.isoformat(), 'source_http_last_modified': source_last_modified,
        'observation_publication_date': None, 'raw_member_sha256': hashes,
        'excluded_records': excluded, 'fund_count': len(selected), 'records': records,
        'limitations': 'Fund-share flows include exchanges, mergers/acquisitions and liquidations; omnibus accounts may report net flows. Reinvestment excluded from net external flow. Not individual-stock trades, investor geography, cash-only flows, equity-only funds, real-time flows, or an exhaustive market total. Latest filing within this vintage only; filing date and HTTP Last-Modified are not verified public dissemination dates.'}
