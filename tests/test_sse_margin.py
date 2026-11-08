"""Synthetic data only. Official provider workbooks must never enter Git."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from financeflow.source_sse_margin import (
    DETAIL_HEADERS, SUMMARY_HEADERS, MAX_BYTES, compare_financing_balances,
    parse_tables, parse_xls,
)


class SseMarginTests(unittest.TestCase):
    def setUp(self):
        self.summary = [list(SUMMARY_HEADERS), ['300', '70', '10', '20', '3', '320']]
        self.detail = [list(DETAIL_HEADERS),
                       ['000001', 'Synthetic stock', '100', '40', '10', '3', '1', '0'],
                       ['510001', 'Synthetic ETF', '150', '30', '50', '4', '2', '1']]

    def parse(self, **kwargs):
        return parse_tables(self.summary, self.detail, observation_date=kwargs.get('day', '2026-11-06'),
                            retrieved_at=kwargs.get('stamp', '2026-11-08T14:00:00Z'))

    def test_explicit_metric_and_unclassified_instruments(self):
        result = self.parse()
        self.assertEqual(result['detail_totals']['financing_buy_minus_repayment_cny'], 10)
        self.assertEqual(result['records'][0]['code'], '000001')
        self.assertEqual(result['records'][1]['financing_buy_minus_repayment_cny'], -20)
        self.assertTrue(all(r['instrument_type'] == 'unverified' and r['industry'] is None for r in result['records']))
        self.assertEqual(result['reconciliation']['summary_minus_detail']['financing_balance_cny'], 50)
        self.assertEqual(result['reconciliation']['summary_minus_detail']['short_balance_units'], 3)
        self.assertIsNone(result['published_at'])
        self.assertEqual(result['retrieved_at'], '2026-11-08T14:00:00+00:00')
        self.assertNotIn('financing_buy_minus_repayment_cny', result['summary'])

    def test_rejects_missing_malformed_and_negative_amounts(self):
        for value in ['', None, 40, 40.0, '1.5', '-1', '1e3', ' 4', '1,000', '1' * 17]:
            with self.subTest(value=value):
                self.detail[1][3] = value
                with self.assertRaises(ValueError):
                    self.parse()

    def test_rejects_duplicate_or_numeric_codes(self):
        self.detail[2][0] = self.detail[1][0]
        with self.assertRaises(ValueError):
            self.parse()
        self.detail[2][0] = 510001
        with self.assertRaises(ValueError):
            self.parse()

    def test_rejects_changed_headers_width_footer_and_row_budget(self):
        for target in ('header', 'width', 'footer', 'budget'):
            self.setUp()
            if target == 'header': self.detail[0][0] = 'code'
            if target == 'width': self.detail[1].append('0')
            if target == 'footer': self.summary.append(['unknown', '', '', '', '', ''])
            if target == 'budget': self.detail = [self.detail[0]] + [self.detail[1]] * 10001
            with self.subTest(target=target), self.assertRaises(ValueError):
                self.parse()

    def test_requires_date_and_timezone(self):
        for kwargs in ({'day': '20261106'}, {'day': '2026-02-30'}, {'stamp': '2026-11-08T14:00:00'}):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                self.parse(**kwargs)

    def test_retains_nonzero_residuals_and_changed_universe(self):
        previous = self.parse(day='2026-11-05')
        self.detail[1][2] = '132'  # +32 balance, +30 buy minus repayment
        self.detail[2][0] = '510002'
        current = self.parse()
        comparison = compare_financing_balances(previous, current)
        self.assertEqual(comparison['balance_change_minus_buy_plus_repayment_cny'], {'000001': 2})
        self.assertEqual(comparison['added'], ['510002'])
        self.assertEqual(comparison['removed'], ['510001'])
        self.assertFalse(comparison['consecutive_trading_sessions_verified'])
        with self.assertRaises(ValueError):
            compare_financing_balances(current, previous)

    def test_rejects_non_xls_and_oversized_files_before_decoder(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'fixture.xls'
            for data in (b'<html>blocked</html>', b'\0' * (MAX_BYTES + 1)):
                path.write_bytes(data)
                with self.assertRaises(ValueError):
                    parse_xls(path, observation_date='2026-11-06', retrieved_at='2026-11-08T14:00:00Z')

    def test_generated_synthetic_xls_roundtrip_and_bad_sheets(self):
        try:
            import xlrd
            import xlwt
        except ImportError:
            self.skipTest('Install test and sse-margin extras for XLS roundtrip')
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'synthetic.xls'
            for bad_sheet in (False, True):
                book = xlwt.Workbook()
                for name, rows in [('汇总信息', self.summary), ('wrong' if bad_sheet else '明细信息', self.detail)]:
                    sheet = book.add_sheet(name)
                    for i, row in enumerate(rows):
                        for j, value in enumerate(row):
                            sheet.write(i, j, value)
                book.save(str(path))
                if bad_sheet:
                    with self.assertRaises(ValueError):
                        parse_xls(path, observation_date='2026-11-06', retrieved_at='2026-11-08T14:00:00Z')
                else:
                    result = parse_xls(path, observation_date='2026-11-06', retrieved_at='2026-11-08T14:00:00Z')
                    self.assertEqual(result['records'][0]['code'], '000001')
                    self.assertEqual(result['detail_totals']['financing_buy_minus_repayment_cny'], 10)

    def test_local_decoder_contract_with_synthetic_tables(self):
        # Test the XLS adapter contract without committing captured provider bytes.
        try:
            import xlrd
        except ImportError:
            self.skipTest('Install optional sse-margin extra for decoder-contract test')
        from unittest.mock import MagicMock
        book = MagicMock()
        book.sheet_names.return_value = ['汇总信息', '明细信息']
        sheets = []
        for rows in (self.summary, self.detail):
            sheet = MagicMock(ncols=len(rows[0]), nrows=len(rows))
            sheet.row_values.side_effect = rows
            sheet.get_rows.return_value = [[MagicMock(ctype=xlrd.XL_CELL_TEXT) for _ in row] for row in rows]
            sheets.append(sheet)
        book.sheet_by_name.side_effect = sheets
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'synthetic.xls'
            path.write_bytes(bytes.fromhex('D0CF11E0A1B11AE1') + b'\0' * 504)
            with patch('xlrd.open_workbook', return_value=book):
                result = parse_xls(path, observation_date='2026-11-06', retrieved_at='2026-11-08T14:00:00Z')
            self.assertEqual(result['source_bytes'], 512)
            self.assertEqual(len(result['source_sha256']), 64)
            book.release_resources.assert_called_once()


if __name__ == '__main__':
    unittest.main()
