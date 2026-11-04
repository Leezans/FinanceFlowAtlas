"""Synthetic fixtures only. No network or real SEC data required."""
import copy
import json
import tempfile
import unittest
from pathlib import Path
from fastapi import FastAPI
from fastapi.testclient import TestClient
from financeflow.source_sec_nport import normalize
from financeflow.sec_nport_service import FundStore, validated, router

FIXTURES = Path(__file__).parent / 'fixtures'


def sample():
    return normalize((FIXTURES / 'sec-nport-submission-synthetic.tsv').read_bytes(),
                     (FIXTURES / 'sec-nport-fund-synthetic.tsv').read_bytes(),
                     report_month='2026-01', vintage='2026q1', retrieved_at='2026-04-01T00:00:00Z')


class SecServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = FundStore(Path(self.temp.name) / 'sec-nport.sqlite')
        app = FastAPI()
        app.include_router(router(self.temp.name))
        self.client = TestClient(app)

    def test_unavailable_not_synthetic_fallback(self):
        self.assertEqual(self.client.get('/api/v1/flows/sec-nport').status_code, 503)
        status = self.client.get('/api/v1/flows/sec-nport/status').json()
        self.assertEqual(status['state'], 'unavailable')
        self.assertFalse(status['is_live'])

    def test_exact_decimal_null_and_no_aggregated_claim(self):
        payload = sample()
        payload['records'][1]['sales_excluding_reinvestment_usd'] = None
        payload['records'][1]['net_external_flow_usd'] = None
        self.store.save(payload)
        response = self.client.get('/api/v1/flows/sec-nport')
        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertEqual(result['bulk_publication_frequency'], 'quarterly')
        self.assertEqual(result['snapshot']['records'][0]['net_external_flow_usd'], '60.25')
        self.assertIsNone(result['snapshot']['records'][1]['net_external_flow_usd'])
        self.assertIn('Not equity-only', result['snapshot']['limitations'])
        self.assertIsNone(result['snapshot']['observation_publication_date'])
        self.assertNotIn('country_flows', result['snapshot'])
        self.assertEqual(list(Path(self.temp.name).iterdir()), [Path(self.store.path)])

    def test_etag_failure_and_recovery(self):
        self.store.save(sample())
        initial = self.client.get('/api/v1/flows/sec-nport')
        etag = initial.headers['etag']
        self.assertEqual(self.client.get('/api/v1/flows/sec-nport', headers={'If-None-Match': etag}).status_code, 304)
        self.store.fail('2026-04-02T00:00:00+00:00')
        stale = self.client.get('/api/v1/flows/sec-nport', headers={'If-None-Match': etag})
        self.assertEqual(stale.status_code, 200)
        self.assertEqual(stale.json()['status'], 'stale')
        self.assertIn('warning', stale.headers)
        self.assertNotEqual(stale.headers['etag'], etag)
        self.store.save(sample())
        self.assertEqual(self.store.status()['state'], 'available')

    def test_reject_invalid_without_overwrite(self):
        previous = self.store.save(sample()).version
        for change in ['net', 'duplicate', 'fund_count', 'source', 'hash', 'period', 'flags', 'extra', 'publication', 'missing', 'filing']:
            bad = sample()
            if change == 'net': bad['records'][0]['net_external_flow_usd'] = '999'
            elif change == 'duplicate': bad['records'][1] = copy.deepcopy(bad['records'][0])
            elif change == 'fund_count': bad['fund_count'] = 2
            elif change == 'source': bad['source_url'] = 'https://example.com'
            elif change == 'hash': bad['raw_member_sha256']['SUBMISSION.tsv'] = 'bad'
            elif change == 'period': bad['records'][0]['period'] = '2026-01'
            elif change == 'flags': bad['records'][0]['quality_flags'] = ['negative_reported_gross_flow']
            elif change == 'extra': bad['sector_flows'] = []
            elif change == 'publication': bad['observation_publication_date'] = '2026-04-01'
            elif change == 'missing': bad['records'][0]['sales_excluding_reinvestment_usd'] = None
            elif change == 'filing': bad['records'][1]['accession_number'] = '0000000001-26-000002'
            with self.subTest(change=change), self.assertRaises(ValueError): self.store.save(bad)
            self.assertEqual(self.store.latest().version, previous)

    def test_fixed_point_adapter_ingestion(self):
        sub = (FIXTURES / 'sec-nport-submission-synthetic.tsv').read_bytes()
        fund = (FIXTURES / 'sec-nport-fund-synthetic.tsv').read_bytes()
        for amount in [b'0.000000000001', b'0.000000000000']:
            raw = fund.replace(b'100.25', amount).replace(b'40', b'0.000000000000')
            payload = normalize(sub, raw, report_month='2026-01', vintage='2026q1', retrieved_at='2026-04-01T00:00:00Z')
            self.store.save(payload)
            self.assertEqual(self.store.latest().records[0].net_external_flow_usd, amount.decode())
    def test_cross_series_accession_rejected_preserves_store(self):
        payload = sample()
        previous = self.store.save(payload).version
        extra = copy.deepcopy(payload['records'])
        for row in extra:
            row['series_id'] = 'S000000002'
            row['series_name'] = 'OTHER SYNTHETIC FUND'
        payload['records'].extend(extra)
        payload['fund_count'] = 2
        with self.assertRaisesRegex(ValueError, 'multiple fund series'):
            self.store.save(payload)
        self.assertEqual(self.store.latest().version, previous)

    def test_mutated_model_revalidated(self):
        model = validated(sample())
        model.records[0].net_external_flow_usd = '8'
        with self.assertRaises(ValueError): self.store.save(model)

    def test_refuse_regression(self):
        new = sample()
        new['bulk_vintage'] = '2026q2'
        new['source_url'] = new['source_url'].replace('2026q1', '2026q2')
        self.store.save(new)
        with self.assertRaisesRegex(ValueError, 'regress'): self.store.save(sample())
        self.assertEqual(self.store.latest().bulk_vintage, '2026q2')

    def test_corruption_is_not_served(self):
        good = self.store.save(sample())
        bad = good.model_dump()
        bad['records'][0]['net_external_flow_usd'] = '123'
        with self.store.connect() as db:
            db.execute('UPDATE snapshots SET payload=?', (json.dumps(bad),))
        self.assertEqual(self.client.get('/api/v1/flows/sec-nport').status_code, 503)
        self.assertEqual(self.store.status()['state'], 'unavailable')

    def test_valid_but_changed_payload_fails_integrity(self):
        good = self.store.save(sample())
        bad = good.model_dump()
        for row in bad['records']: row['series_name'] = 'Changed'
        with self.store.connect() as db:
            db.execute('UPDATE snapshots SET payload=?', (json.dumps(bad),))
        self.assertEqual(self.client.get('/api/v1/flows/sec-nport').status_code, 503)

    def test_large_decimal_exact(self):
        payload = sample()
        payload['records'][0]['sales_excluding_reinvestment_usd'] = '999999999999999999999999.123456789012'
        payload['records'][0]['net_external_flow_usd'] = '999999999999999999999959.123456789012'
        self.store.save(payload)
        self.assertEqual(self.store.latest().records[0].net_external_flow_usd, payload['records'][0]['net_external_flow_usd'])


if __name__ == '__main__': unittest.main()
