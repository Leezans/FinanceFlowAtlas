import {test,expect} from 'vitest';
import {DatabaseSync,type SQLInputValue} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createAshareHandler} from '../lib/ashare/ashare';
import {D1SourceGate,SQL,type D1Result} from '../lib/ashare/source-gate';
import {D1SnapshotStore,SNAPSHOT_SQL,type SnapshotD1} from '../lib/ashare/snapshot-store';
import {FIELDS,parseScope,encodeSnapshot,decodeSnapshot,SNAPSHOT_MAX_AGE_MS,SNAPSHOT_MAX_SCOPES,type Snapshot} from '../lib/ashare/snapshot';

function fixture(){
 const sqlite=new DatabaseSync(':memory:');
 for(const name of ['0001_wild_jigsaw','0019_lean_golden_guardian','0012_ashare_shared_snapshots'])sqlite.exec(readFileSync(new URL(`../drizzle/${name}.sql`,import.meta.url),'utf8'));
 let failAt=-1,reads=0;
 const db:SnapshotD1={
  prepare(sql){
   return {bind(...values:unknown[]){
    return {async run():Promise<D1Result>{
     reads++;
     const results=sqlite.prepare(sql).all(...values as SQLInputValue[]) as Record<string,unknown>[];
     const changes=/^(INSERT|UPDATE|DELETE)/.test(sql)?Number(sqlite.prepare('SELECT changes() n').get()!.n):0;
     return {success:true,results,meta:{changes}};
    }};
   }};
  },
  async batch(statements){
   sqlite.exec('BEGIN');
   try{const results=[];for(let i=0;i<statements.length;i++){if(i===failAt)throw new Error('private database exception');results.push(await statements[i].run());}sqlite.exec('COMMIT');return results;}
   catch(error){sqlite.exec('ROLLBACK');throw error;}
 }};
 const gate=new D1SourceGate(db),store=new D1SnapshotStore(db);
 return {sqlite,db,gate,store,reads:()=>reads,failAt:(index:number)=>{failAt=index;},elapse:()=>sqlite.exec('UPDATE ashare_source_gate SET not_before_ms=0')};
}
function evidence(key='level1'):Snapshot {
 const scope=parseScope(new URL('https://scope.invalid/?scope='+key));
 return {scope,rows:[Object.fromEntries(FIELDS.map(field=>[field,field==='f12'?(key==='level1'?'BK0001':'000001'):field==='f14'?'合成测试':1])) as Snapshot['rows'][number]],source_total:1,page_count:1,fetched_at:new Date().toISOString()};
}
async function publish(f:ReturnType<typeof fixture>,snapshot=evidence()){
 f.elapse();const lease=await f.gate.acquire(snapshot.scope.fs);await f.store.commit(lease.token,snapshot);return lease;
}
function age(f:ReturnType<typeof fixture>,ms:number){f.sqlite.prepare('UPDATE ashare_snapshot_cache SET committed_ms=committed_ms-?,expires_ms=expires_ms-?').run(ms,ms);}

test('complete snapshot atomically releases original lease and cold store reads exact evidence',async()=>{
 const f=fixture(),snapshot=evidence();await publish(f,snapshot);
 const read=await new D1SnapshotStore(f.db).read(snapshot.scope);
 expect(read.snapshot).toEqual(snapshot);expect(read.code).toBeUndefined();expect(read.ageMs).toBeLessThan(1000);
 const gate=f.sqlite.prepare('SELECT status,lease_token,not_before_ms-finished_ms quiet FROM ashare_source_gate').get();
 expect(gate).toMatchObject({status:'idle',lease_token:null,quiet:3000});
});
test('industry and multiple constituent scopes are independent durable entries',async()=>{
 const f=fixture(),snapshots=['level1','BK0001','BK0002'].map(evidence);for(const snapshot of snapshots)await publish(f,snapshot);
 for(const snapshot of snapshots)expect((await new D1SnapshotStore(f.db).read(snapshot.scope)).snapshot).toEqual(snapshot);
});
test('temporary failure preserves original acquisition and values for cold store during shared 60s cooldown',async()=>{
 const f=fixture(),snapshot=evidence();await publish(f,snapshot);age(f,60_001);f.elapse();
 const lease=await f.gate.acquire('other');await f.gate.release(lease.token,{kind:'temporary_failure'});
 const read=await new D1SnapshotStore(f.db).read(snapshot.scope);
 expect(read.snapshot).toEqual(snapshot);expect(read.ageMs).toBeGreaterThanOrEqual(60_001);expect(read.code).toBe('source_cooldown');expect(read.canAcquire).toBe(false);
});
test('denial and busy or unconfirmed operations never return persisted evidence or mutate metadata',async()=>{
 const f=fixture(),snapshot=evidence();await publish(f,snapshot);f.elapse();const lease=await f.gate.acquire('other');
 for(const [code,ms] of [['source_busy',0],['source_outcome_unconfirmed',180_001]] as const){
  if(ms)f.sqlite.prepare('UPDATE ashare_source_gate SET acquired_ms=acquired_ms-?').run(ms);
  const before=f.sqlite.prepare('SELECT * FROM ashare_source_gate').get();const read=await new D1SnapshotStore(f.db).read(snapshot.scope);
  expect(read).toEqual({code,canAcquire:false});expect(f.sqlite.prepare('SELECT * FROM ashare_source_gate').get()).toEqual(before);
 }
 await f.gate.release(lease.token,{kind:'denied'});
 expect(await new D1SnapshotStore(f.db).read(snapshot.scope)).toEqual({code:'source_denied',canAcquire:false});
 expect(f.sqlite.prepare('SELECT COUNT(*) n FROM ashare_snapshot_cache').get()!.n).toBe(1);
});
test('stale lease cannot replace evidence, trim retention, or release another owner',async()=>{
 const f=fixture(),snapshot=evidence(),old=await publish(f,snapshot);f.elapse();const lease=await f.gate.acquire('other');
 const before=f.sqlite.prepare('SELECT * FROM ashare_snapshot_cache').all();
 await expect(f.store.commit(old.token,evidence('BK0001'))).rejects.toMatchObject({code:'source_stale_lease'});
 expect(f.sqlite.prepare('SELECT * FROM ashare_snapshot_cache').all()).toEqual(before);
 expect(f.sqlite.prepare('SELECT lease_token FROM ashare_source_gate').get()!.lease_token).toBe(lease.token);
});
test.each([0,1,2,3])('batch failure at statement %s rolls back payload, retention and gate without release retry',async index=>{
 const f=fixture(),snapshot=evidence();await publish(f,snapshot);f.elapse();const lease=await f.gate.acquire('other');
 const prior=f.sqlite.prepare('SELECT * FROM ashare_snapshot_cache').all(),gate=f.sqlite.prepare('SELECT * FROM ashare_source_gate').get();
 f.failAt(index);await expect(f.store.commit(lease.token,evidence('BK0001'))).rejects.toMatchObject({code:'source_gate_unavailable'});
 expect(f.sqlite.prepare('SELECT * FROM ashare_snapshot_cache').all()).toEqual(prior);expect(f.sqlite.prepare('SELECT * FROM ashare_source_gate').get()).toEqual(gate);
 expect((await f.store.read(snapshot.scope)).snapshot).toBeUndefined();
});
test('bounded retention pins industry, replaces same scope, evicts oldest stock and lazily deletes expired rows',async()=>{
 const f=fixture();await publish(f,evidence());age(f,1);
 for(let n=1;n<=SNAPSHOT_MAX_SCOPES+3;n++){await publish(f,evidence('BK'+String(n).padStart(4,'0')));age(f,1);}
 const rows=f.sqlite.prepare('SELECT scope_key FROM ashare_snapshot_cache').all();expect(rows).toHaveLength(SNAPSHOT_MAX_SCOPES);
 expect(rows.some(row=>row.scope_key==='level1')).toBe(true);expect(rows.some(row=>row.scope_key==='BK0001')).toBe(false);
 await publish(f,evidence('BK0035'));expect(f.sqlite.prepare('SELECT COUNT(*) n FROM ashare_snapshot_cache').get()!.n).toBe(SNAPSHOT_MAX_SCOPES);
 age(f,SNAPSHOT_MAX_AGE_MS);expect((await f.store.read(evidence().scope)).snapshot).toBeUndefined();
 await publish(f,evidence('BK0002'));expect(f.sqlite.prepare('SELECT COUNT(*) n FROM ashare_snapshot_cache').get()!.n).toBe(1);
});
test.each(['scope','numeric','duplicate','pages','total','time','format'])('corrupt persisted %s is never returned or silently repaired',async kind=>{
 const f=fixture(),snapshot=evidence();await publish(f,snapshot);
 const broken=structuredClone(snapshot);
 if(kind==='scope')broken.scope=evidence('BK0001').scope;
 if(kind==='numeric')broken.rows[0].f62='123' as unknown as number;
 if(kind==='duplicate'){broken.rows.push(broken.rows[0]);broken.source_total=2;}
 if(kind==='pages')broken.page_count=2;
 if(kind==='total')broken.source_total=2;
 if(kind==='time')broken.fetched_at='2026-99-99T00:00:00.000Z';
 if(kind==='format'){f.sqlite.exec('PRAGMA ignore_check_constraints=ON');f.sqlite.exec('UPDATE ashare_snapshot_cache SET format_version=2');}
 else f.sqlite.prepare('UPDATE ashare_snapshot_cache SET payload=?').run(JSON.stringify(broken));
 const before=f.sqlite.prepare('SELECT * FROM ashare_snapshot_cache').all();
 expect(await f.store.read(snapshot.scope)).toEqual({code:'snapshot_invalid',canAcquire:false});
 expect(f.sqlite.prepare('SELECT * FROM ashare_snapshot_cache').all()).toEqual(before);
});
test('missing migration or gate fails closed and does not send storage exception text',async()=>{
 const f=fixture();f.sqlite.exec('DROP TABLE ashare_snapshot_cache');
 expect(await f.store.read(evidence().scope)).toEqual({code:'snapshot_store_unavailable',canAcquire:false});
 const absent=fixture();absent.sqlite.exec('DELETE FROM ashare_source_gate');expect(await absent.store.read(evidence().scope)).toEqual({code:'source_gate_unavailable',canAcquire:false});
});
test('canonical serialization preserves missing values and strips unknown fields',()=>{
 const snapshot=evidence();snapshot.rows[0].f62=null;snapshot.rows[0].f2='--';
 const encoded=encodeSnapshot({...snapshot,unknown:'not stored'} as Snapshot);expect(encoded).not.toContain('not stored');
 expect(decodeSnapshot(encoded,snapshot.scope)).toEqual(snapshot);
 expect(()=>decodeSnapshot(encoded.replace('"source_total":1','"source_total":1,"source_total":2'),snapshot.scope)).toThrow();
 expect(()=>encodeSnapshot({...snapshot,rows:[],source_total:0})).toThrow();
 expect(()=>decodeSnapshot(' '.repeat(2_000_001),snapshot.scope)).toThrow();
});
test('migration adds only a cache table, preserving exact gate, lease and reconciliation history',()=>{
 const sql=readFileSync(new URL('../drizzle/0012_ashare_shared_snapshots.sql',import.meta.url),'utf8');
 expect(sql).not.toMatch(/UPDATE|DELETE|DROP|ALTER|INSERT/);
 expect(sql).toContain('CREATE TABLE `ashare_snapshot_cache`');
 expect(SNAPSHOT_SQL.put).toContain("status='busy' AND lease_token=?");expect(SQL.finish).toContain("status='busy' AND lease_token=?");
});

test('new commit never renews acquisition age or infers source time',async()=>{
 const f=fixture(),snapshot=evidence();snapshot.fetched_at=new Date(Date.now()-61_000).toISOString();await publish(f,snapshot);
 const read=await f.store.read(snapshot.scope);expect(read.ageMs).toBeGreaterThanOrEqual(61_000);expect(read.snapshot?.fetched_at).toBe(snapshot.fetched_at);
 expect(read.snapshot).not.toHaveProperty('source_observed_at');expect(read.snapshot).not.toHaveProperty('trade_date');
});
test('future acquisition timestamps are invalid and acquisition older than max age cannot be revived by a new commit',async()=>{
 for(const offset of [120_000,-SNAPSHOT_MAX_AGE_MS-1000]){
  const f=fixture(),snapshot=evidence();snapshot.fetched_at=new Date(Date.now()+offset).toISOString();await publish(f,snapshot);
  const read=await f.store.read(snapshot.scope);expect(read.snapshot).toBeUndefined();
  if(offset>0)expect(read.code).toBe('snapshot_invalid');
 }
});

test('staged publication atomically removes partial acquisition and releases the same lease',async()=>{
 const f=fixture();f.sqlite.exec(readFileSync(new URL('../drizzle/0014_ashare_staged_acquisitions.sql',import.meta.url),'utf8'));
 const snapshot=evidence('BK1216');snapshot.collection_started_at=new Date(Date.now()-2000).toISOString();
 const lease=await f.gate.acquire(snapshot.scope.fs);const store=new D1SnapshotStore(f.db,{staged:true});await store.commit(lease.token,snapshot);
 expect((await store.read(snapshot.scope)).snapshot).toMatchObject({rows:snapshot.rows,collection_started_at:snapshot.collection_started_at});expect(await f.gate.inspect()).toBe('source_cooldown');
});
test.each([-181000,2000])('DB-clock publication guard rolls back snapshot and release for start offset %s',async offset=>{
 const f=fixture();f.sqlite.exec(readFileSync(new URL('../drizzle/0014_ashare_staged_acquisitions.sql',import.meta.url),'utf8'));
 const snapshot=evidence('BK1216');snapshot.collection_started_at=new Date(Date.now()+offset).toISOString();snapshot.fetched_at=new Date(Date.now()+offset+1).toISOString();
 const lease=await f.gate.acquire(snapshot.scope.fs),store=new D1SnapshotStore(f.db,{staged:true});
 await expect(store.commit(lease.token,snapshot)).rejects.toMatchObject({code:'source_gate_unavailable'});
 expect(f.sqlite.prepare('SELECT COUNT(*) n FROM ashare_snapshot_cache').get()!.n).toBe(0);expect(f.sqlite.prepare('SELECT status FROM ashare_source_gate').get()!.status).toBe('busy');
});
test('freshness age begins at the first collected page, not final-page commit',async()=>{
 const f=fixture();f.sqlite.exec(readFileSync(new URL('../drizzle/0014_ashare_staged_acquisitions.sql',import.meta.url),'utf8'));
 const snapshot=evidence('BK1216');snapshot.collection_started_at=new Date(Date.now()-65000).toISOString();
 const lease=await f.gate.acquire(snapshot.scope.fs),store=new D1SnapshotStore(f.db,{staged:true});await store.commit(lease.token,snapshot);
 expect((await store.read(snapshot.scope)).ageMs).toBeGreaterThanOrEqual(65000);
});
test('successful pacing does not label an old-first-page staged snapshot as a failed refresh',async()=>{
 const f=fixture();f.sqlite.exec(readFileSync(new URL('../drizzle/0014_ashare_staged_acquisitions.sql',import.meta.url),'utf8'));
 const snapshot=evidence('BK1216');snapshot.collection_started_at=new Date(Date.now()-65000).toISOString();
 const lease=await f.gate.acquire(snapshot.scope.fs),store=new D1SnapshotStore(f.db,{staged:true});await store.commit(lease.token,snapshot);
 const read=await store.read(snapshot.scope);
 expect(read.snapshot?.collection_started_at).toBe(snapshot.collection_started_at);
 expect(read.ageMs).toBeGreaterThanOrEqual(65000);expect(read.code).toBeUndefined();
 // Pacing still holds: classification changes never reset or bypass the gate.
 expect(await f.gate.inspect()).toBe('source_cooldown');
 let sourceCalls=0;
 const handler=createAshareHandler({enabled:()=>true,isolatedForTests:true,sourceGate:f.gate,snapshotStore:store,
  fetcher:async()=>{sourceCalls++;throw new Error('unexpected source call');}});
 const response=await handler(new Request('https://private.invalid/api/v1/ashare/status?scope=BK1216'));
 expect(await response.json()).toMatchObject({state:'ready',stale:true,has_error:false});
 expect(response.headers.get('X-Ashare-Error-Code')).toBeNull();expect(sourceCalls).toBe(0);
 // A later actual failed refresh must still survive a cold read as an error.
 f.elapse();const failed=await f.gate.acquire('other');await f.gate.release(failed.token,{kind:'temporary_failure'});
 const failure=await store.read(snapshot.scope);expect(failure.code).toBe('source_cooldown');expect(failure.canAcquire).toBe(false);
 const failedResponse=await handler(new Request('https://private.invalid/api/v1/ashare/status?scope=BK1216'));
 expect(await failedResponse.json()).toMatchObject({state:'ready',stale:true,has_error:true});
 expect(failedResponse.headers.get('X-Ashare-Error-Code')).toBe('collection_failed');expect(sourceCalls).toBe(0);
});

test('durable failure history survives cold reads, cooldown expiry and stale isolate scheduling; success resets it',async()=>{
 const f=fixture(),snapshot=evidence();await publish(f,snapshot);age(f,61000);f.elapse();
 let calls=0;
 const handler=createAshareHandler({enabled:()=>true,isolatedForTests:true,sourceGate:f.gate,snapshotStore:f.store,
  fetcher:async()=>{calls++;return new Response('',{status:502,headers:{'content-type':'application/json'}});}});
 const request=()=>new Request('https://private.invalid/api/v1/ashare/snapshot');
 const first=await handler(request());expect(first.status).toBe(200);expect(first.headers.get('Retry-After')).toBe('60');
 expect(await first.json()).toMatchObject({stale:true,has_error:true});expect(calls).toBe(1);
 const cold=createAshareHandler({enabled:()=>true,isolatedForTests:true,sourceGate:new D1SourceGate(f.db),snapshotStore:new D1SnapshotStore(f.db),fetcher:async()=>{throw new Error('must not fetch');}});
 const held=await cold(request());expect(held.headers.get('X-Ashare-Error-Code')).toBe('upstream_http');expect(held.headers.get('Retry-After')).toBe('60');
 f.elapse();
 const status=await cold(new Request('https://private.invalid/api/v1/ashare/status'));
 expect(status.headers.get('X-Ashare-Error-Code')).toBe('upstream_http');expect(status.headers.get('Retry-After')).toBe('1');expect(await status.json()).toMatchObject({has_error:true,stale:true});
 // The old handler must not extend the expired authoritative delay with its own 60s timer.
 const second=await handler(request());expect(calls).toBe(2);expect(second.headers.get('Retry-After')).toBe('120');
 await publish(f,evidence());
 const restored=await handler(request());expect(restored.headers.get('X-Ashare-Error-Code')).toBeNull();expect(restored.headers.get('X-Ashare-Refresh-After')).not.toBeNull();
 expect(await restored.json()).toMatchObject({has_error:false,stale:false});expect(calls).toBe(2);
 expect(f.sqlite.prepare('SELECT failure_count,failure_code,last_failure_ms FROM ashare_source_gate').get()).toMatchObject({failure_count:0,failure_code:null,last_failure_ms:null});
});

test('pre-source failure remains visible locally without incrementing durable count, until verified publication',async()=>{
 const f=fixture();await publish(f);age(f,61000);f.elapse();let calls=0;
 const handler=createAshareHandler({enabled:()=>true,isolatedForTests:true,sourceGate:f.gate,snapshotStore:f.store,
  stageStore:{read:async()=>{throw new Error('stage_invalid');},save:async()=>{},discard:async()=>{}},
  fetcher:async()=>{calls++;throw new Error('must not fetch');}});
 const response=await handler(new Request('https://private.invalid/api/v1/ashare/snapshot'));
 expect(calls).toBe(0);expect(response.headers.get('X-Ashare-Error-Code')).toBe('stage_invalid');expect(await response.json()).toMatchObject({stale:true,has_error:true});
 expect(f.sqlite.prepare('SELECT failure_count,failure_code FROM ashare_source_gate').get()).toMatchObject({failure_count:0,failure_code:null});
 f.elapse();const unrelated=await f.gate.acquire('other');
 const busy=await handler(new Request('https://private.invalid/api/v1/ashare/status'));expect(busy.headers.get('X-Ashare-Error-Code')).toBe('source_busy');
 await f.gate.release(unrelated.token,{kind:'cancelled'});
 const unchanged=await handler(new Request('https://private.invalid/api/v1/ashare/status'));expect(unchanged.headers.get('X-Ashare-Error-Code')).toBe('stage_invalid');
 await publish(f);const restored=await handler(new Request('https://private.invalid/api/v1/ashare/status'));
 expect(restored.headers.get('X-Ashare-Error-Code')).toBeNull();expect(await restored.json()).toMatchObject({has_error:false,stale:false});
});

test('missing baseline and delayed older snapshot revisions cannot prove transient error recovery',async()=>{
 let shared:import('../lib/ashare/snapshot-store').SnapshotRead={canAcquire:true,durableBackoff:true,retryAfterMs:0};
 const handler=createAshareHandler({enabled:()=>true,isolatedForTests:true,
  sourceGate:{acquire:async()=>({token:'synthetic'}),release:async()=>{}},
  snapshotStore:{read:async()=>shared,commit:async()=>{}},
  stageStore:{read:async()=>{throw new Error('stage_invalid');},save:async()=>{},discard:async()=>{}},fetcher:async()=>{throw new Error('must not fetch');}});
 const failed=await handler(new Request('https://private.invalid/api/v1/ashare/snapshot'));expect(failed.headers.get('X-Ashare-Error-Code')).toBe('stage_invalid');
 const snapshot=evidence();
 for(const revision of [100,99,100]){
  shared={canAcquire:true,durableBackoff:true,snapshot,ageMs:0,committedMs:revision};
  const status=await handler(new Request('https://private.invalid/api/v1/ashare/status'));expect(status.headers.get('X-Ashare-Error-Code')).toBe('stage_invalid');
 }
 shared={...shared,committedMs:101};const recovered=await handler(new Request('https://private.invalid/api/v1/ashare/status'));expect(recovered.headers.get('X-Ashare-Error-Code')).toBeNull();
});
