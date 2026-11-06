import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createAcquisitionDiagnostics,logAcquisitionDiagnostics,type AcquisitionPhase} from '../lib/ashare/acquisition-diagnostics';
import {createAshareHandler,FIELDS} from '../lib/ashare/ashare';
import type {SnapshotStore} from '../lib/ashare/snapshot-store';
const req=()=>new Request('https://offline.invalid/api/v1/ashare/snapshot');
const secret='SYNTHETIC_PRIVATE_SENTINEL';
const row=Object.fromEntries(FIELDS.map(f=>[f,f==='f12'?'BK0001':f==='f14'?secret:1]));
const good=()=>new Response(JSON.stringify({rc:0,data:{total:1,diff:[row]}}),{headers:{'content-type':'application/json'}});
const gate=()=>({acquire:vi.fn(async()=>({token:secret})),release:vi.fn(async()=>{})});
type Options=NonNullable<Parameters<typeof createAshareHandler>[0]>;
const make=(options:Options)=>createAshareHandler({enabled:()=>true,isolatedForTests:true,...options});
const pause=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
function phaseEvents() {
  return vi.mocked(console.info).mock.calls.filter(args=>args[0]==='[ashare phases]').map(args=>JSON.parse(args[1] as string));
}
beforeEach(()=>{vi.useFakeTimers();vi.spyOn(console,'info').mockImplementation(()=>{});vi.spyOn(console,'warn').mockImplementation(()=>{});});
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});
describe('privacy-safe acquisition phase metadata',()=>{
 it('separates validated redirect pacing from a stalled redirected response at the original deadline',async()=>{
  const g=gate(),times:number[]=[];
  const fetcher=vi.fn(async(_url:string,init:RequestInit)=>{
   times.push(performance.now());
   if(times.length===1){await pause(800);return new Response('',{status:302,headers:{location:'https://push2delay.eastmoney.com/api/qt/clist/get'}});}
   return new Promise<Response>((_,reject)=>init.signal!.addEventListener('abort',()=>reject(init.signal!.reason)));
  });
  const p=make({sourceGate:g,fetcher})(req());await vi.advanceTimersByTimeAsync(20_001);
  expect((await p).status).toBe(503);expect(times).toEqual([0,3000]);
  const [deadline,end]=phaseEvents();
  expect(deadline).toMatchObject({event:'acquisition_deadline',phase:'source_headers',elapsed_ms:20000,phase_elapsed_ms:17000,route:'official_redirect',last_requested_page:1,source_requests_this_invocation:2,validated_pages_this_invocation:0,result:'unfinished'});
  expect(deadline.phase_durations_ms).toMatchObject({source_headers:17800,source_pacing:2200});
  expect(end).toMatchObject({event:'acquisition_finished',failed_phase:'source_headers',result:'failed'});
  expect(g.release).toHaveBeenCalledExactlyOnceWith(secret,{kind:'temporary_failure',reason:'deadline'});
 });
 it('records stalled body rather than headers and retains the failure phase through cleanup',async()=>{
  const g=gate(),fetcher=vi.fn(async()=>new Response(new ReadableStream({cancel(){return new Promise<void>(()=>{});}}),{headers:{'content-type':'application/json'}}));
  const p=make({sourceGate:g,fetcher})(req());await vi.advanceTimersByTimeAsync(21_001);
  expect((await p).status).toBe(503);expect(fetcher).toHaveBeenCalledOnce();expect(g.release).toHaveBeenCalledOnce();
  expect(phaseEvents()[0]).toMatchObject({phase:'source_body',elapsed_ms:20000,source_requests_this_invocation:1});
  expect(phaseEvents().at(-1)).toMatchObject({failed_phase:'source_body',result:'failed'});
  expect(phaseEvents().at(-1).elapsed_ms).toBeGreaterThanOrEqual(20000);expect(phaseEvents().at(-1).elapsed_ms).toBeLessThanOrEqual(21000);
 });
 it('records queued deadlines without another source request or an invented release',async()=>{
  const g=gate();let finish!:(response:Response)=>void;const fetcher=vi.fn(()=>new Promise<Response>(resolve=>{finish=resolve;}));const h=make({sourceGate:g,fetcher});
  const first=h(req());await vi.advanceTimersByTimeAsync(1);
  const second=h(new Request('https://offline.invalid/api/v1/ashare/snapshot?scope=BK0001'));await vi.advanceTimersByTimeAsync(20_001);
  expect(phaseEvents().filter(e=>e.event==='acquisition_deadline').map(e=>e.phase)).toEqual(['source_headers','queue']);
  expect(g.acquire).toHaveBeenCalledOnce();expect(g.release).not.toHaveBeenCalled();expect(fetcher).toHaveBeenCalledOnce();
  finish(good());await Promise.all([first,second]);expect(g.release).toHaveBeenCalledOnce();expect(fetcher).toHaveBeenCalledOnce();
 });
 it('records pending atomic commit without releasing or falsely publishing success',async()=>{
  const g=gate(),store:SnapshotStore={read:async()=>({canAcquire:true}),commit:vi.fn(()=>new Promise<void>(()=>{}))};
  void make({sourceGate:g,snapshotStore:store,fetcher:async()=>good()})(req());await vi.advanceTimersByTimeAsync(90_000);
  expect(phaseEvents()).toHaveLength(1);expect(phaseEvents()[0]).toMatchObject({phase:'snapshot_commit',result:'unfinished',validated_pages_this_invocation:1});
  expect(store.commit).toHaveBeenCalledOnce();expect(g.release).not.toHaveBeenCalled();
 });
 it('does not downgrade a late denial when the deadline has already been observed',async()=>{
  const g=gate();const fetcher=vi.fn((_url:string,init:RequestInit)=>new Promise<Response>(resolve=>init.signal!.addEventListener('abort',()=>resolve(new Response(secret,{status:403})))));
  const h=make({sourceGate:g,fetcher});const p=h(req());await vi.advanceTimersByTimeAsync(20_001);
  expect((await p).headers.get('x-ashare-recovery')).toBe('stopped');expect(g.release).toHaveBeenCalledExactlyOnceWith(secret,{kind:'denied',reason:'source_denial'});
  expect(phaseEvents().at(-1)).toMatchObject({failed_phase:'response_validation',result:'failed'});
  await h(req());expect(fetcher).toHaveBeenCalledOnce();
  expect(JSON.stringify([...vi.mocked(console.info).mock.calls,...vi.mocked(console.warn).mock.calls])).not.toContain(secret);
 });
 it('logs no row identity, lease token, exception, request header, response body or URL',async()=>{
  const g=gate();const fetcher=vi.fn(async()=>good());
  expect((await make({sourceGate:g,fetcher})(new Request(req(),{headers:{authorization:secret,'x-identity':secret}}))).status).toBe(200);
  expect(phaseEvents()).toHaveLength(1);expect(phaseEvents()[0]).toMatchObject({result:'snapshot_published',validated_pages_this_invocation:1,source_requests_this_invocation:1});
  await make({sourceGate:gate(),fetcher:async()=>{throw new Error('https://'+secret+'.invalid/?token='+secret);}})(req());
  const text=JSON.stringify([...vi.mocked(console.info).mock.calls,...vi.mocked(console.warn).mock.calls]);
  expect(text).not.toContain(secret);expect(text).not.toMatch(/https?:|BK0001|authorization|lease_token/);
 });
 it('keeps phase diagnostics inert if the added sink fails',async()=>{
  vi.mocked(console.info).mockImplementation(prefix=>{if(prefix==='[ashare phases]')throw new Error(secret);});
  const g=gate(),fetcher=vi.fn(async()=>good());expect((await make({sourceGate:g,fetcher})(req())).status).toBe(200);
  expect(fetcher).toHaveBeenCalledOnce();expect(g.release).toHaveBeenCalledExactlyOnceWith(secret,{kind:'success'});
 });
 it('does not emit an acquisition trace or access the source on status reads',async()=>{
  const fetcher=vi.fn(),g=gate();expect((await make({sourceGate:g,fetcher})(new Request('https://offline.invalid/api/v1/ashare/status'))).status).toBe(200);
  expect(phaseEvents()).toEqual([]);expect(fetcher).not.toHaveBeenCalled();expect(g.acquire).not.toHaveBeenCalled();
 });
 it('accepts only fixed enums and bounded numbers; invalid clocks stay unknown',()=>{
  let time=0;const trace=createAcquisitionDiagnostics(()=>time,0);trace.enter('source_headers');trace.request(1,'primary');
  trace.enter(secret as AcquisitionPhase);trace.result(secret as 'failed');trace.request(NaN,secret as 'primary');
  time=100;trace.enter('source_body');time=150;trace.failure();trace.enter('body_cleanup');time=175;
  const value=trace.snapshot();expect(value).toMatchObject({phase:'body_cleanup',failed_phase:'source_body',elapsed_ms:175,last_requested_page:null,route:null,result:'unfinished',phase_durations_ms:{source_headers:100,source_body:50,body_cleanup:25}});
  expect(JSON.stringify(value)).not.toContain(secret);
  time=NaN;expect(trace.snapshot().elapsed_ms).toBeNull();
  expect(()=>logAcquisitionDiagnostics('acquisition_finished',trace)).not.toThrow();
 });
});
