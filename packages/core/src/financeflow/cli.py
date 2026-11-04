import argparse,time
from datetime import datetime,timezone
from .ingest import ingest
from .store import Store

def main():
    p=argparse.ArgumentParser();p.add_argument('--data-dir',default='var');p.add_argument('--period',default='2025-S2');p.add_argument('--unit-verified',action='store_true');p.add_argument('--loop',action='store_true');p.add_argument('--input');args=p.parse_args()
    while True:
        state=Store(args.data_dir+'/state.sqlite').status();due=state.get('next_due')
        if not due or state['state']=='refreshing' or datetime.fromisoformat(due)<=datetime.now(timezone.utc) or not args.loop:
            try:s=ingest(args.data_dir,args.period,args.unit_verified,args.input);print('Published',s.metadata.version,len(s.positions),'positions',flush=True)
            except Exception as e:
                print('Source refresh failed:',str(e),flush=True)
                if not args.loop:raise SystemExit(1)
                time.sleep(300)
        if not args.loop:break
        time.sleep(60)
