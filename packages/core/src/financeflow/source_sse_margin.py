"""Offline SSE daily financing activity. No collector, industry join or market-flow proxy."""
import argparse
import hashlib
import json
import re
from datetime import date, datetime, timezone
from pathlib import Path

MAX_BYTES = 4 * 1024 * 1024
MAX_ROWS = 10_000
SOURCE_BASE = 'https://www.sse.com.cn/market/dealingdata/overview/margin/a/'
SUMMARY_HEADERS = ('本日融资余额(元)', '本日融资买入额(元)', '本日融券余量',
                   '本日融券余量金额(元)', '本日融券卖出量', '本日融资融券余额(元)')
DETAIL_HEADERS = ('标的证券代码', '标的证券简称', '本日融资余额(元)', '本日融资买入额(元)',
                  '本日融资偿还额(元)', '本日融券余量', '本日融券卖出量', '本日融券偿还量')
SUMMARY_FIELDS = ('financing_balance_cny', 'financing_buy_cny', 'short_balance_units',
                  'short_balance_cny', 'short_sell_units', 'combined_balance_cny')
DETAIL_FIELDS = ('financing_balance_cny', 'financing_buy_cny', 'financing_repayment_cny',
                 'short_balance_units', 'short_sell_units', 'short_repayment_units')


def _integer(value):
    # Verified export uses text cells, including codes and numbers. Fail closed on
    # changed types, blanks, formulas, scientific notation and fractional amounts.
    if not isinstance(value, str) or not re.fullmatch(r'[0-9]{1,16}', value):
        raise ValueError('Expected nonnegative integer text cell')
    return int(value)


def _metadata(observation_date, retrieved_at):
    if not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}', observation_date):
        raise ValueError('Expected ISO observation date')
    day = date.fromisoformat(observation_date)
    stamp = datetime.fromisoformat(retrieved_at.replace('Z', '+00:00'))
    if stamp.tzinfo is None or stamp.utcoffset() is None:
        raise ValueError('Retrieval timestamp requires timezone')
    return day, stamp.astimezone(timezone.utc).isoformat()


def parse_tables(summary_rows, detail_rows, *, observation_date, retrieved_at):
    """Validate already-decoded tables; dates are operator-supplied, not XLS metadata.

    Every detail instrument is retained, including ETFs and other securities.
    The source does not supply verified instrument classes or industry mappings.
    """
    day, stamp = _metadata(observation_date, retrieved_at)
    if not 2 <= len(summary_rows) <= 100 or not 2 <= len(detail_rows) <= MAX_ROWS + 1:
        raise ValueError('Unexpected table size')
    if tuple(summary_rows[0]) != SUMMARY_HEADERS or tuple(detail_rows[0]) != DETAIL_HEADERS:
        raise ValueError('Unsupported SSE headers')
    if len(summary_rows[1]) != 6:
        raise ValueError('Invalid summary width')
    # The export contains blank rows and one known explanatory note, not totals.
    note = '注：本表格同时包含融资融券汇总信息及明细信息，点击最下方标签可进行切换'
    for row in summary_rows[2:]:
        if len(row) != 6 or any(row[1:]) or row[0] not in ('', note):
            raise ValueError('Unexpected summary footer')
    summary = dict(zip(SUMMARY_FIELDS, map(_integer, summary_rows[1])))
    records, seen = [], set()
    totals = dict.fromkeys(DETAIL_FIELDS, 0)
    for row in detail_rows[1:]:
        if len(row) != 8:
            raise ValueError('Invalid detail width')
        code, name = row[:2]
        if not isinstance(code, str) or not re.fullmatch(r'[0-9]{6}', code):
            raise ValueError('Security code must be six text digits')
        if code in seen:
            raise ValueError('Duplicate security code')
        if not isinstance(name, str) or not name.strip() or len(name) > 128:
            raise ValueError('Invalid security name')
        seen.add(code)
        values = dict(zip(DETAIL_FIELDS, map(_integer, row[2:])))
        for field, value in values.items():
            totals[field] += value
        records.append({'code': code, 'name': name, 'instrument_type': 'unverified',
                        'industry': None, **values,
                        'financing_buy_minus_repayment_cny': values['financing_buy_cny'] - values['financing_repayment_cny']})
    totals['financing_buy_minus_repayment_cny'] = totals['financing_buy_cny'] - totals['financing_repayment_cny']
    return {
        'schema_version': 'sse-margin-offline-v1',
        'metric': 'financing_buy_minus_repayment', 'currency': 'CNY',
        'frequency': 'daily', 'observation_date': day.isoformat(),
        'retrieved_at': stamp, 'published_at': None,
        'date_basis': 'operator-supplied; workbook contains no observation date',
        'source_url': SOURCE_BASE + f'rzrqjygk{day:%Y%m%d}.xls',
        'scope': 'SSE reported detail securities, including ETFs and other instruments; not equity-only',
        'limitations': ['Not market net flow or real-time data', 'No verified instrument or industry classification',
                        'Summary and detail universes may differ; differences are not filled or suppressed',
                        'Short quantities are source units, not CNY and not aggregated monetary flow'],
        'summary': summary, 'detail_totals': totals, 'records': records,
        'reconciliation': {
            'summary_minus_detail': {key: summary[key] - totals[key] for key in
                                     ('financing_balance_cny', 'financing_buy_cny', 'short_balance_units', 'short_sell_units')},
            'summary_combined_balance_residual_cny': summary['combined_balance_cny'] - summary['financing_balance_cny'] - summary['short_balance_cny'],
        },
    }


def parse_xls(path, *, observation_date, retrieved_at):
    """Read one already-acquired local BIFF XLS, limited to 4 MiB and two sheets.

    xlrd is optional: install financeflow-core[sse-margin]. No network is used.
    """
    with Path(path).open('rb') as handle:
        data = handle.read(MAX_BYTES + 1)
    if not 512 <= len(data) <= MAX_BYTES or not data.startswith(bytes.fromhex('D0CF11E0A1B11AE1')):
        raise ValueError('Expected bounded OLE XLS file')
    import xlrd
    book = xlrd.open_workbook(file_contents=data, on_demand=True)
    try:
        if book.sheet_names() != ['汇总信息', '明细信息']:
            raise ValueError('Unsupported SSE workbook sheets')
        tables = []
        for name, width, limit in [('汇总信息', 6, 100), ('明细信息', 8, MAX_ROWS + 1)]:
            sheet = book.sheet_by_name(name)
            if sheet.ncols != width or not 2 <= sheet.nrows <= limit:
                raise ValueError('Unsupported SSE sheet dimensions')
            # Reject formulas/numbers if xlrd exposes a non-text result. Only
            # documented text cells and blank summary padding are accepted.
            for row in sheet.get_rows():
                if any(cell.ctype not in (xlrd.XL_CELL_TEXT, xlrd.XL_CELL_EMPTY, xlrd.XL_CELL_BLANK) for cell in row):
                    raise ValueError('Unsupported SSE cell type')
            tables.append([sheet.row_values(i) for i in range(sheet.nrows)])
        result = parse_tables(*tables, observation_date=observation_date, retrieved_at=retrieved_at)
        result['source_sha256'] = hashlib.sha256(data).hexdigest()
        result['source_bytes'] = len(data)
        return result
    finally:
        book.release_resources()


def compare_financing_balances(previous, current):
    """Diagnostic only: never require an exact rollforward or infer repayments.

    Caller must establish whether snapshots are consecutive trading sessions.
    Added/removed instruments are reported separately, never zero-filled.
    """
    if previous['observation_date'] >= current['observation_date']:
        raise ValueError('Snapshots must be in increasing date order')
    before = {row['code']: row for row in previous['records']}
    after = {row['code']: row for row in current['records']}
    common = sorted(before.keys() & after.keys())
    return {
        'previous_date': previous['observation_date'], 'current_date': current['observation_date'],
        'consecutive_trading_sessions_verified': False,
        'added': sorted(after.keys() - before.keys()), 'removed': sorted(before.keys() - after.keys()),
        'balance_change_minus_buy_plus_repayment_cny': {
            code: after[code]['financing_balance_cny'] - before[code]['financing_balance_cny']
            - after[code]['financing_buy_minus_repayment_cny'] for code in common},
        'interpretation': 'Diagnostic residuals only; no rounding tolerance or exact rollforward assumption',
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('path')
    parser.add_argument('--observation-date', required=True)
    parser.add_argument('--retrieved-at', required=True)
    args = parser.parse_args()
    print(json.dumps(parse_xls(args.path, observation_date=args.observation_date,
                               retrieved_at=args.retrieved_at), ensure_ascii=False))


if __name__ == '__main__':
    main()
