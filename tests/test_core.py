import csv,io,tempfile,unittest,math,json
from pathlib import Path
from unittest.mock import patch
from financeflow.source_imf import normalize,source_url
from financeflow.store import Store
from financeflow.ingest import ingest

def fixture(**changes):
 r=dict(COUNTRY='USA',COUNTERPART_COUNTRY='JPN',INDICATOR='P_F51_P_USD',ACCOUNTING_ENTRY='A',SECTOR='S1',COUNTERPART_SECTOR='S1',FREQUENCY='S',TIME_PERIOD='2000-S2',UNIT='USD',SCALE='6',STATUS='',OBS_VALUE='100',PUBLICATION_DATE='2001-01-10T00:00:00Z');r.update(changes)
 o=io.StringIO();w=csv.DictWriter(o,fieldnames=r);w.writeheader();w.writerow(r);return o.getvalue().encode()
class CoreTests(unittest.TestCase):
 def n(self,raw=None):return normalize(raw or fixture(),'2000-S2','2001-01-11T00:00:00Z',True)
 def test_registry_complete(self):
  s=self.n();self.assertEqual(len(s.countries),249);self.assertEqual(len({c.iso3 for c in s.countries}),249)
 def test_unit_gated(self):
  with self.assertRaises(ValueError):normalize(fixture(),'2000-S2','x',False)
 def test_no_scale_multiplication(self):self.assertEqual(self.n().positions[0].value_usd,100)
 def test_zero_not_missing(self):self.assertEqual(self.n(fixture(OBS_VALUE='0')).positions[0].value_usd,0)
 def test_missing_rejected(self):
  with self.assertRaises(ValueError):self.n(fixture(OBS_VALUE=''))
 def test_non_iso_aggregate_excluded(self):
  with self.assertRaises(ValueError):self.n(fixture(COUNTERPART_COUNTRY='G001'))
 def test_total_not_equity(self):
  with self.assertRaises(ValueError):self.n(fixture(INDICATOR='P_TOTINV_P_USD'))
 def test_sector_not_double_counted(self):
  with self.assertRaises(ValueError):self.n(fixture(SECTOR='S12'))
 def test_duplicate_rejected(self):
  raw=fixture();raw+=raw.split(b'\n')[1]+b'\n'
  with self.assertRaises(ValueError):self.n(raw)
 def test_nonfinite_rejected(self):
  for value in ['NaN','inf','-1']:
   with self.assertRaises(ValueError):self.n(fixture(OBS_VALUE=value))
 def test_invalid_period(self):
  with self.assertRaises(ValueError):source_url('../escape')
 def test_atomic_publish_restart(self):
  with tempfile.TemporaryDirectory() as d:
   st=Store(Path(d)/'x.sqlite');self.assertIsNone(st.latest());s=self.n();st.publish(s);restored=Store(Path(d)/'x.sqlite').latest();self.assertEqual(restored.positions[0].value_usd,100)
 def test_failure_preserves_last_good(self):
  with tempfile.TemporaryDirectory() as d:
   path=Path(d)/'good.csv';path.write_bytes(fixture());s=ingest(d,'2000-S2',True,path);path.write_bytes(b'broken')
   with self.assertRaises(ValueError):ingest(d,'2000-S2',True,path)
   st=Store(Path(d)/'state.sqlite');self.assertEqual(st.status()['state'],'error');self.assertEqual(st.latest().metadata.version,s.metadata.version)
 def test_adapter_version_changes_snapshot_identity(self):
  s=self.n()
  with patch('financeflow.source_imf.ADAPTER_VERSION','new-contract'):different=self.n()
  self.assertNotEqual(s.metadata.version,different.metadata.version)
 def test_overdue_source_check_marked_stale(self):
  with tempfile.TemporaryDirectory() as d:
   st=Store(Path(d)/'state.sqlite');st.publish(self.n());st.update_status(next_due='2000-01-01T00:00:00+00:00')
   self.assertEqual(st.status()['state'],'stale');self.assertIsNotNone(st.latest())
 def test_negative_excluded_with_evidence(self):
  raw=fixture();row=fixture(COUNTERPART_COUNTRY='CAN',OBS_VALUE='-5').split(b'\n')[1]+b'\n';s=self.n(raw+row)
  self.assertEqual(s.metadata.excluded_records['negative_position_not_supported'],1)
  self.assertEqual(s.metadata.excluded_examples['negative_position_not_supported'][0]['OBS_VALUE'],'-5')
 def test_mixed_negative_infinity_fails_closed(self):
  raw=fixture()+fixture(COUNTERPART_COUNTRY='CAN',OBS_VALUE='-inf').split(b'\n')[1]+b'\n'
  with self.assertRaises(ValueError):self.n(raw)
if __name__=='__main__':unittest.main()
