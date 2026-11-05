import {describe,it,expect,vi} from 'vitest';
import {DatabaseSync,type SQLInputValue} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {D1FxGate,FX_SQL} from '../lib/fx/source-gate';
import type {GateD1} from '../lib/ashare/source-gate';
import {createFxService} from '../lib/fx/service';
import {CHECK_INTERVAL_MS,RETRY_INTERVAL_MS} from '../lib/fx/model';
import {fxResponse,FX_NOW} from './fx-fixture';
function database(){
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../drizzle/0004_ecb_fx_gate.sql',import.meta.url),'utf8'));
 const db:GateD1={prepare(query){return {bind(...values){return {async run(){const stmt=sql.prepare(query);const results=stmt.all(...values as SQLInputValue[]) as Record<string,unknown>[];return {success:true,results,meta:{changes:query.startsWith('UPDATE')?results.length:0}}}}}}}};
 return {sql,db};
}
describe('ECB persistent SQLite coordination',()=>{
 it('serializes independent gates, never takes over busy leases, and rejects stale owners',async()=>{
  const {sql,db}=database();try{
   const gates=Array.from({length:12},()=>new D1FxGate(db));const results=await Promise.allSettled(gates.map(g=>g.acquire()));
   expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
   sql.exec('UPDATE ecb_fx_source_gate SET updated_ms=0,not_before_ms=0');
   await expect(new D1FxGate(db).acquire()).rejects.toMatchObject({code:'source_busy'});
   await expect(gates[0].release('wrong-owner',{kind:'denied'})).rejects.toMatchObject({code:'source_stale_lease'});
   expect(await gates[0].inspect()).toBe('busy');
  }finally{sql.close()}
 });
 it.each([['success',CHECK_INTERVAL_MS],['temporary_failure',RETRY_INTERVAL_MS]] as const)('shares conservative %s cooldown with new gates',async(kind,delay)=>{
  const {sql,db}=database();try{const gate=new D1FxGate(db),lease=await gate.acquire();const before=Date.now();await gate.release(lease.token,{kind});
   const row=sql.prepare('SELECT * FROM ecb_fx_source_gate').get()!;expect(Number(row.not_before_ms)).toBeGreaterThanOrEqual(before+delay);
   await expect(new D1FxGate(db).acquire()).rejects.toMatchObject({code:'source_cooldown'});
  }finally{sql.close()}
 });
 it('persists denial across services and clears another service cached values',async()=>{
  const {sql,db}=database();try{
   const good=vi.fn(async()=>fxResponse()),warm=createFxService(good,()=>FX_NOW,new D1FxGate(db));expect((await warm.read()).snapshot).not.toBeNull();
   sql.exec('UPDATE ecb_fx_source_gate SET not_before_ms=0');
   const denied=vi.fn(async()=>new Response(null,{status:451})),cold=createFxService(denied,()=>FX_NOW,new D1FxGate(db));expect((await cold.read()).source_state).toBe('stopped');
   expect(await warm.read()).toMatchObject({snapshot:null,source_state:'stopped'});
   expect(await createFxService(good,()=>FX_NOW,new D1FxGate(db)).read()).toMatchObject({snapshot:null,source_state:'stopped'});
   expect(good).toHaveBeenCalledTimes(1);expect(denied).toHaveBeenCalledTimes(1);
  }finally{sql.close()}
 });
 it.each([false,true])('failed denial finish (committed=%s) cannot authorize a cold retry',async committed=>{
  const {sql,db}=database();try{
   const uncertain:GateD1={prepare(query){const statement=db.prepare(query);return {bind(...values){const bound=statement.bind(...values);return {async run(){if(query===FX_SQL.finish){if(committed)await bound.run();throw new Error('uncertain write')}return bound.run()}}}}}};
   const fetcher=vi.fn(async()=>new Response(null,{status:403}));expect(await createFxService(fetcher,()=>FX_NOW,new D1FxGate(uncertain)).read()).toMatchObject({snapshot:null,source_state:'stopped',error_code:'source_gate_unavailable'});
   await createFxService(fetcher,()=>FX_NOW,new D1FxGate(db)).read();expect(fetcher).toHaveBeenCalledTimes(1);expect(await new D1FxGate(db).inspect()).toBe(committed?'blocked':'busy');
  }finally{sql.close()}
 });
 it('fails closed on unavailable gate before returning cached rates',async()=>{
  const {sql,db}=database();const fetcher=vi.fn(async()=>fxResponse()),service=createFxService(fetcher,()=>FX_NOW,new D1FxGate(db));await service.read();sql.close();
  expect(await service.read()).toMatchObject({snapshot:null,source_state:'stopped',error_code:'source_gate_unavailable'});expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('requires valid primary gate metadata and never fetches before acquire confirmation',async()=>{
  const fetcher=vi.fn(async()=>fxResponse());const db:GateD1={prepare(){return {bind(){return {async run(){return {success:false}}}}}}};
  expect(await createFxService(fetcher,()=>FX_NOW,new D1FxGate(db)).read()).toMatchObject({snapshot:null,source_state:'stopped',error_code:'source_gate_unavailable'});expect(fetcher).not.toHaveBeenCalled();
 });
});
