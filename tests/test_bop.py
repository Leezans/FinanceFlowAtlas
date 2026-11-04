"""All fixtures here are synthetic, not redistributed provider observations."""
import hashlib
import tempfile
import unittest
from datetime import datetime, timezone, timedelta
from pathlib import Path
from fastapi import FastAPI
from fastapi.testclient import TestClient
from financeflow.source_bop import normalize, source_url, UnitEvidence
from financeflow.bop_service import BopStore, router

NOW = datetime.now(timezone.utc).isoformat()


def fixture(value='-12.50', **overrides):
    row = dict(COUNTRY='USA', BOP_ACCOUNTING_ENTRY='A_NFA_T', INDICATOR='P_F51', UNIT='USD',
               FREQUENCY='Q', SCALE='6', METHODOLOGY='BPM6')
    row.update(overrides)
    attrs = ' '.join(f'{key}="{val}"' for key, val in row.items())
    return (f'<message:StructureSpecificData xmlns:message="http://www.sdmx.org/resources/sdmxml/schemas/v2_1/message">'
        f'<message:Header><Ref agencyID="IMF.STA" id="BOP" version="21.0.0"/></message:Header>'
        f'<message:DataSet PUBLICATION_DATE="2026-10-01T00:00:00Z" UPDATE_DATE="2026-10-01T00:00:00Z">'
        f'<Series {attrs}><Obs TIME_PERIOD="2026-Q2" OBS_VALUE="{value}" ACCESS_SHARING_LEVEL="PUBLIC_OPEN" '
        f'SECURITY_CLASSIFICATION="PUB"/></Series></message:DataSet></message:StructureSpecificData>').encode()


def evidence(raw):
    return UnitEvidence(raw_sha256=hashlib.sha256(raw).hexdigest(), indicator='P_F51', factor_to_usd='1',
        official_reference_url='https://data.imf.org/Datasets/BOP', reconciliation_note='Synthetic unit test only, not real reconciliation')


class BopTests(unittest.TestCase):
    def test_raw_values_are_not_blindly_scaled(self):
        raw = fixture()
        result = normalize(raw, '2026-Q2', NOW)
        self.assertEqual(result.unit_status, 'review_required')
        self.assertIsNone(result.facts[0].value_usd)
        self.assertEqual(result.facts[0].source_value, '-12.50')
        self.assertEqual(result.facts[0].negative_means, 'resident_net_disposal_abroad_inflow')
        verified = normalize(raw, '2026-Q2', NOW, unit_evidence=evidence(raw))
        self.assertEqual(verified.facts[0].value_usd, '-12.50')
        self.assertNotEqual(verified.version, result.version)

    def test_liability_zero_and_broad_indicator(self):
        result = normalize(fixture('0', BOP_ACCOUNTING_ENTRY='L_NIL_T', INDICATOR='P_F5'), '2026-Q2', NOW, 'P_F5')
        self.assertIn('investment fund', result.indicator_label)
        self.assertEqual(result.facts[0].source_value, '0')
        self.assertIn('inflow', result.facts[0].positive_means)
        self.assertEqual(result.reporting_economy_count, 1)
        self.assertEqual(result.both_directions_economy_count, 0)

    def test_fail_closed(self):
        cases = [fixture(SCALE='3'), fixture(UNIT='EUR'), fixture(METHODOLOGY='BPM5'),
                 fixture('NaN'), fixture('Infinity'), fixture(''), fixture(COUNTRY='G163'),
                 fixture(COUNTRY='CWX'), fixture(FREQUENCY='A'),
                 fixture().replace(b'PUBLIC_OPEN', b'CONFIDENTIAL'),
                 fixture().replace(b'SECURITY_CLASSIFICATION="PUB"', b'SECURITY_CLASSIFICATION="PUB" OBS_STATUS="C"'),
                 fixture().replace(b'21.0.0', b'22.0.0')]
        for raw in cases:
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                normalize(raw, '2026-Q2', NOW)
        raw = fixture()
        series = raw[raw.index(b'<Series'):raw.index(b'</Series>') + 9]
        with self.assertRaises(ValueError):
            normalize(raw.replace(b'</message:DataSet>', series+b'</message:DataSet>'), '2026-Q2', NOW)
        with self.assertRaises(ValueError):
            normalize(raw, '2026-Q2', NOW, unit_evidence=evidence(fixture('99')))
        for period in ['2026-Q5', '2026-01', '../2026', '2026&x=y']:
            with self.assertRaises(ValueError): source_url(period)

    def test_api_storage_separation_and_failed_refresh(self):
        with tempfile.TemporaryDirectory() as folder:
            app = FastAPI(); app.include_router(router(folder)); client = TestClient(app)
            path = '/api/v1/flows/bop?period=2026-Q2'
            self.assertEqual(client.get(path).status_code, 503)
            self.assertEqual(client.get('/api/v1/flows/bop?period=bad').status_code, 422)
            store = BopStore(Path(folder) / 'bop.sqlite')
            result = normalize(fixture(), '2026-Q2', NOW); store.save(result)
            response = client.get(path)
            self.assertEqual(response.status_code, 200)
            self.assertIsNone(response.json()['facts'][0]['value_usd'])
            self.assertEqual(client.get(path, headers={'If-None-Match':response.headers['etag']}).status_code, 304)
            store.fail('2026-Q2', 'P_F51', NOW, 'NetworkFailure')
            stale = client.get(path, headers={'If-None-Match':response.headers['etag']})
            self.assertEqual(stale.status_code, 200)
            self.assertEqual(stale.headers['x-data-status'], 'stale')
            self.assertEqual(client.get(path+'&indicator=P_F5').status_code, 503)
            self.assertEqual(list(Path(folder).iterdir()), [Path(folder)/'bop.sqlite'])
            older = result.model_copy(update={'retrieved_at':(datetime.now(timezone.utc)-timedelta(days=1)).isoformat()})
            with self.assertRaises(ValueError): store.save(older)
            self.assertEqual(store.get('2026-Q2', 'P_F51').retrieved_at, NOW)

    def test_exact_decimal_and_bounded_exponents(self):
        from financeflow.source_bop import exact_amount
        value = '123456789012345678901234567890.1234'
        self.assertEqual(exact_amount(value), value)
        self.assertEqual(exact_amount(value, '1000000'), '123456789012345678901234567890123400.0000')
        raw = fixture(value)
        self.assertEqual(normalize(raw, '2026-Q2', NOW, unit_evidence=evidence(raw)).facts[0].value_usd, value)
        for value in ['1e999', '1e-999', '1'*129, 'NaN', 'Infinity']:
            with self.assertRaises(ValueError): exact_amount(value)

    def test_model_and_store_reject_semantic_corruption(self):
        from financeflow.source_bop import BopSnapshot
        original = normalize(fixture(), '2026-Q2', NOW)
        mutations = [dict(unit_status='verified'), dict(reporting_economy_count=999),
            dict(version='bad'), dict(facts=original.facts*2)]
        for field, val in [('reporter_iso3','XXX'),('period','2025-Q2'),('value_usd','999'),
                           ('source_value','999'),('positive_means','wrong'),('direction','wrong')]:
            mutations.append({'facts':[original.facts[0].model_copy(update={field:val})]})
        with tempfile.TemporaryDirectory() as folder:
            store = BopStore(Path(folder)/'bop.sqlite')
            for change in mutations:
                corrupt = original.model_copy(update=change)
                with self.assertRaises(ValueError): BopSnapshot.model_validate(corrupt.model_dump())
                with self.assertRaises(ValueError): store.save(corrupt)
            store.save(original)
            with store.connect() as db:
                payload = original.model_copy(update={'reporting_economy_count':999}).model_dump_json()
                db.execute('UPDATE bop_snapshots SET payload=?',(payload,))
            with self.assertRaises(ValueError): store.get('2026-Q2','P_F51')

    def test_fetch_guard_no_redirect_or_retry(self):
        from unittest.mock import MagicMock, patch
        from urllib.error import HTTPError
        from financeflow.bop_service import fetch_response, NoRedirect
        from financeflow.source_bop import MAX_BYTES
        url = source_url('2026-Q2')
        response = MagicMock(); response.__enter__.return_value = response
        response.status=200; response.geturl.return_value=url; response.read.return_value=b'xml'
        with patch('financeflow.bop_service.build_opener') as build:
            build.return_value.open.return_value=response
            self.assertEqual(fetch_response(url), b'xml')
            self.assertEqual(build.return_value.open.call_args.kwargs['timeout'], 90)
            response.read.assert_called_with(MAX_BYTES+1)
            response.status=403
            with self.assertRaises(ValueError): fetch_response(url)
            response.status=200; response.geturl.return_value='https://evil.invalid/'
            with self.assertRaises(ValueError): fetch_response(url)
            response.geturl.return_value=url; response.read.return_value=b'x'*(MAX_BYTES+1)
            with self.assertRaises(ValueError): fetch_response(url)
        for code in [403,429]:
            with patch('financeflow.bop_service.build_opener') as build:
                build.return_value.open.side_effect=HTTPError(url,code,'denied',{},None)
                with self.assertRaises(HTTPError): fetch_response(url)
                self.assertEqual(build.return_value.open.call_count,1)
        with self.assertRaises(ValueError): NoRedirect().redirect_request(None,None,302,'',{},'https://evil.invalid/')

    def test_non_utf8_and_entities_rejected(self):
        text = '<!DOCTYPE data [<!ENTITY example "-12.50">]>' + fixture().decode().replace('OBS_VALUE="-12.50"', 'OBS_VALUE="&example;"')
        for encoding in ['utf-8', 'utf-16', 'utf-16-le', 'utf-16-be', 'utf-32']:
            with self.subTest(encoding=encoding), self.assertRaises(ValueError):
                normalize(text.encode(encoding), '2026-Q2', NOW)
        with self.assertRaises(ValueError):
            normalize(fixture().decode().encode('utf-16'), '2026-Q2', NOW)

    def test_save_locks_before_reading_revision(self):
        import sqlite3
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as folder:
            store = BopStore(Path(folder)/'bop.sqlite')
            statements = []
            def traced_connection():
                connection = sqlite3.connect(store.path)
                connection.set_trace_callback(statements.append)
                return connection
            with patch.object(store, 'connect', side_effect=traced_connection):
                store.save(normalize(fixture(), '2026-Q2', NOW))
            self.assertEqual(statements[0], 'BEGIN IMMEDIATE')
            self.assertTrue(statements[1].startswith('SELECT'))
            self.assertEqual(statements[-1], 'COMMIT')


if __name__ == '__main__': unittest.main()
