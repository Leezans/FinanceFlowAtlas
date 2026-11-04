import tempfile,unittest
from pathlib import Path
from fastapi.testclient import TestClient
import apps.api.main as api
from financeflow.store import Store
from test_core import fixture
from financeflow.source_imf import normalize
class ApiTests(unittest.TestCase):
 def setUp(self):
  self.d=tempfile.TemporaryDirectory();api.store=Store(Path(self.d.name)/'state.sqlite');self.c=TestClient(api.app)
 def tearDown(self):self.d.cleanup()
 def test_empty_api_exposes_global_registry(self):
  self.assertEqual(self.c.get('/api/v1/snapshot').status_code,503)
  self.assertEqual(len(self.c.get('/api/v1/countries').json()),249)
  self.assertEqual(self.c.get('/api/v1/status').json()['state'],'empty')
 def test_etag_unchanged(self):
  api.store.publish(normalize(fixture(),'2000-S2','2001-01-11T00:00:00Z',True));r=self.c.get('/api/v1/snapshot');self.assertEqual(r.status_code,200)
  self.assertEqual(self.c.get('/api/v1/snapshot',headers={'If-None-Match':r.headers['etag']}).status_code,304)
 def test_failed_refresh_status_distinct(self):
  api.store.publish(normalize(fixture(),'2000-S2','2001-01-11T00:00:00Z',True));api.store.update_status(state='error',error='upstream unavailable')
  self.assertEqual(self.c.get('/api/v1/status').json()['state'],'error');self.assertEqual(self.c.get('/api/v1/snapshot').status_code,200)
