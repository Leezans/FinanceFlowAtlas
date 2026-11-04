import tempfile
import unittest
from pathlib import Path
from datetime import datetime, timezone, timedelta
from financeflow.source_tic import normalize, FlowSnapshot
from financeflow.tic_service import FlowStore

# All fixture monetary values are synthetic; real network validation is separate.
RAW=(Path(__file__).parent/'fixtures/tic-table1-synthetic.tsv').read_bytes()
NOW='2026-11-04T14:30:00+00:00'
class TicTests(unittest.TestCase):
    def test_synthetic_units_sign_and_separation(self):
        s=normalize(RAW,'2026-08',NOW)
        self.assertEqual(len(s.country_flows),3)
        austria=next(x for x in s.country_flows if x.foreign_economy_iso3=='AUT')
        self.assertEqual(austria.net_foreign_purchases_usd,7_000_000)
        self.assertEqual(austria.issuer_economy_iso3,'USA')
        self.assertEqual(s.concept,'reported_net_transactions')
        self.assertNotIn('positions',s.model_dump())
        self.assertEqual(str(s.observation_release_date),'2026-10-16')
        self.assertIsNone(s.source_revision_published_at)
        self.assertEqual(s.excluded_records['aggregate_or_unmapped_geography'],1)
        self.assertEqual(s,FlowSnapshot.model_validate_json(s.model_dump_json()))
    def test_negative_and_zero_retained(self):
        s=normalize(RAW.replace(b'\t7\t13',b'\t-7\t13'),'2026-08',NOW)
        self.assertEqual(next(x for x in s.country_flows if x.foreign_economy_iso3=='AUT').net_foreign_purchases_usd,-7_000_000)
        s=normalize(RAW.replace(b'\t7\t13',b'\t0\t13'),'2026-08',NOW)
        self.assertEqual(next(x for x in s.country_flows if x.foreign_economy_iso3=='AUT').net_foreign_purchases_usd,0)
    def test_missing_is_not_zero(self):
        s=normalize(RAW.replace(b'\t7\t13',b'\tn.a.\t13'),'2026-08',NOW)
        self.assertEqual(len(s.country_flows),2)
        self.assertEqual(s.excluded_records['missing_transaction_value'],1)
    def test_bad_numeric_rejected(self):
        for value in [b'nan',b'inf',b'-inf',b'82.1',b'82*']:
            with self.subTest(value=value),self.assertRaises(ValueError):
                normalize(RAW.replace(b'\t7\t13',b'\t'+value+b'\t13'),'2026-08',NOW)
    def test_contract_changes_rejected(self):
        for raw in [RAW.replace(b'Millions of dollars',b'Billions of dollars'),RAW.replace(b'for_lt_eqty_net',b'for_lt_eqty_pos'),RAW.replace(b'Austria\t10189',b'Atlantis\t10189')]:
            with self.assertRaises(ValueError):normalize(raw,'2026-08',NOW)
    def test_duplicates_rejected(self):
        row=next(x for x in RAW.splitlines() if x.startswith(b'Austria\t'))
        with self.assertRaises(ValueError):normalize(RAW.replace(b'Definitions:',row+b'\nDefinitions:'),'2026-08',NOW)
    def test_missing_and_malformed_row_date_rejected(self):
        for date in [b'',b'2026-13',b'2026-8']:
            raw=RAW.replace(b'Austria\t10189\t2026-08',b'Austria\t10189\t'+date)
            with self.subTest(date=date),self.assertRaises(ValueError):normalize(raw,'2026-08',NOW)
    def test_truncated_table_rejected(self):
        with self.assertRaises(ValueError):normalize(RAW.replace(b'Definitions:',b''),'2026-08',NOW)
        with self.assertRaises(ValueError):normalize(b'\n'.join(x for x in RAW.splitlines() if not x.startswith(b'Grand Total\t')),'2026-08',NOW)
    def test_invalid_and_unavailable_period(self):
        for period in ['2026-13','2023-01','2026-09']:
            with self.assertRaises(ValueError):normalize(RAW,period,NOW)
    def test_release_not_guessed(self):
        s=normalize(RAW.replace(b'2026-08',b'2026-07'),'2026-07',NOW)
        self.assertIsNone(s.observation_release_date)
        self.assertIsNone(s.release_url)
    def test_version_reproducible_but_revision_sensitive(self):
        s=normalize(RAW,'2026-08',NOW)
        self.assertEqual(s.version,normalize(RAW,'2026-08','2026-11-05T00:00:00Z').version)
        self.assertNotEqual(s.version,normalize(RAW+b'\n','2026-08',NOW).version)
    def test_store_stale_failure_and_regression(self):
        with tempfile.TemporaryDirectory() as folder:
            store=FlowStore(Path(folder)/'tic.sqlite'); self.assertIsNone(store.latest())
            s=normalize(RAW,'2026-08',NOW); store.save(s)
            now=datetime.fromisoformat(NOW)
            self.assertEqual(store.status(now)['state'],'available')
            self.assertEqual(store.status(now+timedelta(hours=49))['state'],'stale')
            store.fail(NOW,'network timeout')
            self.assertEqual(store.status(now)['state'],'stale')
            self.assertEqual(store.latest(),s)
            with self.assertRaises(ValueError):store.save(normalize(RAW.replace(b'2026-08',b'2026-07'),'2026-07',NOW))
            self.assertEqual(store.latest().period,'2026-08')
if __name__=='__main__':unittest.main()
