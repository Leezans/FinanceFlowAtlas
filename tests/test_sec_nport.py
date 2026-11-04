import io
import unittest
import zipfile
import itertools
import urllib.error
from unittest.mock import patch
from pathlib import Path
from financeflow.source_sec_nport import normalize, FLOW_FIELDS
from financeflow.sec_nport_download import fetch, _Ranges, _NoRedirect

FIXTURES = Path(__file__).parent / 'fixtures'
SUB = (FIXTURES / 'sec-nport-submission-synthetic.tsv').read_bytes()
FUND = (FIXTURES / 'sec-nport-fund-synthetic.tsv').read_bytes()

def run(sub=SUB, fund=FUND, **kwargs):
    return normalize(sub, fund, report_month='2026-01', vintage='2026q1',
                     retrieved_at='2026-04-01T00:00:00Z', **kwargs)

class SecNportTests(unittest.TestCase):
    def test_units_sign_reinvestment_months(self):
        s = run(); rows = s['records']
        self.assertEqual([r['period'] for r in rows], ['2025-11','2025-12','2026-01'])
        self.assertEqual([r['net_external_flow_usd'] for r in rows], ['60.25','-5','0'])
        self.assertEqual(rows[0]['reinvestment_usd'], '999')
        self.assertIsNone(s['observation_publication_date'])
        self.assertFalse(s['is_live'])
    def test_large_decimal_precision(self):
        s = run(fund=FUND.replace(b'100.25', b'123456789012345678901234.123456789012'))
        self.assertEqual(s['records'][0]['net_external_flow_usd'], '123456789012345678901194.123456789012')
    def test_fixed_point_small_and_zero(self):
        for value in (b'0.000000000001', b'0.000000000000'):
            raw = FUND.replace(b'100.25', value).replace(b'999', value).replace(b'40', b'0.000000000000')
            row = run(fund=raw)['records'][0]
            self.assertEqual(row['sales_excluding_reinvestment_usd'], value.decode())
            self.assertEqual(row['reinvestment_usd'], value.decode())
            self.assertEqual(row['redemptions_usd'], '0.000000000000')
            self.assertEqual(row['net_external_flow_usd'], value.decode())
    def test_missing_not_zero(self):
        s = run(fund=FUND.replace(b'100.25', b''))
        self.assertIsNone(s['records'][0]['net_external_flow_usd'])
    def test_negative_gross_flagged(self):
        s = run(fund=FUND.replace(b'100.25', b'-.25'))
        self.assertEqual(s['records'][0]['quality_flags'], ['negative_reported_gross_flow'])
        self.assertEqual(s['records'][0]['net_external_flow_usd'], '-40.25')
    def test_invalid_schema_numeric_join(self):
        for f in [FUND.replace(b'SALES_FLOW_MON1',b'ASSETS'), FUND.replace(b'100.25',b'NaN'),
                  FUND.replace(b'100.25',b'1e6'), FUND.replace(b'0000000001-26-000001',b'0000000002-26-000001')]:
            with self.subTest(f=f), self.assertRaises(ValueError): run(fund=f)
    def test_duplicate_accession(self):
        with self.assertRaises(ValueError): run(fund=FUND+FUND.splitlines(keepends=True)[1])
    def test_latest_amendment_and_same_day_ambiguity(self):
        sub2 = SUB.splitlines(keepends=True)[1].replace(b'-26-000001',b'-26-000002').replace(b'01-MAR',b'02-MAR').replace(b'NPORT-P',b'NPORT-P/A')
        fund2 = FUND.splitlines(keepends=True)[1].replace(b'-26-000001',b'-26-000002').replace(b'100.25',b'200.25')
        s = run(SUB+sub2, FUND+fund2)
        self.assertEqual(s['records'][0]['net_external_flow_usd'], '160.25')
        self.assertEqual(s['excluded_records']['superseded_in_vintage'],1)
        with self.assertRaisesRegex(ValueError,'No eligible'):
            run(SUB+sub2.replace(b'02-MAR',b'01-MAR'),FUND+fund2)
    def test_bounded_range_fetch_crc(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as z:
            z.writestr('SUBMISSION.tsv',SUB); z.writestr('FUND_REPORTED_INFO.tsv',FUND)
        raw = buffer.getvalue()
        class Response(io.BytesIO):
            def geturl(self): return 'https://www.sec.gov/files/dera/data/form-n-port-data-sets/2026q1_nport.zip'
        def open_mock(request, timeout):
            if request.method == 'HEAD':
                response = Response(); response.status=200
                response.headers={'Content-Length':str(len(raw)), 'Last-Modified':'Wed, 07 Oct 2026 16:13:21 GMT'}
            else:
                start,end=map(int,request.headers['Range'][6:].split('-'))
                response=Response(raw[start:end+1]);response.status=206
                response.headers={'Content-Range':f'bytes {start}-{end}/{len(raw)}','Last-Modified':'Wed, 07 Oct 2026 16:13:21 GMT'}
            return response
        with patch('urllib.request.OpenerDirector.open',side_effect=open_mock), patch('time.sleep'):
            files, meta=fetch('2026q1','SyntheticTest test@example.invalid')
        self.assertEqual(files['FUND_REPORTED_INFO.tsv'],FUND)
        self.assertLess(meta['requests'],20)
    def test_amendment_order_independence(self):
        subrows = []; fundrows = []
        for index, day in [(1, '01'), (2, '01'), (3, '02')]:
            suffix = f'-26-{index:06}'.encode()
            subrows.append(SUB.splitlines(keepends=True)[1].replace(b'-26-000001', suffix).replace(b'01-MAR', day.encode()+b'-MAR'))
            fundrows.append(FUND.splitlines(keepends=True)[1].replace(b'-26-000001', suffix))
        for ordering in itertools.permutations(range(3)):
            with self.subTest(ordering=ordering), self.assertRaisesRegex(ValueError, 'No eligible'):
                run(SUB.splitlines(keepends=True)[0]+b''.join(subrows), FUND.splitlines(keepends=True)[0]+b''.join(fundrows[i] for i in ordering))
    def test_decimal_schema_limits(self):
        for value in [b'9'*100+b'.25', b'9'*25, b'.1234567890123']:
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, 'NUMBER'):
                run(fund=FUND.replace(b'100.25', value))
    def test_range_fail_closed(self):
        url = 'https://www.sec.gov/test.zip'
        modified = 'Wed, 07 Oct 2026 16:13:21 GMT'
        class Response(io.BytesIO):
            def geturl(self): return self.url
        def response(status=200, headers=None, data=b'', target=url):
            r = Response(data); r.status=status; r.headers=headers or {}; r.url=target; return r
        cases = [
            (response(headers={'Content-Length':'100'}), None, ValueError),
            (response(headers={'Content-Length':'100','Last-Modified':'not-a-date'}), None, ValueError),
            (response(headers={'Content-Length':'100','Last-Modified':modified}, target='https://other.test/x'), None, ValueError),
        ]
        for status, headers, data in [
            (200, {'Last-Modified':modified}, b'xx'),
            (206, {'Last-Modified':modified,'Content-Range':'bytes 0-1/100'}, b'x'),
            (206, {'Last-Modified':'Thu, 08 Oct 2026 16:13:21 GMT','Content-Range':'bytes 0-1/100'}, b'xx'),
            (206, {'Content-Range':'bytes 0-1/100'}, b'xx')]:
            cases.append((response(headers={'Content-Length':'100','Last-Modified':modified}), response(status,headers,data), ValueError))
        for head, body, error in cases:
            with patch('urllib.request.OpenerDirector.open', side_effect=[head,body]), patch('time.sleep'), self.assertRaises(error):
                remote=_Ranges(url,'Test a@example.invalid');remote.read(2)
        for status in (403,429):
            with patch('urllib.request.OpenerDirector.open',side_effect=urllib.error.HTTPError(url,status,'blocked',{},None)) as mocked, patch('time.sleep'), self.assertRaises(urllib.error.HTTPError):
                _Ranges(url,'Test a@example.invalid')
            self.assertEqual(mocked.call_count,1)
        with self.assertRaisesRegex(ValueError,'redirects'):
            _NoRedirect().redirect_request(None,None,302,'redirect',{},'https://other.test')
    def test_strong_etag_if_range(self):
        url='https://www.sec.gov/test.zip'
        class Response(io.BytesIO):
            def geturl(self): return url
        head=Response();head.headers={'Content-Length':'100','ETag':'"v1"'}
        body=Response(b'xx');body.status=206;body.headers={'ETag':'"v1"','Content-Range':'bytes 0-1/100'}
        with patch('urllib.request.OpenerDirector.open',side_effect=[head,body]) as mocked, patch('time.sleep'):
            self.assertEqual(_Ranges(url,'Test a@example.invalid').read(2),b'xx')
        self.assertEqual(mocked.call_args_list[1].args[0].get_header('If-range'),'"v1"')
    def test_download_identity_and_vintage(self):
        for vintage,ua in [('2026q5','a@b.test'),('2026q1','anonymous')]:
            with self.assertRaises(ValueError):fetch(vintage,ua)

if __name__ == '__main__': unittest.main()
