import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {setTimeout as yieldToCrypto} from 'node:timers/promises';
import {createAshareHandler,FIELDS,type Row} from '../lib/ashare/ashare';
import {type Snapshot} from '../lib/ashare/snapshot';
import {type Stage} from '../lib/ashare/stage';
import {runCollectionBatch} from '../lib/ashare/collection-batch';
import {consumeReply,emptyState,type EvidenceState} from '../components/ashare/client';
import {parseScope} from '../lib/ashare/snapshot';
import {StageSaveNotStarted,type StageStore} from '../lib/ashare/stage-store';
import type {SourceGate,SourceOutcome} from '../lib/ashare/source-gate';
import type {SnapshotStore} from '../lib/ashare/snapshot-store';
const req=()=>new Request('https://offline.invalid/api/v1/ashare/snapshot?scope=BK1216');
const row=(id:number):Row=>Object.fromEntries(FIELDS.map(f=>[f,f==='f12'?String(id).padStart(6,'0'):f==='f14'?`Synthetic ${id}`:id%2?-id:id])) as Row;
const makeRow=(id:number)=>({...row(id),f2:1,f3:1});
function rig(total=801,redirect=true,expireStages=false,latency=0){
 let gateState:'idle'|'busy'|'blocked'='idle',notBefore=0,stage:Stage|undefined,snapshot:Snapshot|undefined;
 const attempts:{page:number;at:number;host:string}[]=[],outcomes:SourceOutcome[]=[];
 let failure:'total'|'order'|'denied'|'deadline'|undefined;
 const gate:SourceGate={acquire:vi.fn(async()=>{if(gateState!=='idle')throw Object.assign(new Error(),{code:gateState==='blocked'?'source_denied':'source_busy'});if(Date.now()<notBefore)throw Object.assign(new Error(),{code:'source_cooldown'});gateState='busy';return {token:'owner'};}),release:vi.fn(async(_token,outcome)=>{outcomes.push(outcome);gateState=outcome.kind==='denied'?'blocked':'idle';notBefore=Date.now()+(outcome.kind==='temporary_failure'?60000:3000);}),inspect:async()=>gateState==='blocked'?'source_denied':gateState==='busy'?'source_busy':Date.now()<notBefore?'source_cooldown':null};
 const store:SnapshotStore={read:async()=>({canAcquire:gateState==='idle'&&Date.now()>=notBefore,...(snapshot?{snapshot,ageMs:Date.now()-Date.parse(snapshot.collection_started_at??snapshot.fetched_at)}:{}),...(gateState==='blocked'?{code:'source_denied' as const}:gateState==='busy'?{code:'source_busy' as const}:Date.now()<notBefore?{code:'source_cooldown' as const}:{})}),commit:vi.fn(async(_token,value)=>{snapshot=value;stage=undefined;await gate.release('owner',{kind:'success'});})};
 const stages:StageStore={read:vi.fn(async()=>{if(expireStages&&stage&&Date.now()-Date.parse(stage.started_at)>=180000)stage=undefined;return stage;}),save:vi.fn(async(_token,value)=>{stage=value;await gate.release('owner',{kind:'success'});}),discard:vi.fn(async()=>{stage=undefined;})};
 const fetcher=vi.fn(async(url:string,init:RequestInit)=>{
  const u=new URL(url),page=Number(u.searchParams.get('pn'));attempts.push({page,at:Date.now(),host:u.hostname});
  if(failure==='denied')return new Response('',{status:403});
  if(failure==='deadline')return await new Promise<Response>((_,reject)=>init.signal!.addEventListener('abort',()=>reject(init.signal!.reason)));
  if(redirect&&u.hostname==='push2.eastmoney.com')return new Response('',{status:302,headers:{location:'https://push2delay.eastmoney.com/api/qt/clist/get'}});
  if(latency)await new Promise(resolve=>setTimeout(resolve,latency));
  const count=failure==='total'?total+1:total;
  const start=(page-1)*100,rows=Array.from({length:Math.min(100,count-start)},(_,i)=>makeRow(count-start-i));
  if(failure==='order')rows[0]=makeRow(total+1);
  return new Response(JSON.stringify({rc:0,data:{total:count,diff:rows}}),{headers:{'content-type':'application/json'}});
 });
 const handler=()=>createAshareHandler({enabled:()=>true,isolatedForTests:true,sourceGate:gate,snapshotStore:store,stageStore:stages,fetcher});
 return {handler,attempts,outcomes,fetcher,gate,store,stages,getStage:()=>stage,getSnapshot:()=>snapshot,fail:(value:typeof failure)=>{failure=value;}};
}
async function settle<T>(pending:Promise<T>):Promise<T>{let done=false;void pending.then(()=>{done=true;},()=>{done=true;});for(let i=0;i<50&&!done;i++)await vi.advanceTimersByTimeAsync(500);return pending;}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-05T12:00:00Z'));});
afterEach(()=>vi.useRealTimers());
describe('normal gated staged pagination',()=>{
 it('publishes 801 complete stocks after three cold invocations, no partial rows or denominator',async()=>{
  const r=rig();
  for(let part=0;part<2;part++){
   const response=await settle(r.handler()(req()));expect(response.status).toBe(503);
   expect(response.headers.get('x-ashare-error-code')).toBe('collection_in_progress');
   expect(Number(response.headers.get('retry-after'))).toBeLessThanOrEqual(3);
   const json=await response.json();expect(json).not.toHaveProperty('rows');expect(json).not.toHaveProperty('source_total');
   expect(r.getSnapshot()).toBeUndefined();expect(r.getStage()?.page_count).toBe((part+1)*3);
   await vi.advanceTimersByTimeAsync(3100);
  }
  const response=await settle(r.handler()(req()));expect(response.status).toBe(200);
  const json=await response.json() as Snapshot&{source_observed_at:null;stale:boolean};
  expect(json.rows).toHaveLength(801);expect(new Set(json.rows.map(row=>row.f12)).size).toBe(801);expect(json.source_total).toBe(801);expect(json.page_count).toBe(9);
  expect(json.source_observed_at).toBeNull();expect(json.collection_started_at).toBe('2026-11-05T12:00:00.000Z');
  expect(r.getStage()).toBeUndefined();expect(r.store.commit).toHaveBeenCalledOnce();expect(r.stages.save).toHaveBeenCalledTimes(2);
  expect(r.attempts.map(a=>a.page)).toEqual([1,1,2,3,4,5,6,7,8,9]);
  expect(r.attempts.filter(a=>a.host==='push2.eastmoney.com')).toHaveLength(1);
  for(let i=1;i<r.attempts.length;i++)expect(r.attempts[i].at-r.attempts[i-1].at).toBeGreaterThanOrEqual(3000);
  expect(r.outcomes).toEqual([{kind:'success'},{kind:'success'},{kind:'success'}]);
 });
 it.each(['total','order'] as const)('discards staged rows after %s drift and never publishes partial coverage',async failure=>{
  const r=rig();await settle(r.handler()(req()));await vi.advanceTimersByTimeAsync(3100);r.fail(failure);
  const response=await settle(r.handler()(req()));expect(response.status).toBe(503);expect((await response.json() as {error_code:string}).error_code).toBe(failure==='total'?'unstable_total':'unstable_order');
  expect(r.getStage()).toBeUndefined();expect(r.getSnapshot()).toBeUndefined();expect(r.store.commit).not.toHaveBeenCalled();expect(r.outcomes.at(-1)?.kind).toBe('temporary_failure');
 });
 it('a denial on resumed page latches before cleanup and prohibits all later access',async()=>{
  const r=rig();await settle(r.handler()(req()));await vi.advanceTimersByTimeAsync(3100);r.fail('denied');
  const result=await settle(r.handler()(req()));expect(result.headers.get('x-ashare-recovery')).toBe('stopped');
  expect(r.stages.discard).not.toHaveBeenCalled();expect(r.outcomes.at(-1)?.kind).toBe('denied');const calls=r.fetcher.mock.calls.length;
  await vi.advanceTimersByTimeAsync(60000);expect((await r.handler()(req())).status).toBe(503);expect(r.fetcher).toHaveBeenCalledTimes(calls);
 });
 it('known save preflight rejection cleans up once and releases a temporary failure',async()=>{
  const r=rig();vi.mocked(r.stages.save).mockRejectedValue(new StageSaveNotStarted());
  const response=await settle(r.handler()(req()));expect(response.headers.get('x-ashare-recovery')).toBe('retry');expect((await response.json() as {error_code:string}).error_code).toBe('stage_invalid');expect(r.stages.discard).toHaveBeenCalledOnce();expect(r.gate.release).toHaveBeenCalledExactlyOnceWith('owner',{kind:'temporary_failure',reason:'collection_failed'});
 });
 it('unknown stage commit retains ownership and never retries or publishes',async()=>{
  const r=rig();vi.mocked(r.stages.save).mockRejectedValue(new Error('uncertain'));
  const result=await settle(r.handler()(req()));expect(result.headers.get('x-ashare-recovery')).toBe('stopped');expect(r.gate.release).not.toHaveBeenCalled();
  const count=r.fetcher.mock.calls.length;await vi.advanceTimersByTimeAsync(60000);expect((await r.handler()(req())).status).toBe(503);expect(r.fetcher).toHaveBeenCalledTimes(count);expect(r.getSnapshot()).toBeUndefined();
 });
 it('uncertain expired-stage cleanup during read never causes another write or release',async()=>{
  const r=rig();vi.mocked(r.stages.read).mockRejectedValue(Object.assign(new Error('unconfirmed stage cleanup'),{code:'source_gate_release_unconfirmed'}));
  const response=await settle(r.handler()(req()));expect(response.headers.get('x-ashare-recovery')).toBe('stopped');expect(r.stages.discard).not.toHaveBeenCalled();expect(r.gate.release).not.toHaveBeenCalled();expect(r.fetcher).not.toHaveBeenCalled();
 });
 it.each([-2000,2000])('uses the DB-aligned timestamp when Worker wall clock differs by %s ms',async skew=>{
  const r=rig(1,false),acquire=vi.mocked(r.gate.acquire).getMockImplementation()!;vi.mocked(r.gate.acquire).mockImplementation(async(scope,signal)=>({...await acquire(scope,signal),acquiredAtMs:Date.now()+skew}));
  const result=await settle(r.handler()(req()));expect(result.status).toBe(200);const snapshot=await result.json() as Snapshot;expect(Date.parse(snapshot.fetched_at)).toBeGreaterThanOrEqual(Date.parse(snapshot.collection_started_at!));expect(r.store.commit).toHaveBeenCalledOnce();
 });
 it('the resumed invocation retains its 20 second guard and releases only confirmed failure',async()=>{
  const r=rig();await settle(r.handler()(req()));await vi.advanceTimersByTimeAsync(3100);r.fail('deadline');const start=Date.now();
  const response=await settle(r.handler()(req()));expect(Date.now()-start).toBe(20000);expect(response.status).toBe(503);expect(r.getStage()).toBeUndefined();expect(r.outcomes.at(-1)?.kind).toBe('temporary_failure');
 });
 it('does not resume an expired window even when a stage provider mistakenly supplies it',async()=>{
  const r=rig();await settle(r.handler()(req()));await vi.advanceTimersByTimeAsync(180001);const count=r.fetcher.mock.calls.length;
  const result=await settle(r.handler()(req()));expect(result.status).toBe(503);expect(r.fetcher).toHaveBeenCalledTimes(count);expect(r.getStage()).toBeUndefined();expect(r.store.commit).not.toHaveBeenCalled();
 });
});

it('stage read failure before source work preserves durable failure count',async()=>{
 const r=rig();vi.mocked(r.stages.read).mockRejectedValueOnce(new Error('stage_invalid'));
 const response=await settle(r.handler()(req()));expect(response.status).toBe(503);
 expect(r.fetcher).not.toHaveBeenCalled();expect(r.gate.release).toHaveBeenCalledWith('owner',{kind:'cancelled',reason:'stage_invalid'});
});
it('abort after lease acquisition before source work preserves durable failure count',async()=>{
 const r=rig(),controller=new AbortController();
 vi.mocked(r.stages.read).mockImplementationOnce(async()=>{controller.abort();return undefined;});
 const response=await settle(r.handler()(new Request('https://offline.invalid/api/v1/ashare/snapshot?scope=BK1216',{signal:controller.signal})));
 expect(response.status).toBe(503);expect(r.fetcher).not.toHaveBeenCalled();expect(r.gate.release).toHaveBeenCalledWith('owner',{kind:'cancelled',reason:'aborted'});
});

// The public UI already continued partial batches. A naive future minute job
// would not: retain the counterexample and verify the reusable finite driver.
it('a bare once-per-minute caller cannot publish 901 rows before stage expiry',async()=>{
 const r=rig(901,false,true),start=Date.now();
 for(let tick=0;tick<7;tick++){
  await vi.advanceTimersByTimeAsync(start+tick*60000-Date.now());
  const response=await settle(r.handler()(req()));expect(response.status).toBe(503);expect(r.getSnapshot()).toBeUndefined();
 }
 expect(r.attempts.map(a=>a.page)).toEqual([1,2,3,4,5,6,7,8,9,1,2,3,4,5,6,7,8,9,1,2,3]);expect(r.store.commit).not.toHaveBeenCalled();
});
it.each([[901,0,4],[2000,0,7],[901,14000,10],[901,11000,10],[901,6500,5]])('finite continuation publishes %s rows with %s ms page latency in %s invocations',async(total,latency,requests)=>{
 const r=rig(total,false,true,latency),scope=parseScope(new URL('https://offline.invalid/?scope=BK1216'));
 let state:EvidenceState=emptyState();
 const pending=runCollectionBatch({request:async signal=>{
  const response=await r.handler()(new Request(req(),{signal}));
  state=consumeReply(state,{status:response.status,payload:await response.json(),errorCode:response.headers.get('x-ashare-error-code')??undefined,recoveryMode:response.headers.get('x-ashare-recovery')??undefined,retryAfter:response.headers.get('retry-after')??undefined},scope,Date.now());
  if(state.continuationAt!==undefined){expect(state.snapshot).toBeNull();expect(r.store.commit).not.toHaveBeenCalled();}
  return state;
 }});
 let done=false;void pending.then(()=>{done=true;});for(let i=0;i<400&&!done;i++){await vi.advanceTimersByTimeAsync(500);await yieldToCrypto(1);}const result=await pending;
 expect(result).toMatchObject({reason:'response',requests});expect(result.value?.snapshot?.rows).toHaveLength(total);expect(result.value?.snapshot?.source_total).toBe(total);
 expect(r.store.commit).toHaveBeenCalledOnce();expect(r.getStage()).toBeUndefined();expect(r.attempts.map(a=>a.page)).toEqual(Array.from({length:Math.ceil(total/100)},(_,i)=>i+1));
 for(let i=1;i<r.attempts.length;i++)expect(r.attempts[i].at-r.attempts[i-1].at).toBeGreaterThanOrEqual(3000);
 expect(Date.parse(r.getSnapshot()!.fetched_at)-Date.parse(r.getSnapshot()!.collection_started_at!)).toBeLessThan(180000);
});
it.each(['denied','total','uncertain-save'] as const)('finite driver ends on resumed %s without a third request',async failure=>{
 const r=rig(901,false,true),scope=parseScope(new URL('https://offline.invalid/?scope=BK1216'));let state:EvidenceState=emptyState(),requests=0;
 const pending=runCollectionBatch({request:async signal=>{
  const response=await r.handler()(new Request(req(),{signal}));requests++;
  state=consumeReply(state,{status:response.status,payload:await response.json(),errorCode:response.headers.get('x-ashare-error-code')??undefined,recoveryMode:response.headers.get('x-ashare-recovery')??undefined,retryAfter:response.headers.get('retry-after')??undefined},scope,Date.now());
  if(requests===1){if(failure==='uncertain-save')vi.mocked(r.stages.save).mockRejectedValueOnce(new Error('unknown commit'));else r.fail(failure);}
  return state;
 }});
 let done=false;void pending.then(()=>{done=true;});for(let i=0;i<100&&!done;i++){await vi.advanceTimersByTimeAsync(500);await yieldToCrypto(1);}
 const result=await pending;expect(result.requests).toBe(2);expect(result.reason).toBe('response');expect(result.value?.continuationAt).toBeUndefined();expect(r.store.commit).not.toHaveBeenCalled();expect(r.getSnapshot()).toBeUndefined();
 const calls=r.fetcher.mock.calls.length;await vi.advanceTimersByTimeAsync(900000);expect(r.fetcher).toHaveBeenCalledTimes(calls);expect(r.gate.release).toHaveBeenCalledTimes(failure==='uncertain-save'?1:2);
});
