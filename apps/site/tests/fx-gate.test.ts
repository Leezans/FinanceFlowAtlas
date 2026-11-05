import {describe,it,expect,vi} from 'vitest';
import {DatabaseSync,type SQLInputValue} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {D1FxGate,FX_SQL} from '../lib/fx/source-gate';
import type {GateD1} from '../lib/ashare/source-gate';
import {createFxService} from '../lib/fx/service';
import {CHECK_INTERVAL_MS,RETRY_INTERVAL_MS,CACHE_TTL_MS} from '../lib/fx/model';
import {fxResponse,fxPayload} from './fx-fixture';
function database(){
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../drizzle/0004_ecb_fx_gate.sql',import.meta.url),'utf8'));sql.exec(readFileSync(new URL('../drizzle/0006_ecb_fx_shared_cache.sql',import.meta.url),'utf8'));
 const db:GateD1={prepare(query){return {bind(...values){return {async run(){const stmt=sql.prepare(query);const results=stmt.all(...values as SQLInputValue[]) as Record<string,unknown>[];return {success:true,results,meta:{changes:query.startsWith('UPDATE')?results.length:0}}}}}}}};
 return {sql,db};
}
describe('ECB persistent SQLite coordination',()=>{
 it.each(['idle','busy','blocked'])('migration preserves pre-existing %s state, lease and cooldown',state=>{
  const sql=new DatabaseSync(':memory:');try{
   sql.exec(readFileSync(new URL('../drizzle/0004_ecb_fx_gate.sql',import.meta.url),'utf8'));
   sql.prepare('UPDATE ecb_fx_source_gate SET status=?,lease_token=?,updated_ms=123,not_before_ms=456').run(state,state==='busy'?'owned-before-migration':null);
   const before=sql.prepare('SELECT * FROM ecb_fx_source_gate').get();
   sql.exec(readFileSync(new URL('../drizzle/0006_ecb_fx_shared_cache.sql',import.meta.url),'utf8'));
   expect(sql.prepare('SELECT * FROM ecb_fx_source_gate').get()).toEqual({...before,payload:null,expires_ms:0,checked_ms:0,error_code:null});
  }finally{sql.close()}
 });
 it.each(['acquire','finish'] as const)('does not retry a %s write that commits after the operation timeout',async phase=>{
  const {sql,db}=database();vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});try{
   const delayed:GateD1={prepare(query){const statement=db.prepare(query);return {bind(...values){const bound=statement.bind(...values);return {async run(){
    if(query===FX_SQL[phase])await new Promise(resolve=>setTimeout(resolve,2100));
    return bound.run();
   }}}}}};
   const retained:Promise<unknown>[]=[];const fetcher=vi.fn(async()=>fxResponse()),service=createFxService(fetcher,Date.now,new D1FxGate(delayed),promise=>{retained.push(promise)});
   const result=service.read();let lifetimeSettled=false;void retained[0].then(()=>{lifetimeSettled=true});await vi.advanceTimersByTimeAsync(2000);
   expect(await result).toMatchObject({snapshot:null,source_state:'stopped',error_code:'source_gate_unavailable'});
   expect(fetcher).toHaveBeenCalledTimes(phase==='acquire'?0:1);expect(lifetimeSettled).toBe(false);
   await vi.advanceTimersByTimeAsync(100);await retained[0];expect(lifetimeSettled).toBe(true);
   const cold=await createFxService(fetcher,Date.now,new D1FxGate(db)).read();
   if(phase==='acquire')expect(cold).toMatchObject({snapshot:null,source_state:'unavailable',error_code:'network_error'});
   else expect(cold).toMatchObject({source_state:'available',snapshot:{rates:fxPayload().snapshot!.rates}});
   expect(fetcher).toHaveBeenCalledTimes(phase==='acquire'?0:1);
  }finally{vi.useRealTimers();sql.close()}
 });
 it('serializes independent gates, never takes over busy leases, and rejects stale owners',async()=>{
  const {sql,db}=database();try{
   const gates=Array.from({length:12},()=>new D1FxGate(db));const results=await Promise.allSettled(gates.map(g=>g.acquire()));
   expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
   sql.exec('UPDATE ecb_fx_source_gate SET updated_ms=0,not_before_ms=0');
   await expect(new D1FxGate(db).acquire()).rejects.toMatchObject({code:'source_busy'});
   await expect(gates[0].release('wrong-owner',{kind:'denied'})).rejects.toMatchObject({code:'source_stale_lease'});
   expect((await gates[0].inspect()).state).toBe('busy');
  }finally{sql.close()}
 });
 it.each([['success',CHECK_INTERVAL_MS],['temporary_failure',RETRY_INTERVAL_MS]] as const)('shares conservative %s cooldown with new gates',async(kind,delay)=>{
  const {sql,db}=database();try{const gate=new D1FxGate(db),lease=await gate.acquire();const before=Date.now();await gate.release(lease.token,kind==='success'?{kind,snapshot:{...fxPayload().snapshot!,retrieved_at:new Date().toISOString()}}:{kind,error:'network_error'});
   const row=sql.prepare('SELECT * FROM ecb_fx_source_gate').get()!;expect(Number(row.not_before_ms)).toBeGreaterThanOrEqual(before+delay);
   await expect(new D1FxGate(db).acquire()).rejects.toMatchObject({code:'source_cooldown'});
  }finally{sql.close()}
 });
 it('serves the identical validated snapshot to a cold worker during the shared hour cooldown',async()=>{
  const {sql,db}=database();try{
   const fetcher=vi.fn(async()=>fxResponse());const warm=await createFxService(fetcher,Date.now,new D1FxGate(db)).read();
   const cold=await createFxService(fetcher,Date.now,new D1FxGate(db)).read();
   expect(cold).toEqual(warm);expect(cold.source_state).toBe('available');expect(cold.snapshot?.rates).toHaveLength(3);expect(fetcher).toHaveBeenCalledTimes(1);
  }finally{sql.close()}
 });
 it('shares transient failure and original acquisition without renewing cache expiry',async()=>{
  const {sql,db}=database();try{
   const fetcher=vi.fn().mockResolvedValueOnce(fxResponse()).mockRejectedValueOnce(new Error('offline'));
   const warm=await createFxService(fetcher,Date.now,new D1FxGate(db)).read();
   const expires=sql.prepare('SELECT expires_ms FROM ecb_fx_source_gate').get()!.expires_ms;
   sql.exec('UPDATE ecb_fx_source_gate SET not_before_ms=0');
   const stale=await createFxService(fetcher,Date.now,new D1FxGate(db)).read();
   expect(stale).toMatchObject({source_state:'stale',error_code:'network_error',snapshot:warm.snapshot});
   expect(await createFxService(fetcher,Date.now,new D1FxGate(db)).read()).toEqual(stale);
   expect(sql.prepare('SELECT expires_ms FROM ecb_fx_source_gate').get()!.expires_ms).toBe(expires);expect(fetcher).toHaveBeenCalledTimes(2);
  }finally{sql.close()}
 });
 it('expires cached values without clearing a cooldown or allowing another source request',async()=>{
  const {sql,db}=database();try{
   const fetcher=vi.fn(async()=>fxResponse());await createFxService(fetcher,Date.now,new D1FxGate(db)).read();
   const snapshot=JSON.parse(String(sql.prepare('SELECT payload FROM ecb_fx_source_gate').get()!.payload));
   snapshot.retrieved_at=new Date(Date.now()-CACHE_TTL_MS-1000).toISOString();
   sql.prepare('UPDATE ecb_fx_source_gate SET payload=?,expires_ms=?').run(JSON.stringify(snapshot),Date.parse(snapshot.retrieved_at)+CACHE_TTL_MS);
   expect(await createFxService(fetcher,Date.now,new D1FxGate(db)).read()).toMatchObject({snapshot:null,source_state:'unavailable',error_code:'cache_expired'});expect(fetcher).toHaveBeenCalledTimes(1);
   expect((await new D1FxGate(db).inspect()).state).toBe('idle');
  }finally{sql.close()}
 });
 it.each(['malformed','duplicate-key','inconsistent-expiry','future-retrieval'])('rejects %s shared cache bytes before fetching or exposing rates',async mode=>{
  const {sql,db}=database();try{
   const fetcher=vi.fn(async()=>fxResponse());await createFxService(fetcher,Date.now,new D1FxGate(db)).read();
   const old=String(sql.prepare('SELECT payload FROM ecb_fx_source_gate').get()!.payload);
   if(mode==='malformed')sql.prepare('UPDATE ecb_fx_source_gate SET payload=?').run('{}');
   if(mode==='duplicate-key')sql.prepare('UPDATE ecb_fx_source_gate SET payload=?').run(old.replace('{','{"schema":"ecb-fx-reference/1",'));
   if(mode==='inconsistent-expiry')sql.exec('UPDATE ecb_fx_source_gate SET expires_ms=expires_ms+1');
   if(mode==='future-retrieval'){const snapshot=JSON.parse(old);snapshot.retrieved_at=new Date(Date.now()+120_000).toISOString();sql.prepare('UPDATE ecb_fx_source_gate SET payload=?,expires_ms=?').run(JSON.stringify(snapshot),Date.parse(snapshot.retrieved_at)+CACHE_TTL_MS);}
   expect(await createFxService(fetcher,Date.now,new D1FxGate(db)).read()).toMatchObject({snapshot:null,source_state:'stopped',error_code:'source_gate_unavailable'});expect(fetcher).toHaveBeenCalledTimes(1);
  }finally{sql.close()}
 });
 it('suppresses an existing cache while another acquisition is busy, with no time-based takeover',async()=>{
  const {sql,db}=database();try{
   const fetcher=vi.fn(async()=>fxResponse());await createFxService(fetcher,Date.now,new D1FxGate(db)).read();
   sql.exec('UPDATE ecb_fx_source_gate SET not_before_ms=0');await new D1FxGate(db).acquire();
   sql.exec('UPDATE ecb_fx_source_gate SET updated_ms=0,expires_ms=0');
   expect(await createFxService(fetcher,Date.now,new D1FxGate(db)).read()).toMatchObject({snapshot:null,source_state:'unavailable',error_code:'source_busy'});expect(fetcher).toHaveBeenCalledTimes(1);
  }finally{sql.close()}
 });
 it('does not allow a stale lease to publish rates or overwrite newer reference dates',async()=>{
  const {sql,db}=database();try{
   const gate=new D1FxGate(db),lease=await gate.acquire();const snapshot={...fxPayload().snapshot!,retrieved_at:new Date().toISOString()};
   await expect(gate.release('wrong-owner',{kind:'success',snapshot})).rejects.toMatchObject({code:'source_stale_lease'});
   expect(sql.prepare('SELECT payload FROM ecb_fx_source_gate').get()!.payload).toBeNull();
   await gate.release(lease.token,{kind:'success',snapshot});sql.exec('UPDATE ecb_fx_source_gate SET not_before_ms=0');
   const next=await gate.acquire();await expect(gate.release(next.token,{kind:'success',snapshot:{...snapshot,reference_date:'2026-06-07'}})).rejects.toMatchObject({code:'source_stale_lease'});
   expect(JSON.parse(String(sql.prepare('SELECT payload FROM ecb_fx_source_gate').get()!.payload)).reference_date).toBe(snapshot.reference_date);expect((await gate.inspect()).state).toBe('busy');
  }finally{sql.close()}
 });
 it('persists denial across services and clears another service cached values',async()=>{
  const {sql,db}=database();try{
   const good=vi.fn(async()=>fxResponse()),warm=createFxService(good,Date.now,new D1FxGate(db));expect((await warm.read()).snapshot).not.toBeNull();
   sql.exec('UPDATE ecb_fx_source_gate SET not_before_ms=0');
   const denied=vi.fn(async()=>new Response(null,{status:451})),cold=createFxService(denied,Date.now,new D1FxGate(db));expect((await cold.read()).source_state).toBe('stopped');
   expect(await warm.read()).toMatchObject({snapshot:null,source_state:'stopped'});
   expect(await createFxService(good,Date.now,new D1FxGate(db)).read()).toMatchObject({snapshot:null,source_state:'stopped'});
   expect(good).toHaveBeenCalledTimes(1);expect(denied).toHaveBeenCalledTimes(1);
  }finally{sql.close()}
 });
 it.each([false,true])('failed denial finish (committed=%s) cannot authorize a cold retry',async committed=>{
  const {sql,db}=database();try{
   const uncertain:GateD1={prepare(query){const statement=db.prepare(query);return {bind(...values){const bound=statement.bind(...values);return {async run(){if(query===FX_SQL.finish){if(committed)await bound.run();throw new Error('uncertain write')}return bound.run()}}}}}};
   const fetcher=vi.fn(async()=>new Response(null,{status:403}));expect(await createFxService(fetcher,Date.now,new D1FxGate(uncertain)).read()).toMatchObject({snapshot:null,source_state:'stopped',error_code:'source_gate_unavailable'});
   await createFxService(fetcher,Date.now,new D1FxGate(db)).read();expect(fetcher).toHaveBeenCalledTimes(1);expect((await new D1FxGate(db).inspect()).state).toBe(committed?'blocked':'busy');
  }finally{sql.close()}
 });
 it('fails closed on unavailable gate before returning cached rates',async()=>{
  const {sql,db}=database();const fetcher=vi.fn(async()=>fxResponse()),service=createFxService(fetcher,Date.now,new D1FxGate(db));await service.read();sql.close();
  expect(await service.read()).toMatchObject({snapshot:null,source_state:'stopped',error_code:'source_gate_unavailable'});expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('requires valid primary gate metadata and never fetches before acquire confirmation',async()=>{
  const fetcher=vi.fn(async()=>fxResponse());const db:GateD1={prepare(){return {bind(){return {async run(){return {success:false}}}}}}};
  expect(await createFxService(fetcher,Date.now,new D1FxGate(db)).read()).toMatchObject({snapshot:null,source_state:'stopped',error_code:'source_gate_unavailable'});expect(fetcher).not.toHaveBeenCalled();
 });
});
