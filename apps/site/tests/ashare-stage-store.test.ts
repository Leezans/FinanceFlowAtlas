import {test,expect} from 'vitest';
import {DatabaseSync,type SQLInputValue} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {D1SourceGate,SQL,type D1Result} from '../lib/ashare/source-gate';
import {createAshareHandler} from '../lib/ashare/ashare';
import {consumeReply,emptyState} from '../components/ashare/client';
import {createCollectionBatch} from '../lib/ashare/collection-batch';
import {D1SnapshotStore} from '../lib/ashare/snapshot-store';
import {D1StageStore,STAGE_SQL,type StageD1} from '../lib/ashare/stage-store';
import {decodeStage,encodeStage,validateStage,STAGE_MAX_AGE_MS,STAGE_MAX_BYTES,STAGE_MAX_SCOPES,type Stage} from '../lib/ashare/stage';
import {FIELDS,parseScope,type Row} from '../lib/ashare/snapshot';

function fixture(){
 const sqlite=new DatabaseSync(':memory:');
 for(const name of ['0001_wild_jigsaw','0019_lean_golden_guardian','0014_ashare_staged_acquisitions'])sqlite.exec(readFileSync(new URL(`../drizzle/${name}.sql`,import.meta.url),'utf8'));
 let failAt=-1,unknownWrite=false,hideChanges=false,reads=0;const statements:string[]=[];
 const db:StageD1={
  prepare(sql){return {bind(...values:unknown[]){return {async run():Promise<D1Result>{
   reads++;statements.push(sql);
   const results=sqlite.prepare(sql).all(...values as SQLInputValue[]) as Record<string,unknown>[];
   const changes=/^(INSERT|UPDATE|DELETE)/.test(sql)?Number(sqlite.prepare('SELECT changes() n').get()!.n):0;
   return {success:true,results,meta:hideChanges?{}:{changes}};
  }}}};},
  async batch(list){sqlite.exec('BEGIN');let committed=false;
   try{const results=[];for(let i=0;i<list.length;i++){if(i===failAt)throw new Error('private database exception');results.push(await list[i].run());}
    sqlite.exec('COMMIT');committed=true;if(unknownWrite)throw new Error('unknown transport result');return results;
   }catch(error){if(!committed)sqlite.exec('ROLLBACK');throw error;}
  },
 };
 const gate=new D1SourceGate(db),store=new D1StageStore(db);
 return {sqlite,db,gate,store,statements,reads:()=>reads,failAt:(index:number)=>{failAt=index;},
  unknownWrite:()=>{unknownWrite=true;},hideChanges:()=>{hideChanges=true;},
  elapse:()=>sqlite.exec('UPDATE ashare_source_gate SET not_before_ms=0')};
}
function evidence(key='level1',pages=1,total=301):Stage {
 const scope=parseScope(new URL('https://scope.invalid/?scope='+key));
 const rows=Array.from({length:pages*100},(_,index)=>Object.fromEntries(FIELDS.map(field=>[field,
  field==='f12'?(key==='level1'?'BK'+String(9000-index).padStart(4,'0'):String(900000-index).padStart(6,'0')):
  field==='f14'?'合成测试':1])) as Row);
 const now=new Date(Date.now()-10).toISOString();
 return {scope,rows,source_total:total,page_count:pages,started_at:now,updated_at:now,endpoint:'primary',redirect_count:0,bytes:pages*100_000};
}
async function save(f:ReturnType<typeof fixture>,stage=evidence()){
 f.elapse();const lease=await f.gate.acquire(stage.scope.fs);await f.store.save(lease.token,stage);return lease;
}
async function acquire(f:ReturnType<typeof fixture>){f.elapse();return f.gate.acquire('test');}
function state(f:ReturnType<typeof fixture>){return {gate:f.sqlite.prepare('SELECT * FROM ashare_source_gate').get(),stages:f.sqlite.prepare('SELECT * FROM ashare_staged_acquisitions ORDER BY scope_key').all()};}
function age(f:ReturnType<typeof fixture>,ms:number){
 for(const row of f.sqlite.prepare('SELECT scope_key,payload FROM ashare_staged_acquisitions').all()){
  const stage=JSON.parse(String(row.payload)) as Stage;
  stage.started_at=new Date(Date.parse(stage.started_at)-ms).toISOString();stage.updated_at=new Date(Date.parse(stage.updated_at)-ms).toISOString();
  f.sqlite.prepare('UPDATE ashare_staged_acquisitions SET payload=?,started_ms=started_ms-?,updated_ms=updated_ms-?,expires_ms=expires_ms-? WHERE scope_key=?')
   .run(JSON.stringify(stage),ms,ms,ms,String(row.scope_key));
 }
}

test('save atomically persists only a partial prefix and releases with the unchanged 3s pace',async()=>{
 const f=fixture(),stage=evidence();await save(f,stage);
 const current=state(f);expect(current.stages).toHaveLength(1);
 expect(current.gate).toMatchObject({status:'idle',lease_token:null,reason_code:null});
 expect(Number(current.gate!.not_before_ms)-Number(current.gate!.finished_ms)).toBe(3000);
 await expect(f.gate.acquire(stage.scope.fs)).rejects.toMatchObject({code:'source_cooldown'});
 const lease=await acquire(f),read=await new D1StageStore(f.db).read(lease.token,stage.scope);
 expect(read).toEqual({...stage,updated_at:new Date(Number(current.stages[0].updated_ms)).toISOString()});
 expect(Date.parse(read!.started_at)).toBe(current.stages[0].started_ms);expect(current.stages[0].expires_ms).toBe(Date.parse(stage.started_at)+STAGE_MAX_AGE_MS);
 expect(f.sqlite.prepare("SELECT count(*) n FROM sqlite_master WHERE name='ashare_snapshot_cache'").get()!.n).toBe(0);
});

test('cold owner resumes exact prefix and appends without renewing the original age',async()=>{
 const f=fixture(),stage=evidence();await save(f,stage);const lease=await acquire(f);
 const prior=(await f.store.read(lease.token,stage.scope))!;
 const next={...evidence('level1',2),started_at:prior.started_at,updated_at:new Date().toISOString()};
 await new D1StageStore(f.db).save(lease.token,next);
 const owner=await acquire(f),read=(await f.store.read(owner.token,stage.scope))!;
 expect(read.rows).toHaveLength(200);expect(read.started_at).toBe(stage.started_at);expect(read.page_count).toBe(2);
 expect(state(f).stages[0].expires_ms).toBe(Date.parse(stage.started_at)+STAGE_MAX_AGE_MS);
});

test('different scopes never return one another and discard does not release or alter the gate',async()=>{
 const f=fixture();for(const key of ['level1','BK0001','BK0002'])await save(f,evidence(key));
 const lease=await acquire(f),before=state(f).gate;
 for(const key of ['level1','BK0001','BK0002'])expect((await f.store.read(lease.token,evidence(key).scope))?.scope).toEqual(evidence(key).scope);
 expect(await f.store.read(lease.token,evidence('BK0003').scope)).toBeUndefined();
 await f.store.discard(lease.token,evidence('BK0001').scope);await f.store.discard(lease.token,evidence('BK0003').scope);
 expect(state(f).stages.map(row=>row.scope_key)).toEqual(['BK0002','level1']);expect(state(f).gate).toEqual(before);
});

test.each(['idle','busy','blocked'])('%s state or mismatching token cannot read, save or discard any stage',async status=>{
 const f=fixture(),stage=evidence(),old=await save(f,stage);
 if(status==='busy')await acquire(f);
 if(status==='blocked'){const owner=await acquire(f);await f.gate.release(owner.token,{kind:'denied',reason:'http_403'});}
 const before=state(f);
 for(const operation of [()=>f.store.read(old.token,stage.scope),()=>f.store.save(old.token,evidence('BK0001')),()=>f.store.discard(old.token,stage.scope)])
  await expect(operation()).rejects.toMatchObject({code:'source_stale_lease'});
 expect(state(f)).toEqual(before);
});

test('expired prefix is deleted only by the current owner, with no gate reset or TTL takeover',async()=>{
 const f=fixture(),stage=evidence(),old=await save(f,stage);age(f,STAGE_MAX_AGE_MS+1);
 const lease=await acquire(f),before=state(f);
 await expect(f.store.read(old.token,stage.scope)).rejects.toMatchObject({code:'source_stale_lease'});expect(state(f)).toEqual(before);
 expect(await f.store.read(lease.token,stage.scope)).toBeUndefined();expect(state(f).stages).toHaveLength(0);expect(state(f).gate).toEqual(before.gate);
 f.sqlite.prepare('UPDATE ashare_source_gate SET acquired_ms=acquired_ms-?').run(STAGE_MAX_AGE_MS*3);
 await expect(f.gate.acquire('test')).rejects.toMatchObject({code:'source_outcome_unconfirmed'});
});

test.each([0,1,2,3])('transaction error at statement %s preserves old payload, all scopes, and the original lease',async index=>{
 const f=fixture(),stage=evidence();await save(f,stage);const lease=await acquire(f),before=state(f);
 f.failAt(index);await expect(f.store.save(lease.token,evidence('BK0001'))).rejects.toMatchObject({code:'source_gate_unavailable'});
 expect(state(f)).toEqual(before);expect(f.statements.filter(sql=>sql===SQL.preserve)).toHaveLength(1);
});

test('unknown committed write outcome is not retried or followed by a second gate release',async()=>{
 const f=fixture(),stage=evidence(),lease=await acquire(f);f.unknownWrite();
 const pending=f.store.save(lease.token,stage);
 await expect(pending).rejects.toMatchObject({code:'source_gate_unavailable'});
 await expect(pending).rejects.not.toHaveProperty('saveNotStarted');
 expect(state(f).stages).toHaveLength(1);expect(state(f).gate?.status).toBe('idle');
 expect(f.statements.filter(sql=>sql===SQL.preserve)).toHaveLength(1);
});

test('missing write confirmation fails closed without a second write',async()=>{
 const f=fixture(),lease=await acquire(f);f.hideChanges();
 await expect(f.store.save(lease.token,evidence())).rejects.toMatchObject({code:'source_gate_unavailable'});
 expect(f.statements.filter(sql=>sql===SQL.preserve)).toHaveLength(1);
});

test.each(['expired','future_started'])('D1 clock rejects %s before releasing the owner',async kind=>{
 const f=fixture(),lease=await acquire(f),stage=evidence(),before=state(f);
 if(kind==='expired'){stage.started_at=new Date(Date.now()-STAGE_MAX_AGE_MS-100).toISOString();stage.updated_at=stage.started_at;}
 if(kind==='future_started'){stage.started_at=new Date(Date.now()+60_000).toISOString();stage.updated_at=stage.started_at;}
 await expect(f.store.save(lease.token,stage)).rejects.toMatchObject({code:'stage_invalid',saveNotStarted:true});expect(state(f)).toEqual(before);
});

test.each(['total','start','prefix','pages','bytes'])('replacement cannot mutate %s in the acquisition prefix',async kind=>{
 const f=fixture(),stage=evidence();await save(f,stage);const lease=await acquire(f),prior=(await f.store.read(lease.token,stage.scope))!;
 const next={...evidence('level1',2),started_at:prior.started_at,updated_at:new Date().toISOString()};
 if(kind==='total')next.source_total=302;
 if(kind==='start')next.started_at=new Date(Date.parse(prior.started_at)+1).toISOString();
 if(kind==='prefix')next.rows[0].f62=999;
 if(kind==='pages'){next.page_count=1;next.rows=next.rows.slice(0,100);}
 if(kind==='bytes')next.bytes=prior.bytes;
 const before=state(f);await expect(f.store.save(lease.token,next)).rejects.toMatchObject({code:'stage_invalid',saveNotStarted:true});expect(state(f)).toEqual(before);
});

test('retention is one version per scope, <=32 scopes/64MB, and lazily removes expired stages on success',async()=>{
 const f=fixture();for(let n=1;n<=STAGE_MAX_SCOPES+2;n++){await save(f,evidence('BK'+String(n).padStart(4,'0')));age(f,1);}
 const rows=state(f).stages;expect(rows).toHaveLength(STAGE_MAX_SCOPES);expect(rows.some(row=>row.scope_key==='BK0001')).toBe(false);
 const bytes=f.sqlite.prepare('SELECT SUM(length(CAST(payload AS BLOB))) n FROM ashare_staged_acquisitions').get()!.n;
 expect(Number(bytes)).toBeLessThanOrEqual(STAGE_MAX_SCOPES*STAGE_MAX_BYTES);
 age(f,STAGE_MAX_AGE_MS+1);await save(f,evidence('BK0001'));expect(state(f).stages).toHaveLength(1);
});

test.each(['scope','ordering','boundary','duplicate','complete','short','pages','total','numeric','bytes','time','endpoint','redirect'])('strict stage validation rejects malformed %s',kind=>{
 const stage=evidence('level1',2);
 if(kind==='scope')stage.scope={...stage.scope,fs:'m:wrong'};
 if(kind==='ordering')[stage.rows[0],stage.rows[1]]=[stage.rows[1],stage.rows[0]];
 if(kind==='boundary')stage.rows[100].f12='BK9999';
 if(kind==='duplicate')stage.rows[100].f12=stage.rows[99].f12;
 if(kind==='complete')stage.source_total=200;
 if(kind==='short')stage.rows.pop();
 if(kind==='pages')stage.page_count=1;
 if(kind==='total')stage.source_total=2001;
 if(kind==='numeric')stage.rows[0].f62='123' as unknown as number;
 if(kind==='bytes')stage.bytes=4_000_001;
 if(kind==='time')stage.updated_at='2026-02-31T00:00:00.000Z';
 if(kind==='endpoint')stage.endpoint='evil' as Stage['endpoint'];
 if(kind==='redirect')stage.redirect_count=1;
 expect(()=>encodeStage(stage)).toThrow('stage_invalid');
});

test('bounded strict JSON rejects duplicate keys, oversized payloads, future time and expired original age',()=>{
 const stage=evidence(),payload=encodeStage(stage);
 expect(decodeStage(payload,stage.scope)).toEqual(stage);
 expect(()=>decodeStage(payload.replace('"source_total":301','"source_total":301,"source_total":301'),stage.scope)).toThrow();
 expect(()=>decodeStage(' '.repeat(STAGE_MAX_BYTES+1),stage.scope)).toThrow();
 expect(()=>decodeStage(payload,evidence('BK0001').scope)).toThrow();
 expect(()=>validateStage(stage,stage.scope,Date.parse(stage.started_at)-1)).toThrow();
 expect(()=>validateStage(stage,stage.scope,Date.parse(stage.started_at)+STAGE_MAX_AGE_MS)).toThrow();
});

test.each(['payload','format','started','updated','expiry','future'])('corrupt persisted %s is not resumed, repaired or discarded',async kind=>{
 const f=fixture(),stage=evidence();await save(f,stage);const lease=await acquire(f);
 f.sqlite.exec('PRAGMA ignore_check_constraints=ON');
 if(kind==='payload')f.sqlite.prepare('UPDATE ashare_staged_acquisitions SET payload=?').run(JSON.stringify({...stage,source_total:1}));
 if(kind==='format')f.sqlite.exec('UPDATE ashare_staged_acquisitions SET format_version=2');
 if(kind==='started')f.sqlite.exec('UPDATE ashare_staged_acquisitions SET started_ms=started_ms-1');
 if(kind==='updated')f.sqlite.exec('UPDATE ashare_staged_acquisitions SET updated_ms=updated_ms-1');
 if(kind==='expiry')f.sqlite.exec('UPDATE ashare_staged_acquisitions SET expires_ms=expires_ms+1');
 if(kind==='future')age(f,-60_000);
 const before=state(f);await expect(f.store.read(lease.token,stage.scope)).rejects.toThrow('stage_invalid');expect(state(f)).toEqual(before);
});

test('missing migration, missing gate and malformed clock all fail closed',async()=>{
 const f=fixture(),lease=await acquire(f);f.sqlite.exec('DROP TABLE ashare_staged_acquisitions');
 await expect(f.store.read(lease.token,evidence().scope)).rejects.toMatchObject({code:'source_gate_unavailable'});
 const absent=fixture(),owner=await acquire(absent);absent.sqlite.exec('DELETE FROM ashare_source_gate');
 await expect(absent.store.read(owner.token,evidence().scope)).rejects.toMatchObject({code:'source_gate_unavailable'});
 const future=fixture(),held=await acquire(future);future.sqlite.exec('UPDATE ashare_source_gate SET acquired_ms=acquired_ms+60000');
 await expect(future.store.read(held.token,evidence().scope)).rejects.toMatchObject({code:'source_gate_unavailable'});
});

test('migration only adds bounded staging and never modifies, expires, or reconciles source metadata',()=>{
 const sql=readFileSync(new URL('../drizzle/0014_ashare_staged_acquisitions.sql',import.meta.url),'utf8');
 expect(sql).not.toMatch(/UPDATE|DELETE|DROP|ALTER|INSERT/);expect(sql).toContain('CREATE TABLE `ashare_staged_acquisitions`');
 for(const query of [STAGE_SQL.put,STAGE_SQL.discard,STAGE_SQL.expire,STAGE_SQL.trim])expect(query).toContain("status='busy' AND lease_token=?");
});


test('one approved official redirect can be persisted in a later chunk, but cannot be undone',async()=>{
 const f=fixture(),stage=evidence();await save(f,stage);let lease=await acquire(f);
 const prior=(await f.store.read(lease.token,stage.scope))!;
 const next:Stage={...evidence('level1',2,401),source_total:prior.source_total,started_at:prior.started_at,
  updated_at:new Date().toISOString(),endpoint:'official_redirect',redirect_count:1};
 await f.store.save(lease.token,next);lease=await acquire(f);
 const read=(await f.store.read(lease.token,stage.scope))!;expect(read.endpoint).toBe('official_redirect');expect(read.redirect_count).toBe(1);
 const reverse:Stage={...evidence('level1',3,401),source_total:prior.source_total,started_at:prior.started_at,updated_at:new Date().toISOString()};
 const before=state(f);await expect(f.store.save(lease.token,reverse)).rejects.toThrow('stage_invalid');expect(state(f)).toEqual(before);
});

test.each(['rollback','unknown_commit','missing_changes'])('discard %s is reported as mutation-unconfirmed, never retried',async kind=>{
 const f=fixture(),stage=evidence();await save(f,stage);const lease=await acquire(f),before=state(f);
 if(kind==='rollback')f.failAt(1);
 if(kind==='unknown_commit')f.unknownWrite();
 if(kind==='missing_changes')f.hideChanges();
 const writesBefore=f.statements.filter(sql=>sql===STAGE_SQL.discard).length;
 const pending=f.store.discard(lease.token,stage.scope);
 await expect(pending).rejects.toMatchObject({code:'source_gate_release_unconfirmed'});
 await expect(pending).rejects.not.toHaveProperty('saveNotStarted');
 expect(f.statements.filter(sql=>sql===STAGE_SQL.discard)).toHaveLength(writesBefore+1);expect(state(f).gate).toEqual(before.gate);
 expect(state(f).stages).toHaveLength(kind==='rollback'?1:0);
});

test('expired-stage cleanup propagates mutation uncertainty and keeps the current gate untouched',async()=>{
 const f=fixture(),stage=evidence();await save(f,stage);age(f,STAGE_MAX_AGE_MS+1);const lease=await acquire(f),before=state(f).gate;
 f.unknownWrite();await expect(f.store.read(lease.token,stage.scope)).rejects.toMatchObject({code:'source_gate_release_unconfirmed'});
 expect(f.statements.filter(sql=>sql===STAGE_SQL.discard)).toHaveLength(1);expect(state(f).gate).toEqual(before);
});


test.each([-60000,60000])('save replaces a Worker update-clock skew of %sms with the owning DB clock',async offset=>{
 const f=fixture(),stage=evidence();stage.updated_at=new Date(Date.now()+offset).toISOString();await save(f,stage);
 const row=state(f).stages[0],stored=JSON.parse(String(row.payload)) as Stage;
 expect(stored.updated_at).toBe(new Date(Number(row.updated_ms)).toISOString());
 expect(stored.started_at).toBe(stage.started_at);expect(Date.parse(stored.updated_at)-Date.parse(stage.started_at)).toBeLessThan(2000);
});


test('save does not mark an ambiguous expired-stage discard as a deterministic preflight failure',async()=>{
 const f=fixture(),stage=evidence();await save(f,stage);age(f,STAGE_MAX_AGE_MS+1);const lease=await acquire(f);
 f.unknownWrite();const pending=f.store.save(lease.token,stage);
 await expect(pending).rejects.toMatchObject({code:'source_gate_release_unconfirmed'});
 await expect(pending).rejects.not.toHaveProperty('saveNotStarted');
 expect(f.statements.filter(sql=>sql===STAGE_SQL.put)).toHaveLength(1);
 expect(f.statements.filter(sql=>sql===STAGE_SQL.discard)).toHaveLength(1);
 expect(state(f).gate?.status).toBe('busy');
});

test('save does not mark malformed persisted-stage reads as a save validation result',async()=>{
 const f=fixture(),stage=evidence();await save(f,stage);const lease=await acquire(f);
 f.sqlite.prepare('UPDATE ashare_staged_acquisitions SET payload=?').run(JSON.stringify({...stage,page_count:2}));
 const before=state(f),pending=f.store.save(lease.token,{...evidence('level1',2),started_at:stage.started_at});
 await expect(pending).rejects.toThrow('stage_invalid');await expect(pending).rejects.not.toHaveProperty('saveNotStarted');
 expect(state(f)).toEqual(before);expect(f.statements.filter(sql=>sql===STAGE_SQL.put)).toHaveLength(1);
});


test('successful staged recovery exposes continuation without resetting durable failures',async()=>{
 const f=fixture(),stage=evidence();
 f.sqlite.exec(readFileSync(new URL('../drizzle/0012_ashare_shared_snapshots.sql',import.meta.url),'utf8'));
 let lease=await acquire(f);await f.gate.release(lease.token,{kind:'temporary_failure',reason:'deadline'});
 await save(f,stage);
 const store=new D1SnapshotStore(f.db,{staged:true});
 const read=await store.read(stage.scope);
 expect(read).toMatchObject({code:'collection_in_progress',canAcquire:true,durableBackoff:true});
 expect(read.failureCode).toBeUndefined();expect(read.snapshot).toBeUndefined();
 // Exercise the handler and browser continuation parser without waiting on or
 // contacting a provider: this read-only view holds admission closed.
 const handler=createAshareHandler({enabled:()=>true,isolatedForTests:true,sourceGate:f.gate,
  snapshotStore:{read:async scope=>({...await store.read(scope),canAcquire:false}),commit:async()=>{throw new Error('unexpected commit');}},
  fetcher:async()=>{throw new Error('unexpected source request');}});
 const response=await handler(new Request('https://offline.invalid/api/v1/ashare/snapshot?scope=level1'));
 expect(response.status).toBe(503);
 const now=Date.now(),client=consumeReply(emptyState(),{status:response.status,payload:await response.json(),
  errorCode:response.headers.get('x-ashare-error-code')??undefined,recoveryMode:response.headers.get('x-ashare-recovery')??undefined,
  retryAfter:response.headers.get('retry-after')??undefined},stage.scope,now);
 expect(client.continuationAt).toBeGreaterThan(now);expect(client.snapshot).toBeNull();
 const batch=createCollectionBatch(now);expect(batch.start(now)).toBe(true);
 expect(batch.next(client.continuationAt,now)).toBeGreaterThan(now);

 expect(f.sqlite.prepare('SELECT failure_count,failure_code FROM ashare_source_gate').get()).toMatchObject({failure_count:1,failure_code:'deadline'});
 // A later failure in another scope still owns the global cooldown. A partial
 // prefix must never hide that cooldown or reset its exponential history.
 lease=await acquire(f);await f.gate.release(lease.token,{kind:'temporary_failure',reason:'upstream_http'});
 const blocked=await store.read(stage.scope);
 expect(blocked).toMatchObject({code:'source_cooldown',canAcquire:false,failureCode:'upstream_http'});
 expect(blocked.retryAfterMs).toBeGreaterThan(119000);
});
