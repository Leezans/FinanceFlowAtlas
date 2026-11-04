import hashlib,os,urllib.request,fcntl
from datetime import datetime,timezone,timedelta
from pathlib import Path
from .source_imf import source_url,normalize
from .store import Store

def _ingest(root,period,verified=False,local=None):
    root=Path(root);store=Store(root/'state.sqlite');store.update_status(state='refreshing',last_attempt=datetime.now(timezone.utc).isoformat(),error=None)
    try:
        if local:raw=Path(local).read_bytes()
        else:
            with urllib.request.urlopen(urllib.request.Request(source_url(period),headers={'Accept':'text/csv','User-Agent':'FinanceFlowAtlas/0.2'}),timeout=90) as response:
                raw=response.read(100*1024*1024+1)
            if len(raw)>100*1024*1024:raise ValueError('Source exceeds ingestion size budget')
        digest=hashlib.sha256(raw).hexdigest();rawdir=root/'raw';rawdir.mkdir(parents=True,exist_ok=True)
        dest=rawdir/(digest+'.csv')
        if not dest.exists():
            tmp=dest.with_suffix('.tmp');tmp.write_bytes(raw);os.replace(tmp,dest)
        snapshot=normalize(raw,period,datetime.now(timezone.utc).isoformat(),verified)
        store.publish(snapshot);return snapshot
    except Exception as e:
        store.update_status(state='error',error=str(e),next_due=(datetime.now(timezone.utc)+timedelta(minutes=5)).isoformat());raise

def ingest(root,period,verified=False,local=None):
    root=Path(root);root.mkdir(parents=True,exist_ok=True)
    with (root/'ingestion.lock').open('a') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise RuntimeError('Another ingestion is active; no duplicate source request')
        try:return _ingest(root,period,verified,local)
        finally:fcntl.flock(lock,fcntl.LOCK_UN)
