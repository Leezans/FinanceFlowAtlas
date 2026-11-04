import tempfile
import unittest
from datetime import datetime, timezone, timedelta
from pathlib import Path
from fastapi import FastAPI
from fastapi.testclient import TestClient
from financeflow.source_tic import normalize
from financeflow.tic_service import router, FlowStore
from test_tic import RAW

class TicApiTests(unittest.TestCase):
    def setUp(self):
        self.directory=tempfile.TemporaryDirectory()
        app=FastAPI();app.include_router(router(self.directory.name))
        self.client=TestClient(app)
        self.store=FlowStore(Path(self.directory.name)/'tic.sqlite')
    def tearDown(self):self.directory.cleanup()
    def test_empty(self):
        self.assertEqual(self.client.get('/api/v1/flows/tic').status_code,503)
        self.assertEqual(self.client.get('/api/v1/flows/tic/status').json()['state'],'unavailable')
    def test_etag_and_failed_refresh_transition(self):
        now=datetime.now(timezone.utc).isoformat()
        self.store.save(normalize(RAW,'2026-08',now))
        r=self.client.get('/api/v1/flows/tic')
        self.assertEqual(r.status_code,200)
        self.assertEqual(r.headers['x-data-status'],'available')
        self.assertEqual(self.client.get('/api/v1/flows/tic',headers={'If-None-Match':r.headers['etag']}).status_code,304)
        self.store.fail(now,'timeout')
        stale=self.client.get('/api/v1/flows/tic',headers={'If-None-Match':r.headers['etag']})
        self.assertEqual(stale.status_code,200)
        self.assertEqual(stale.headers['x-data-status'],'stale')
        self.assertIn('Warning',stale.headers)
        self.assertEqual(stale.json()['country_flows'],r.json()['country_flows'])
    def test_retrieval_metadata_changes_etag(self):
        now=datetime.now(timezone.utc)
        self.store.save(normalize(RAW,'2026-08',now.isoformat()))
        first=self.client.get('/api/v1/flows/tic')
        self.store.save(normalize(RAW,'2026-08',(now+timedelta(seconds=1)).isoformat()))
        second=self.client.get('/api/v1/flows/tic',headers={'If-None-Match':first.headers['etag']})
        self.assertEqual(second.status_code,200)
        self.assertNotEqual(first.headers['etag'],second.headers['etag'])
        self.assertNotEqual(first.json()['retrieved_at'],second.json()['retrieved_at'])
    def test_schema_separation(self):
        self.store.save(normalize(RAW,'2026-08',datetime.now(timezone.utc).isoformat()))
        body=self.client.get('/api/v1/flows/tic').json()
        self.assertEqual(body['concept'],'reported_net_transactions')
        self.assertNotIn('positions',body)
        self.assertFalse(body['is_live'])
