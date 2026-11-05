import {afterEach,beforeEach,test,expect,vi} from 'vitest';
import {createAshareHandler} from '../lib/ashare/ashare';
import {FIELDS,parseScope,type Snapshot} from '../lib/ashare/snapshot';
import type {SnapshotRead,SnapshotStore} from '../lib/ashare/snapshot-store';
import type {SourceGateCode} from '../lib/ashare/source-gate';
const request=(headers?:HeadersInit,path='snapshot')=>new Request('https://private.invalid/api/v1/ashare/'+path,{headers});
const snapshot=():Snapshot=>({scope:parseScope(new URL('https://scope.invalid')),fetched_at:new Date().toISOString(),page_count:1,source_total:1,
 rows:[Object.fromEntries(FIELDS.map(key=>[key,key==='f12'?'BK0001':key==='f14'?'合成行业':1])) as Snapshot['rows'][number]]});
function fixture(read:SnapshotStore['read']){
 const fetcher=vi.fn(),commit=vi.fn(),inspect=vi.fn(async():Promise<SourceGateCode|null>=>null),acquire=vi.fn(async()=>({token:'one'})),release=vi.fn();
 const handler=createAshareHandler({enabled:()=>true,isolatedForTests:true,fetcher,sourceGate:{inspect,acquire,release},snapshotStore:{read,commit}});
 return {fetcher,commit,inspect,acquire,release,handler};
}
beforeEach(()=>vi.useFakeTimers());afterEach(()=>vi.useRealTimers());
test('cold shared snapshot preserves exact provenance and ETag without admission or provider fetch',async()=>{
 const cached=snapshot(),f=fixture(async()=>({snapshot:cached,ageMs:0,canAcquire:true}));
 const first=await f.handler(request());expect(first.status).toBe(200);expect(await first.json()).toMatchObject({...cached,source_observed_at:null,trade_date:null,stale:false});
 const same=await f.handler(request({'if-none-match':first.headers.get('etag')!}));expect(same.status).toBe(304);
 expect(f.fetcher).not.toHaveBeenCalled();expect(f.acquire).not.toHaveBeenCalled();expect(f.release).not.toHaveBeenCalled();
});
test('read-only status discovers durable cache without acquisition',async()=>{
 const cached=snapshot(),f=fixture(async()=>({snapshot:cached,ageMs:61_000,canAcquire:true}));
 expect(await (await f.handler(request(undefined,'status'))).json()).toMatchObject({state:'ready',stale:true});
 expect(f.fetcher).not.toHaveBeenCalled();expect(f.acquire).not.toHaveBeenCalled();expect(f.commit).not.toHaveBeenCalled();
});
test('queued refresh rereads newly published fresh evidence instead of acquiring',async()=>{
 const cached=snapshot();let n=0;const f=fixture(async()=>++n===1?{canAcquire:true}:{snapshot:cached,ageMs:0,canAcquire:true});
 expect((await f.handler(request())).status).toBe(200);expect(f.acquire).not.toHaveBeenCalled();expect(f.fetcher).not.toHaveBeenCalled();
});
test('single cooldown wait reuses another isolate commit without second acquisition or provider call',async()=>{
 const cached=snapshot();let ready=false;const f=fixture(async()=>ready?{snapshot:cached,ageMs:0,canAcquire:true}:{canAcquire:true});
 f.acquire.mockImplementation(async()=>{throw Object.assign(new Error('cooldown'),{code:'source_cooldown'});});
 const pending=f.handler(request());await vi.advanceTimersByTimeAsync(1);expect(f.acquire).toHaveBeenCalledTimes(1);
 ready=true;await vi.advanceTimersByTimeAsync(3100);expect((await pending).status).toBe(200);
 expect(f.acquire).toHaveBeenCalledTimes(1);expect(f.fetcher).not.toHaveBeenCalled();
});
test.each(['source_denied','source_outcome_unconfirmed','source_busy','source_gate_unavailable'] as const)('final permission check suppresses rows and 304 on %s discovered while hashing',async code=>{
 const cached=snapshot(),f=fixture(async()=>({snapshot:cached,ageMs:0,canAcquire:true}));
 const first=await f.handler(request());expect(first.status).toBe(200);f.inspect.mockResolvedValue(code);
 const changed=await f.handler(request({'if-none-match':first.headers.get('etag')!}));expect(changed.status).toBe(503);expect(changed.headers.get('etag')).toBeNull();
 const body=await changed.json() as Record<string,unknown>;expect(body.error_code).toBe(code);expect(body.rows).toBeUndefined();expect(f.fetcher).not.toHaveBeenCalled();
});
test('unknown shared read never serves warm memory and bounded read timeout makes no source request',async()=>{
 const cached=snapshot();let fail=false;const f=fixture(()=>fail?new Promise<SnapshotRead>(()=>{}):Promise.resolve({snapshot:cached,ageMs:0,canAcquire:true}));
 expect((await f.handler(request())).status).toBe(200);fail=true;const pending=f.handler(request());await vi.advanceTimersByTimeAsync(4000);
 const response=await pending;expect(response.status).toBe(503);expect(await response.json()).toMatchObject({error_code:'snapshot_store_unavailable'});
 expect(f.fetcher).not.toHaveBeenCalled();expect(f.acquire).not.toHaveBeenCalled();
});
test('a late commit is retained until confirmed and does not call separate release',async()=>{
 let cached:Snapshot|undefined,finish!:()=>void;const retained:Promise<unknown>[]=[];
 const commitBarrier=new Promise<void>(resolve=>{finish=resolve;});
 const commit=vi.fn(async(_token:string,next:Snapshot)=>{await commitBarrier;cached=next;});
 const release=vi.fn(),fetcher=vi.fn(async()=>new Response(JSON.stringify({rc:0,data:{total:1,diff:snapshot().rows}}),{headers:{'content-type':'application/json'}}));
 const handler=createAshareHandler({enabled:()=>true,isolatedForTests:true,fetcher,waitUntil:promise=>retained.push(promise),sourceGate:{acquire:async()=>({token:'one'}),release,inspect:async()=>null},snapshotStore:{read:async()=>({snapshot:cached,ageMs:0,canAcquire:true}),commit}});
 const pending=handler(request());await vi.advanceTimersByTimeAsync(1);expect(commit).toHaveBeenCalledOnce();expect(cached).toBeUndefined();expect(retained).toHaveLength(1);
 let settled=false;void retained[0].then(()=>{settled=true;});expect(settled).toBe(false);finish();expect((await pending).status).toBe(200);await Promise.all(retained);
 expect(settled).toBe(true);expect(release).not.toHaveBeenCalled();expect(fetcher).toHaveBeenCalledOnce();
});

test('concurrent local uncertain commit suppresses an already-hashed warm response even when final DB inspection reads idle',async()=>{
 const cached=snapshot();let inspected=false;
 const handler=createAshareHandler({enabled:()=>true,isolatedForTests:true,
  sourceGate:{acquire:async()=>({token:'one'}),release:vi.fn(),inspect:async()=>{
   if(!inspected){inspected=true;const failed=await handler(new Request('https://private.invalid/api/v1/ashare/snapshot?scope=BK0001'));expect(failed.status).toBe(503);}
   return null;
  }},snapshotStore:{read:async scope=>scope.kind==='industry_rank'?{snapshot:cached,ageMs:0,canAcquire:true}:{canAcquire:true},commit:async()=>{throw new Error('uncertain acknowledgement');}},
  fetcher:async()=>new Response(JSON.stringify({rc:0,data:{total:1,diff:[{...cached.rows[0],f12:'000001'}]}}),{headers:{'content-type':'application/json'}}),
 });
 const response=await handler(request());expect(response.status).toBe(503);expect(response.headers.get('etag')).toBeNull();
 expect(await response.json()).toMatchObject({error_code:'source_gate_release_unconfirmed'});
});
