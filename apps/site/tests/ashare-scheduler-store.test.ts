import {describe,expect,it} from 'vitest';
import {DatabaseSync, type SQLInputValue} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {SchedulerStore} from '../scheduler/state';
import {type SnapshotD1} from '../lib/ashare/snapshot-store';
import {type D1Result} from '../lib/ashare/source-gate';
function fixture(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(readFileSync(new URL('../scheduler/schema.sql',import.meta.url),'utf8'));
 for(const name of ['0001_wild_jigsaw','0019_lean_golden_guardian'])sqlite.exec(readFileSync(new URL(`../drizzle/${name}.sql`,import.meta.url),'utf8'));
 const db:SnapshotD1={prepare(sql){return {bind(...values:unknown[]){return {async run():Promise<D1Result>{
  const results=sqlite.prepare(sql).all(...values as SQLInputValue[]) as Record<string,unknown>[];
  return {success:true,results,meta:{changes:/^(INSERT|UPDATE|DELETE)/.test(sql)?Number(sqlite.prepare('SELECT changes() AS n').get()!.n):0}};
 }};}};},async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
 const row=()=>sqlite.prepare('SELECT * FROM ashare_scheduler_job').get();
 const health=()=>sqlite.prepare(readFileSync(new URL('../scheduler/status.sql',import.meta.url),'utf8')).all();
 return {sqlite,db,row,health,store:new SchedulerStore(db)};
}
const completed={code:'complete_snapshot',stopped:false,requests:1,acquisitionMs:Date.now()};
describe('durable scheduler state and monitoring',()=>{
 it('deduplicates the entire minute and preserves ownership across store instances',async()=>{
  const f=fixture(),now=Date.now(),first=await f.store.claim(['level1'],now);
  expect(first.claim?.scope).toBe('level1');
  expect((await new SchedulerStore(f.db).claim(['level1'],now)).code).toBe('scheduler_busy');
  await f.store.finish(first.claim!,completed);
  expect((await f.store.claim(['level1'],now)).code).toBe('duplicate_or_delayed_tick');
  expect((await f.store.claim(['level1'],Math.floor(now/60000)*60000+59999)).code).toBe('duplicate_or_delayed_tick');
  expect(f.row()?.status).toBe('idle');
 });
 it('rejects delayed, future and malformed event clocks without source admission',async()=>{
  for(const time of [Date.now()-121000,Date.now()+61000,NaN,-1,1.1,Number.MAX_SAFE_INTEGER]){
   const f=fixture();expect((await f.store.claim(['level1'],time)).code).toBe('duplicate_or_delayed_tick');expect(f.row()?.status).not.toBe('busy');
  }
  // The raw timestamp matters, not only its rounded minute.
  const f=fixture();expect((await f.store.claim(['level1'],Date.now()+3000)).code).toBe('duplicate_or_delayed_tick');
 });
 it('does not internally queue busy ticks, but reevaluates an explicit redelivery',async()=>{
  const f=fixture(),now=Date.now(),scopes=['BK0001','level1'];
  const first=await f.store.claim(scopes,now-60000);
  expect((await f.store.claim(scopes,now)).code).toBe('scheduler_busy');
  await f.store.finish(first.claim!,completed);expect(f.row()?.cursor).toBe(1);
  expect(f.row()?.last_tick_ms).toBe(Math.floor((now-60000)/60000)*60000);
  const redelivered=await f.store.claim(scopes,now);expect(redelivered.claim?.scope).toBe('level1');
 });
 it('accepts a recent delayed event then fairly selects the next configured scope',async()=>{
  const f=fixture(),now=Date.now(),scopes=['BK0001','level1'];
  const first=await f.store.claim(scopes,now-60000);expect(first.claim?.scope).toBe('BK0001');await f.store.finish(first.claim!,completed);
  const next=await new SchedulerStore(f.db).claim(scopes,now);expect(next.claim?.scope).toBe('level1');await f.store.finish(next.claim!,completed);expect(f.row()?.cursor).toBe(0);
 });
 it('does not reset a stopped job or silently alter its scope config',async()=>{
  const f=fixture(),now=Date.now();const first=await f.store.claim(['level1'],now-60000);await f.store.finish(first.claim!,completed);
  expect((await f.store.claim(['BK0001'],now)).code).toBe('scheduler_config_changed');expect(f.row()?.scopes_json).toBe('["level1"]');
  const next=await f.store.claim(['level1'],now);await f.store.finish(next.claim!,{...completed,stopped:true,code:'source_denied'});
  expect((await f.store.claim(['level1'],now)).code).toBe('scheduler_stopped');
 });
 it('never steals stale ownership or changes another job with a stale finish token',async()=>{
  const f=fixture(),first=await f.store.claim(['level1'],Date.now());
  f.sqlite.exec('UPDATE ashare_scheduler_job SET last_started_ms=0');
  expect((await f.store.claim(['level1'],Date.now())).code).toBe('scheduler_busy');
  await expect(f.store.finish({...first.claim!,token:'wrong'},completed)).rejects.toThrow('scheduler_store_unconfirmed');
  expect(f.row()?.lease_token).toBe(first.claim?.token);expect(f.sqlite.prepare('SELECT count(*) AS n FROM ashare_scheduler_scope').get()?.n).toBe(0);
 });
 it('keeps scheduler ownership when a transactional finish fails',async()=>{
  const f=fixture(),first=await f.store.claim(['level1'],Date.now());
  await expect(f.store.finish(first.claim!,{...completed,requests:21})).rejects.toThrow();
  expect(f.row()?.status).toBe('busy');expect(f.sqlite.prepare('SELECT count(*) AS n FROM ashare_scheduler_scope').get()?.n).toBe(0);
 });
 it('does not repeat an already-committed finish whose response was lost',async()=>{
  const f=fixture(),now=Date.now(),first=await f.store.claim(['BK0001','level1'],now-60000);
  const uncertain=new SchedulerStore({...f.db,async batch(statements){await f.db.batch(statements);throw new Error('response lost after commit');}});
  await expect(uncertain.finish(first.claim!,completed)).rejects.toThrow();
  expect(f.row()?.status).toBe('idle');expect(f.row()?.cursor).toBe(1);
  expect((await f.store.claim(['BK0001','level1'],now-60000)).code).toBe('duplicate_or_delayed_tick');
  const next=await f.store.claim(['BK0001','level1'],now);expect(next.claim?.scope).toBe('level1');
  expect(f.sqlite.prepare('SELECT count(*) AS n FROM ashare_scheduler_scope').get()?.n).toBe(1);
 });
 it('monitors missing ticks, missed admissions, stuck jobs and actual acquisition gaps without writes',async()=>{
  const f=fixture();expect(f.health()[0].health).toBe('never_ran');
  const first=await f.store.claim(['level1'],Date.now());expect(f.health()[0].health).toBe('running');
  f.sqlite.exec('UPDATE ashare_scheduler_job SET last_started_ms=0');expect(f.health()[0].health).toBe('outcome_unconfirmed');
  await f.store.finish(first.claim!,{...completed,acquisitionMs:1});
  expect(f.health()[0].health).toBe('admission_gap');expect(f.health().some(row=>row.health==='acquisition_gap')).toBe(true);
  f.sqlite.exec('UPDATE ashare_scheduler_job SET last_seen_ms=0');const before=f.row();expect(f.health()[0].health).toBe('tick_gap');expect(f.row()).toEqual(before);
 });
 it('retains the real acquisition clock across cached reads and failed checks',async()=>{
  const f=fixture(),now=Date.now(),first=await f.store.claim(['level1'],now-60000);await f.store.finish(first.claim!,{...completed,acquisitionMs:1000});
  const next=await f.store.claim(['level1'],now);await f.store.finish(next.claim!,{...completed,code:'source_cooldown',acquisitionMs:null});
  expect(f.sqlite.prepare('SELECT last_acquisition_ms FROM ashare_scheduler_scope').get()?.last_acquisition_ms).toBe(1000);
 });
});
