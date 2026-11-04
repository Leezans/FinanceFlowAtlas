import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from financeflow.sec_nport_refresh import refresh
from financeflow.sec_nport_service import FundStore

FIXTURES = Path(__file__).parent / 'fixtures'


class RefreshTests(unittest.TestCase):
    def test_network_is_opt_in_and_identity_required(self):
        with tempfile.TemporaryDirectory() as directory, patch('financeflow.sec_nport_refresh.fetch') as fetch:
            for kwargs in ({}, {'download': True}, {'user_agent': 'app contact@example.org'}):
                with self.assertRaises(ValueError):
                    refresh(vintage='2026q3', report_month='2026-01', data_dir=directory, **kwargs)
            fetch.assert_not_called()
            self.assertFalse((Path(directory) / 'sec-nport.sqlite').exists())

    def test_download_publish_and_failure_preserves_last_good(self):
        members = {'SUBMISSION.tsv': (FIXTURES / 'sec-nport-submission-synthetic.tsv').read_bytes(),
                   'FUND_REPORTED_INFO.tsv': (FIXTURES / 'sec-nport-fund-synthetic.tsv').read_bytes()}
        with tempfile.TemporaryDirectory() as directory, patch('financeflow.sec_nport_refresh.fetch') as fetch:
            fetch.return_value = members, {'source_http_last_modified': 'fixture only'}
            kwargs = dict(vintage='2026q3', report_month='2026-01', data_dir=directory,
                          download=True, user_agent='Synthetic test contact@example.org, mocked never transmitted')
            snapshot = refresh(**kwargs)
            store = FundStore(Path(directory) / 'sec-nport.sqlite')
            self.assertEqual(store.latest().version, snapshot.version)
            self.assertEqual(snapshot.source_http_last_modified, 'fixture only')
            fetch.side_effect = ValueError('private upstream detail')
            with self.assertRaises(ValueError):
                refresh(**kwargs)
            self.assertEqual(store.latest().version, snapshot.version)
            self.assertEqual(store.status()['state'], 'stale')

    def test_invalid_parameters_never_fetch_or_create_database(self):
        with tempfile.TemporaryDirectory() as directory, patch('financeflow.sec_nport_refresh.fetch') as fetch:
            base = dict(vintage='2026q3', report_month='2026-01', data_dir=directory,
                        download=True, user_agent='Synthetic test contact@example.org')
            for change in ({'vintage': '2026q5'}, {'vintage': '../2026q3'},
                           {'report_month': '2026-13'}, {'report_month': '2026-1'},
                           {'user_agent': 'no contact'}, {'user_agent': 'a@b\nInjected: true'}):
                with self.subTest(change=change), self.assertRaises(ValueError):
                    refresh(**{**base, **change})
            fetch.assert_not_called()
            self.assertFalse((Path(directory) / 'sec-nport.sqlite').exists())

    def test_store_locks_before_comparing_current_snapshot(self):
        import sqlite3
        from financeflow.source_sec_nport import normalize
        payload = normalize(
            (FIXTURES / 'sec-nport-submission-synthetic.tsv').read_bytes(),
            (FIXTURES / 'sec-nport-fund-synthetic.tsv').read_bytes(),
            report_month='2026-01', vintage='2026q3', retrieved_at='2026-11-04T16:00:00+00:00')
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'sec-nport.sqlite'
            store = FundStore(path)
            statements = []
            def traced_connect():
                db = sqlite3.connect(path, timeout=30)
                db.set_trace_callback(statements.append)
                return db
            with patch.object(store, 'connect', traced_connect):
                store.save(payload)
            statements = [s.strip().upper() for s in statements]
            self.assertEqual(statements[0], 'BEGIN IMMEDIATE')
            self.assertTrue(statements[1].startswith('SELECT S.REPORT_MONTH'))
            self.assertEqual(statements[-1], 'COMMIT')
