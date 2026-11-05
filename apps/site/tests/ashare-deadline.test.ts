import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {ACQUISITION_BUDGET_MS,createAshareHandler,FIELDS} from '../lib/ashare/ashare';
import type {SnapshotStore} from '../lib/ashare/snapshot-store';
const req=(scope='level1')=>new Request(`https://offline.invalid/api/v1/ashare/snapshot?scope=${scope}`);
const row=Object.fromEntries(FIELDS.map(f=>[f,f==='f12'?'BK0001':f==='f14'?'synthetic':1]));
const good=()=>new Response(JSON.stringify({rc:0,data:{total:1,diff:[row]}}),{headers:{'content-type':'application/json'}});
type Options=NonNullable<Parameters<typeof createAshareHandler>[0]>;
const make=(options:Options)=>createAshareHandler({enabled:()=>true,isolatedForTests:true,...options});
const pause=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
const gate=()=>({acquire:vi.fn(async()=>({token:'synthetic-deadline-owner'})),release:vi.fn(async()=>{})});
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-05T09:35:00Z'));});
afterEach(()=>vi.useRealTimers());
describe('one retained acquisition budget',()=>{
 it('aborts the original source at20s even if client disconnect signal is never delivered',async()=>{
  const g=gate();let aborted=-1;const started=performance.now();
  const fetcher=vi.fn((_url:string,init:RequestInit)=>new Promise<Response>((_,reject)=>init.signal!.addEventListener('abort',()=>{aborted=performance.now()-started;reject(init.signal!.reason);}))); 
  const p=make({sourceGate:g,fetcher})(req());await vi.advanceTimersByTimeAsync(ACQUISITION_BUDGET_MS+1);
  expect((await p).status).toBe(503);expect(aborted).toBe(20_000);expect(g.release).toHaveBeenCalledExactlyOnceWith('synthetic-deadline-owner',{kind:'temporary_failure',reason:'collection_failed'});expect(fetcher).toHaveBeenCalledOnce();
 });
 it('redirects share the original deadline rather than receiving another20s',async()=>{
  const g=gate();let calls=0,aborted=-1;const start=performance.now();
  const fetcher=vi.fn(async(_url:string,init:RequestInit)=>{if(++calls===1){await pause(19_000);return new Response('',{status:302,headers:{location:'https://push2delay.eastmoney.com/api/qt/clist/get'}});}return new Promise<Response>((_,reject)=>init.signal!.addEventListener('abort',()=>{aborted=performance.now()-start;reject(init.signal!.reason);}));});
  const p=make({sourceGate:g,fetcher})(req());await vi.advanceTimersByTimeAsync(20_001);expect((await p).status).toBe(503);expect(aborted).toBe(20_000);expect(fetcher).toHaveBeenCalledTimes(2);expect(g.release).toHaveBeenCalledOnce();
 });
 it('near-deadline redirect-body cleanup cannot start a later redirected fetch',async()=>{
  const g=gate();const fetcher=vi.fn(async()=>{await pause(19_999);return new Response(new ReadableStream({cancel(){return new Promise<void>(()=>{});}}),{status:302,headers:{location:'https://push2delay.eastmoney.com/api/qt/clist/get','content-encoding':'compress'}});});
  const p=make({sourceGate:g,fetcher})(req());await vi.advanceTimersByTimeAsync(21_001);expect((await p).status).toBe(503);expect(fetcher).toHaveBeenCalledOnce();expect(g.release).toHaveBeenCalledOnce();
 });
 it('queue time counts and an expired queued scope never acquires later',async()=>{
  const g=gate();let resolve!:(r:Response)=>void;const f=vi.fn(()=>new Promise<Response>(r=>{resolve=r;}));const h=make({sourceGate:g,fetcher:f});
  const first=h(req());await vi.advanceTimersByTimeAsync(1);const second=h(req('BK0001'));await vi.advanceTimersByTimeAsync(21_000);
  expect(g.acquire).toHaveBeenCalledOnce();expect(g.release).not.toHaveBeenCalled();resolve(good());await Promise.all([first,second]);expect(g.acquire).toHaveBeenCalledOnce();expect(f).toHaveBeenCalledOnce();expect(g.release).toHaveBeenCalledOnce();
 });
 it('late admission settles then releases its own token without source access',async()=>{
  const g=gate();g.acquire.mockImplementation(async()=>{await pause(21_000);return {token:'synthetic-deadline-owner'};});const f=vi.fn();const p=make({sourceGate:g,fetcher:f})(req());
  await vi.advanceTimersByTimeAsync(21_001);expect((await p).status).toBe(503);expect(f).not.toHaveBeenCalled();expect(g.release).toHaveBeenCalledOnce();
 });
 it('late403 wins over deadline and persists before hanging disposal',async()=>{
  const g=gate();const f=vi.fn((_url:string,init:RequestInit)=>new Promise<Response>(resolve=>init.signal!.addEventListener('abort',()=>resolve(new Response(new ReadableStream({cancel(){return new Promise<void>(()=>{});}}),{status:403})))));
  const h=make({sourceGate:g,fetcher:f});const p=h(req());await vi.advanceTimersByTimeAsync(20_001);expect(g.release).toHaveBeenCalledExactlyOnceWith('synthetic-deadline-owner',{kind:'denied',reason:'source_denial'});await vi.advanceTimersByTimeAsync(1000);expect((await p).headers.get('x-ashare-recovery')).toBe('stopped');await h(req('BK0001'));expect(f).toHaveBeenCalledOnce();
 });
 it('stalled body with hanging cancellation still releases after deadline+bounded disposal',async()=>{
  const g=gate();const f=vi.fn(async()=>new Response(new ReadableStream({cancel(){return new Promise<void>(()=>{});}}),{headers:{'content-type':'application/json'}}));
  const p=make({sourceGate:g,fetcher:f})(req());await vi.advanceTimersByTimeAsync(21_001);expect((await p).status).toBe(503);expect(g.release).toHaveBeenCalledOnce();
 });
 it('initial cache reads and cooldown consume the same original20s budget',async()=>{
  const g=gate();let admissions=0,aborted=-1;g.acquire.mockImplementation(async()=>{if(++admissions===1)throw Object.assign(new Error('cooldown'),{code:'source_cooldown'});return {token:'synthetic-deadline-owner'};});
  const store:SnapshotStore={read:async()=>{await pause(1500);return {canAcquire:true};},commit:vi.fn()};const start=performance.now();
  const f=vi.fn((_url:string,init:RequestInit)=>new Promise<Response>((_,reject)=>init.signal!.addEventListener('abort',()=>{aborted=performance.now()-start;reject(init.signal!.reason);})));const p=make({sourceGate:g,snapshotStore:store,fetcher:f})(req());
  await vi.advanceTimersByTimeAsync(22_001);expect((await p).status).toBe(503);expect(aborted).toBe(20_000);expect(g.acquire).toHaveBeenCalledTimes(2);expect(g.release).toHaveBeenCalledOnce();expect(store.commit).not.toHaveBeenCalled();
 });
 it('unsettled fetch retains ownership; no guessed release after elapsed budget',async()=>{
  const g=gate();const h=make({sourceGate:g,fetcher:vi.fn(()=>new Promise<Response>(()=>{}))});void h(req());await vi.advanceTimersByTimeAsync(90_000);expect(g.release).not.toHaveBeenCalled();expect(g.acquire).toHaveBeenCalledOnce();
 });
 it('unsettled atomic commit never causes a second release or success publication',async()=>{
  const g=gate();const store:SnapshotStore={read:async()=>({canAcquire:true}),commit:vi.fn(()=>new Promise<void>(()=>{}))};let finished=false;
  void make({sourceGate:g,snapshotStore:store,fetcher:async()=>good()})(req()).then(()=>{finished=true;});await vi.advanceTimersByTimeAsync(90_000);expect(store.commit).toHaveBeenCalledOnce();expect(g.release).not.toHaveBeenCalled();expect(finished).toBe(false);
 });
});

it('cancellation after collection validation but before commit prevents publication',async()=>{
 const g=gate();const controller=new AbortController();let checks=0;
 const store:SnapshotStore={read:async()=>({canAcquire:true}),commit:vi.fn(async()=>{})};
 const enabled=()=>{if(++checks===6)controller.abort();return true;};
 const response=await make({sourceGate:g,snapshotStore:store,fetcher:async()=>good(),enabled})(new Request('https://offline.invalid/api/v1/ashare/snapshot',{signal:controller.signal}));
 expect(response.status).toBe(503);expect(store.commit).not.toHaveBeenCalled();expect(g.release).toHaveBeenCalledExactlyOnceWith('synthetic-deadline-owner',{kind:'temporary_failure',reason:'collection_failed'});
});

it('absolute deadline prevents admission when a cache promise resumes before its timer callback',async()=>{
 let clock=0,reads=0,finish!:(v:{canAcquire:boolean})=>void;const g=gate();
 const store:SnapshotStore={read:async()=>{if(++reads===2)return new Promise(resolve=>{finish=resolve;});return {canAcquire:true};},commit:vi.fn()};
 const f=vi.fn();const p=make({sourceGate:g,snapshotStore:store,fetcher:f,now:()=>clock})(req());await vi.advanceTimersByTimeAsync(0);
 clock=20_001;finish({canAcquire:true});expect((await p).status).toBe(503);expect(g.acquire).not.toHaveBeenCalled();expect(g.release).not.toHaveBeenCalled();expect(f).not.toHaveBeenCalled();
});
it('absolute clock expiry after admission releases owned token even before timer callback',async()=>{
 let clock=0;const g=gate();g.acquire.mockImplementation(async()=>{clock=20_001;return {token:'synthetic-deadline-owner'};});const f=vi.fn();
 const response=await make({sourceGate:g,fetcher:f,now:()=>clock})(req());expect(response.status).toBe(503);expect(f).not.toHaveBeenCalled();expect(g.release).toHaveBeenCalledOnce();
});
it('valid redirect stream stalled during disposal does not extend the deadline',async()=>{
 const g=gate();const f=vi.fn(async()=>{await pause(19_000);return new Response(new ReadableStream({cancel(){return new Promise<void>(()=>{});}}),{status:302,headers:{location:'https://push2delay.eastmoney.com/api/qt/clist/get','content-type':'text/html'}});});
 const p=make({sourceGate:g,fetcher:f})(req());await vi.advanceTimersByTimeAsync(21_001);expect((await p).status).toBe(503);expect(f).toHaveBeenCalledOnce();expect(g.release).toHaveBeenCalledOnce();
});
it('large pagination stops at the total budget without publishing partial pages or increasing request rate',async()=>{
 const g=gate(),times:number[]=[];let page=0;const store:SnapshotStore={read:async()=>({canAcquire:true}),commit:vi.fn()};
 const f=vi.fn(async()=>{times.push(performance.now());const start=page++*100;return new Response(JSON.stringify({rc:0,data:{total:801,diff:Array.from({length:100},(_,i)=>({...row,f12:'BK'+String(start+i).padStart(4,'0')}))}}),{headers:{'content-type':'application/json'}});});
 const p=make({sourceGate:g,snapshotStore:store,fetcher:f})(req());await vi.advanceTimersByTimeAsync(21_001);expect((await p).status).toBe(503);expect(f).toHaveBeenCalledTimes(7);for(let i=1;i<times.length;i++)expect(times[i]-times[i-1]).toBeGreaterThanOrEqual(3000);expect(store.commit).not.toHaveBeenCalled();expect(g.release).toHaveBeenCalledOnce();
});
