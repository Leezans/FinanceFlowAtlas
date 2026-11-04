import hashlib,json,sqlite3
from pathlib import Path
from datetime import datetime,timezone,timedelta
from .contracts import Snapshot
class Store:
    def __init__(self,path):
        self.path=Path(path);self.path.parent.mkdir(parents=True,exist_ok=True)
        with self.connect() as c:
            c.execute('CREATE TABLE IF NOT EXISTS snapshots(version TEXT PRIMARY KEY, created_at TEXT NOT NULL, payload TEXT NOT NULL)')
            c.execute('CREATE TABLE IF NOT EXISTS state(id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL)')
    def connect(self):
        c=sqlite3.connect(self.path,timeout=30);c.execute('PRAGMA journal_mode=WAL');return c
    def status(self):
        with self.connect() as c:r=c.execute('SELECT payload FROM state WHERE id=1').fetchone()
        status=json.loads(r[0]) if r else dict(state='empty',last_attempt=None,last_success=None,next_due=None,error=None,snapshot_version=None)
        if status['state']=='ready' and status.get('next_due') and datetime.fromisoformat(status['next_due'])<datetime.now(timezone.utc):
            status['state']='stale'
            status['error']='Scheduled source check overdue; last validated snapshot retained'
        return status
    def update_status(self,**values):
        status=self.status();status.update(values)
        with self.connect() as c:c.execute('INSERT OR REPLACE INTO state VALUES(1,?)',(json.dumps(status),))
    def publish(self,snapshot:Snapshot):
        now=datetime.now(timezone.utc).isoformat(); payload=snapshot.model_dump_json()
        with self.connect() as c:
            c.execute('INSERT OR IGNORE INTO snapshots VALUES(?,?,?)',(snapshot.metadata.version,now,payload))
            old=self.status();old.update(state='ready',last_success=now,next_due=(datetime.now(timezone.utc)+timedelta(days=1)).isoformat(),error=None,snapshot_version=snapshot.metadata.version)
            c.execute('INSERT OR REPLACE INTO state VALUES(1,?)',(json.dumps(old),))
    def latest(self):
        status=self.status();version=status.get('snapshot_version')
        if not version:return None
        with self.connect() as c:r=c.execute('SELECT payload FROM snapshots WHERE version=?',(version,)).fetchone()
        return Snapshot.model_validate_json(r[0]) if r else None
