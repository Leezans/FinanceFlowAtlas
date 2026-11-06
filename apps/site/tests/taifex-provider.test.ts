import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {TAIFEX_URL} from '../lib/options/taifex/adapter';
import {FUTURES_URL} from '../lib/futures/taifex/adapter';
import {createTaifexProvider,type TaifexGate} from '../lib/taifex/handler';
import {bundleSchema,cacheSchema,serializeBundle,utf8Bytes,MAX_CACHE_BYTES,MAX_ACQUISITION_MS,type TaifexBundle} from '../lib/taifex/model';
import {D1TaifexGate,TAIFEX_SQL} from '../lib/taifex/source-gate';
import {MAX_BYTES,MAX_CACHE_AGE_MS,REFRESH_MS,replySchema,type TaifexReply} from '../lib/options/taifex/model';
import {replySchema as futuresReplySchema,type FuturesReply} from '../lib/futures/taifex/model';
import type {D1Result,GateD1} from '../lib/ashare/source-gate';
import {at,iso,taifexPayload,taifexReply} from './taifex-options-fixture';
import {makeFuturesFixture,futuresSnapshot} from './taifex-futures-fixture';

const request=(report='options',mode='snapshot')=>new Request(`https://app.invalid/api/v1/${report}/taifex/${mode}`);
const gate=():TaifexGate=>({inspect:vi.fn(async()=>({state:'idle' as const,retryAt:0,snapshot:null})),acquire:vi.fn(async()=>({token:'synthetic-owned'})),release:vi.fn(async()=>{})});
const bundle=():TaifexBundle=>({schema:'taifex-institutions/2',source:'TAIFEX',acquisition_started_at:iso,fetched_at:iso,options:taifexReply().snapshot!,futures:futuresSnapshot()});
const dated=(payload:Record<string,string>[],date:string)=>payload.map(row=>({...row,Date:date.replaceAll('-','')}));
const readReply=async(response:Response)=>await response.json() as TaifexReply|FuturesReply;
const readStatus=async(response:Response)=>await response.json() as TaifexReply['status'];
const validResponse=(url:unknown)=>Response.json(url===TAIFEX_URL?taifexPayload():makeFuturesFixture());
function setup(){
 let time=at;const g=gate(),fetcher=vi.fn<typeof fetch>(async url=>validResponse(url));
 const provider=createTaifexProvider({gate:g,fetcher,now:()=>time,isolatedForTests:true});
 const invoke=(report='options',mode='snapshot')=>(report==='options'?provider.optionsHandler:provider.futuresHandler)(request(report,mode));
 const reply=async(report='options')=>{const pending=invoke(report);await vi.advanceTimersByTimeAsync(1100);return await(await pending).json() as TaifexReply|FuturesReply;};
 return {g,fetcher,provider,invoke,reply,advance:(ms:number)=>{time+=ms;}};
}
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}
function dbWith(run:(sql:string,values:unknown[])=>Promise<D1Result>):GateD1{return {prepare:sql=>({bind:(...values)=>({run:()=>run(sql,values)})})};}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(at);vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('External networking is disabled in TAIFEX unit tests');}));});
afterEach(()=>{vi.restoreAllMocks();vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();});

describe('shared TAIFEX provider acquisition',()=>{
 it.each(['application/json','application/octet-stream','application/octet-stream; charset=utf-8'])('collects exactly the fixed options→futures pair with %s',async contentType=>{
  const t=setup();t.fetcher.mockImplementation(async url=>new Response(JSON.stringify(url===TAIFEX_URL?taifexPayload():makeFuturesFixture()),{headers:{'content-type':contentType}}));
  const r=await t.reply(),f=await t.reply('futures');expect(replySchema.safeParse(r).success).toBe(true);expect(futuresReplySchema.safeParse(f).success).toBe(true);
  expect(t.fetcher.mock.calls.map(call=>call[0])).toEqual([TAIFEX_URL,FUTURES_URL]);
  for(const call of t.fetcher.mock.calls)expect(call[1]).toMatchObject({method:'GET',credentials:'omit',redirect:'manual',cache:'no-store',headers:{Accept:'application/json'},signal:expect.any(AbortSignal)});
  expect(t.g.acquire).toHaveBeenCalledTimes(1);const outcome=vi.mocked(t.g.release).mock.calls[0][1];expect(outcome.kind).toBe('success');expect(bundleSchema.safeParse(outcome.snapshot).success).toBe(true);expect(outcome.snapshot!.options).toEqual(r.snapshot);expect(outcome.snapshot!.futures).toEqual(f.snapshot);
 });
 it('coalesces selectors, spaces starts conservatively, and retains one hourly budget',async()=>{
  const t=setup(),starts:number[]=[];t.fetcher.mockImplementation(async url=>{starts.push(Date.now());return validResponse(url);});
  const responses=Array.from({length:12},(_,i)=>t.invoke(i%2?'futures':'options'));await vi.advanceTimersByTimeAsync(1099);expect(t.fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);expect((await Promise.all(responses)).every(r=>r.status===200)).toBe(true);expect(starts[1]-starts[0]).toBeGreaterThanOrEqual(1100);expect(t.g.acquire).toHaveBeenCalledTimes(1);
  t.advance(REFRESH_MS-1);await t.reply('futures');expect(t.fetcher).toHaveBeenCalledTimes(2);t.advance(1);await t.reply();expect(t.fetcher).toHaveBeenCalledTimes(4);expect(t.g.acquire).toHaveBeenCalledTimes(2);
 });
 it('keeps both status selectors strictly read-only before, during and after collection',async()=>{
  const t=setup();for(const report of ['options','futures'])expect((await readStatus(await t.invoke(report,'status'))).state).toBe('unavailable');expect(t.g.acquire).not.toHaveBeenCalled();
  const pending=t.invoke();await vi.advanceTimersByTimeAsync(0);for(const report of ['options','futures'])expect((await readStatus(await t.invoke(report,'status'))).error_code).toBe('source_busy');expect(t.g.acquire).toHaveBeenCalledTimes(1);expect(t.g.release).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1100);await pending;t.advance(REFRESH_MS*2);
  for(const report of ['options','futures'])expect((await readStatus(await t.invoke(report,'status'))).state).toBe('stale');expect(t.fetcher).toHaveBeenCalledTimes(2);expect(t.g.release).toHaveBeenCalledTimes(1);
 });
 it('serves exact legacy options during cooldown without inventing futures or accelerating upgrade',async()=>{
  const t=setup(),legacy=taifexReply().snapshot!;vi.mocked(t.g.inspect).mockResolvedValue({state:'idle',retryAt:at+REFRESH_MS,snapshot:legacy});
  const f=await t.reply('futures');expect(f.snapshot).toBeNull();expect(f.status.state).toBe('unavailable');expect(f.status.error_code).toBeNull();expect(f.status.fetched_at).toBeNull();
  const o=await t.reply();expect(o.snapshot).toEqual(legacy);expect(o.status.state).toBe('available');expect(o.status.fetched_at).toBe(legacy.fetched_at);expect(t.g.acquire).not.toHaveBeenCalled();expect(t.fetcher).not.toHaveBeenCalled();
  t.advance(REFRESH_MS);expect((await t.reply('futures')).snapshot).not.toBeNull();expect(t.g.acquire).toHaveBeenCalledTimes(1);expect(t.fetcher).toHaveBeenCalledTimes(2);
 });
 it.each(['busy','blocked','unknown'] as const)('suppresses both warm reports when shared state is %s',async state=>{
  const t=setup();await t.reply();t.advance(REFRESH_MS+1);
  if(state==='unknown')vi.mocked(t.g.inspect).mockRejectedValue(new Error('private DB detail'));else vi.mocked(t.g.inspect).mockResolvedValue({state,retryAt:0,snapshot:bundle()});
  for(const report of ['options','futures']){const r=await t.reply(report);expect(r.snapshot).toBeNull();expect(r.status.state).toBe(state==='blocked'?'denied':'unavailable');expect(JSON.stringify(r)).not.toContain('private');}
  expect(t.fetcher).toHaveBeenCalledTimes(2);expect(t.g.acquire).toHaveBeenCalledTimes(1);
 });
 it('does not poison persistent acquisition errors after a transient inspect failure',async()=>{
  const t=setup(),accepted=await t.reply();const persisted=vi.mocked(t.g.release).mock.calls[0][1].snapshot!;t.advance(1000);
  vi.mocked(t.g.inspect).mockRejectedValueOnce(new Error('transient D1 read failure'));expect((await t.invoke('futures')).status).toBe(503);
  vi.mocked(t.g.inspect).mockResolvedValue({state:'idle',retryAt:at+REFRESH_MS,snapshot:persisted});const recovered=await t.reply();expect(recovered.snapshot).toEqual(accepted.snapshot);expect(recovered.status.error_code).toBeNull();expect((await t.reply('futures')).status.state).toBe('available');expect(t.fetcher).toHaveBeenCalledTimes(2);
  t.advance(REFRESH_MS);t.fetcher.mockResolvedValue(new Response('{}',{status:503,headers:{'content-type':'application/json'}}));await t.reply();vi.mocked(t.g.inspect).mockRejectedValueOnce(new Error('transient again'));await t.invoke();
  expect((await t.reply()).status.error_code).toBe('upstream_http');expect((await t.reply('futures')).status.state).toBe('stale');
 });
 it.each(['source_busy','source_gate_unavailable','source_stale_lease','source_cooldown','unclassified'])('fails closed if admission races to %s',async code=>{
  const t=setup();await t.reply();t.advance(REFRESH_MS);vi.mocked(t.g.acquire).mockRejectedValue(code==='unclassified'?new Error('opaque'):{code});
  const responses=[t.invoke(),t.invoke('futures')];await vi.advanceTimersByTimeAsync(1100);for(const response of responses){const r=await readReply(await response);expect(r.snapshot).toBeNull();expect(r.status.state).toBe('unavailable');}expect(t.fetcher).toHaveBeenCalledTimes(2);expect(t.g.release).toHaveBeenCalledTimes(1);
 });
 it.each([false,true])('refuses unregistered/rejected runtime lifetime (throw=%s)',async throwing=>{
  const g=gate(),fetcher=vi.fn(),provider=createTaifexProvider({gate:g,fetcher,now:()=>at,...(throwing?{waitUntil:()=>{throw new Error('not retained');}}:{})});
  const r=await readReply(await provider.futuresHandler(request('futures')));expect(r.status.error_code).toBe('runtime_lifetime_unverified');expect(g.acquire).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();
 });
 it.each(['options','futures'])('rejects caller filters, URLs, modes and methods for %s before any gate access',async report=>{
  const t=setup(),handler=report==='options'?t.provider.optionsHandler:t.provider.futuresHandler;
  for(const r of [new Request(request(report),{method:'POST'}),new Request(request(report).url+'?report=futures'),new Request(request(report).url+'?url=https://invalid'),request(report,'other')])expect((await handler(r)).status).toBe(r.method==='POST'?405:400);expect(t.g.inspect).not.toHaveBeenCalled();expect(t.fetcher).not.toHaveBeenCalled();
 });
});

describe('atomic collection failures and shared denial',()=>{
 it.each(['options','futures'])('blocks and purges both reports when %s returns any HTTP access denial or redirect',async report=>{
  for(const status of [401,403,407,429,451,301,302,307]){
   const t=setup();await t.reply();t.advance(REFRESH_MS);t.fetcher.mockImplementation(async url=>url===(report==='options'?TAIFEX_URL:FUTURES_URL)?new Response('',{status}):validResponse(url));
   const r=await t.reply(report);expect(r.status.state).toBe('denied');expect(r.snapshot).toBeNull();expect(t.g.release).toHaveBeenLastCalledWith('synthetic-owned',expect.objectContaining({kind:'denied'}));
   const calls=t.fetcher.mock.calls.length;vi.mocked(t.g.inspect).mockResolvedValue({state:'idle',retryAt:0,snapshot:bundle()});t.advance(MAX_CACHE_AGE_MS*3);
   for(const selector of ['options','futures'])expect((await t.reply(selector)).status.state).toBe('denied');expect(t.fetcher).toHaveBeenCalledTimes(calls);
  }
 });
 it.each(['options','futures'])('blocks both reports for HTML/challenge or unsupported content from %s',async report=>{
  for(const contentType of ['text/html','application/xhtml+xml','application/json','application/octet-stream','text/plain']){
   const t=setup();t.fetcher.mockImplementation(async url=>url===(report==='options'?TAIFEX_URL:FUTURES_URL)?new Response(' \n<html>synthetic challenge</html>',{headers:{'content-type':contentType}}):validResponse(url));
   expect((await t.reply()).status.state).toBe('denied');expect((await t.reply('futures')).snapshot).toBeNull();expect(t.g.release).toHaveBeenLastCalledWith('synthetic-owned',expect.objectContaining({kind:'denied'}));
  }
 });
 it.each(['full','legacy'])('retains the exact %s payload and every clock after a partial collection failure',async kind=>{
  const t=setup(),prior=kind==='full'?bundle():taifexReply().snapshot!;vi.mocked(t.g.inspect).mockResolvedValue({state:'idle',retryAt:0,snapshot:prior});
  t.fetcher.mockImplementation(async url=>url===TAIFEX_URL?Response.json(dated(taifexPayload(),'2026-11-06')):new Response('{}',{status:503,headers:{'content-type':'application/json'}}));
  const r=await t.reply();expect(r.snapshot).toEqual(kind==='full'?(prior as TaifexBundle).options:prior);expect(r.status.state).toBe('stale');
  const f=await t.reply('futures');expect(f.snapshot).toEqual(kind==='full'?(prior as TaifexBundle).futures:null);expect(t.g.release).toHaveBeenCalledExactlyOnceWith('synthetic-owned',{kind:'temporary_failure',retryAfterMs:REFRESH_MS});
 });
 it.each(['7200','Fri, 06 Nov 2026 06:00:00 GMT'])('honors second-endpoint Retry-After %s without additional requests',async value=>{
  const t=setup(),prior=await t.reply();t.advance(REFRESH_MS);t.fetcher.mockImplementation(async url=>url===TAIFEX_URL?validResponse(url):new Response('{}',{status:503,headers:{'content-type':'application/json','retry-after':value}}));
  const r=await t.reply();expect(r.snapshot).toEqual(prior.snapshot);expect(r.status.next_retry_at).toBe('2026-11-06T06:00:00.000Z');expect(t.g.release).toHaveBeenLastCalledWith('synthetic-owned',{kind:'temporary_failure',retryAfterMs:7_200_000});t.advance(REFRESH_MS);await t.reply('futures');expect(t.fetcher).toHaveBeenCalledTimes(4);
 });
 it('never retries an unconfirmed publication or restores its cache on later inspection',async()=>{
  const t=setup();await t.reply();t.advance(REFRESH_MS);vi.mocked(t.g.release).mockRejectedValueOnce(new Error('lost acknowledgement'));
  expect((await t.reply()).status.error_code).toBe('source_gate_outcome_unconfirmed');expect(t.g.release).toHaveBeenCalledTimes(2);vi.mocked(t.g.inspect).mockResolvedValue({state:'idle',retryAt:0,snapshot:bundle()});t.advance(REFRESH_MS*2);
  for(const report of ['options','futures'])expect((await t.reply(report)).status.state).toBe('denied');expect(t.g.release).toHaveBeenCalledTimes(2);expect(t.fetcher).toHaveBeenCalledTimes(4);
 });
 it.each(['options','futures'])('bounds declared/streamed/malformed response bytes at the %s endpoint',async report=>{
  for(const kind of ['declared','streamed','malformed-length']){const t=setup();const headers={'content-type':'application/json',...(kind==='declared'?{'content-length':String(MAX_BYTES+1)}:kind==='malformed-length'?{'content-length':'-1'}:{})};
   t.fetcher.mockImplementation(async url=>url===(report==='options'?TAIFEX_URL:FUTURES_URL)?new Response(kind==='streamed'?' '.repeat(MAX_BYTES+1):'[]',{headers}):validResponse(url));const r=await t.reply();expect(r.snapshot).toBeNull();expect(r.status.error_code).toBe('byte_budget');expect(t.g.release).toHaveBeenCalledWith('synthetic-owned',expect.objectContaining({kind:'temporary_failure'}));
  }
 });
 it.each(['options','futures'])('rejects malformed JSON/UTF8/coverage at %s without a partial write',async report=>{
  for(const kind of ['duplicate-json','invalid-utf8','invalid-json','missing-row','unknown-column']){
   const t=setup(),p=report==='options'?taifexPayload():makeFuturesFixture();if(kind==='missing-row')p.pop();if(kind==='unknown-column')p[0].Unverified='sensitive opaque text';
   const body=kind==='duplicate-json'?'[{"Date":"20261105","Date":"20261104"}]':kind==='invalid-utf8'?new Uint8Array([0xff,0xfe]):kind==='invalid-json'?'sensitive opaque text':JSON.stringify(p);
   t.fetcher.mockImplementation(async url=>url===(report==='options'?TAIFEX_URL:FUTURES_URL)?new Response(body,{headers:{'content-type':'application/json'}}):validResponse(url));const r=await t.reply();expect(r.snapshot).toBeNull();expect(r.status.state).toBe('unavailable');expect(JSON.stringify(r)).not.toContain('sensitive opaque');expect(t.g.release).toHaveBeenCalledWith('synthetic-owned',expect.objectContaining({kind:'temporary_failure'}));
  }
 });
});

describe('independent report dates and freshness',()=>{
 it('accepts different report dates and checks each report regression independently',async()=>{
  const t=setup();t.fetcher.mockImplementation(async url=>Response.json(dated(url===TAIFEX_URL?taifexPayload():makeFuturesFixture(),url===TAIFEX_URL?'2026-11-05':'2026-11-04')));
  const o=await t.reply(),f=await t.reply('futures');expect(o.snapshot?.report_date).toBe('2026-11-05');expect(f.snapshot?.report_date).toBe('2026-11-04');t.advance(REFRESH_MS);
  t.fetcher.mockImplementation(async url=>Response.json(dated(url===TAIFEX_URL?taifexPayload():makeFuturesFixture(),url===TAIFEX_URL?'2026-11-06':'2026-11-03')));
  const failed=await t.reply();expect(failed.status.error_code).toBe('report_date_regressed');expect(failed.snapshot).toEqual(o.snapshot);expect((await t.reply('futures')).snapshot).toEqual(f.snapshot);
 });
 it.each(['options','futures'])('rejects individual regression, future dates and excessively old reports from %s',async report=>{
  for(const date of ['2026-11-04','2026-11-07','2026-10-22']){const t=setup(),prior=await t.reply();t.advance(REFRESH_MS);t.fetcher.mockImplementation(async url=>Response.json(dated(url===TAIFEX_URL?taifexPayload():makeFuturesFixture(),url===(report==='options'?TAIFEX_URL:FUTURES_URL)?date:'2026-11-06')));const r=await t.reply();expect(r.snapshot).toEqual(prior.snapshot);expect(r.status.state).toBe('stale');expect(t.g.release).toHaveBeenLastCalledWith('synthetic-owned',expect.objectContaining({kind:'temporary_failure'}));}
 });
 it.each(['options','futures'])('uses %s report calendar age without suppressing the other report',async report=>{
  for(const kind of ['stale-report','expired-report']){
   const t=setup(),stored=bundle(),target=stored[report as 'options'|'futures'];target.report_date=kind==='stale-report'?'2026-11-01':'2026-10-22';
   vi.mocked(t.g.inspect).mockResolvedValue({state:'idle',retryAt:at+REFRESH_MS,snapshot:stored});const selected=await t.reply(report),other=await t.reply(report==='options'?'futures':'options');expect(selected.status.state).toBe(kind==='stale-report'?'stale':'unavailable');expect(other.status.state).toBe('available');expect(selected.status.fetched_at).toBe(target.fetched_at);expect(t.fetcher).not.toHaveBeenCalled();
  }
 });
 it.each([REFRESH_MS,MAX_CACHE_AGE_MS])('uses each report fetched clock at the %i cache boundary',async boundary=>{
  const t=setup(),stored=bundle(),started=at-boundary-1;stored.acquisition_started_at=new Date(started).toISOString();stored.options.acquisition_started_at=stored.acquisition_started_at;stored.options.fetched_at=stored.acquisition_started_at;stored.options.report_date='2026-11-04';
  stored.fetched_at=new Date(started+1100).toISOString();stored.futures.acquisition_started_at=stored.fetched_at;stored.futures.fetched_at=stored.fetched_at;stored.futures.report_date='2026-11-04';expect(bundleSchema.safeParse(stored).success).toBe(true);
  vi.mocked(t.g.inspect).mockResolvedValue({state:'idle',retryAt:at+REFRESH_MS,snapshot:stored});const o=await t.reply(),f=await t.reply('futures');expect(o.status.state).toBe(boundary===REFRESH_MS?'stale':'unavailable');expect(f.status.state).toBe(boundary===REFRESH_MS?'available':'stale');expect(o.status.fetched_at).toBe(stored.options.fetched_at);expect(f.status.fetched_at).toBe(stored.futures.fetched_at);expect(t.fetcher).not.toHaveBeenCalled();
 });
 it.each([[4,'2026-11-02','available'],[5,'2026-11-01','stale'],[14,'2026-10-23','stale'],[15,'2026-10-22','unavailable']] as const)('applies the %i-day age boundary independently',async(_age,date,state)=>{
  const t=setup();t.fetcher.mockImplementation(async url=>Response.json(url===TAIFEX_URL?taifexPayload():dated(makeFuturesFixture(),date)));expect((await t.reply('futures')).status.state).toBe(state);
 });
});

describe('lifetime, cancellation and validation before release',()=>{
 it('cancels between fixed GETs and retains exactly the owned cleanup',async()=>{
  const g=gate(),controller=new AbortController(),release=deferred<void>();let retained:Promise<unknown>|undefined;
  vi.mocked(g.release).mockReturnValue(release.promise);const fetcher=vi.fn<typeof fetch>(async url=>validResponse(url)),p=createTaifexProvider({gate:g,fetcher,now:()=>at,waitUntil:promise=>{retained=promise;}});
  const pending=p.optionsHandler(new Request(request(),{signal:controller.signal}));await vi.advanceTimersByTimeAsync(0);expect(fetcher).toHaveBeenCalledTimes(1);controller.abort();await vi.advanceTimersByTimeAsync(0);expect(g.release).toHaveBeenCalledWith('synthetic-owned',expect.objectContaining({kind:'temporary_failure'}));
  let done=false;void retained!.then(()=>{done=true;});await Promise.resolve();expect(done).toBe(false);release.resolve();await pending;await retained;expect(done).toBe(true);await vi.advanceTimersByTimeAsync(1100);expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('retains cancellation during source fetch until owned cleanup settles',async()=>{
  const g=gate(),controller=new AbortController(),release=deferred<void>();let retained:Promise<unknown>|undefined;vi.mocked(g.release).mockReturnValue(release.promise);
  const fetcher=vi.fn<typeof fetch>(async(_url,init)=>new Promise((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true}))),p=createTaifexProvider({gate:g,fetcher,now:()=>at,waitUntil:promise=>{retained=promise;}});
  const pending=p.optionsHandler(new Request(request(),{signal:controller.signal}));await vi.advanceTimersByTimeAsync(0);controller.abort();await vi.advanceTimersByTimeAsync(0);expect(g.release).toHaveBeenCalledWith('synthetic-owned',expect.objectContaining({kind:'temporary_failure'}));let done=false;void retained!.then(()=>{done=true;});await Promise.resolve();expect(done).toBe(false);release.resolve();await pending;await retained;expect(done).toBe(true);expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('completes two synthetic 7.9-second GETs within the shared 25-second collection window',async()=>{
  const g=gate(),starts:number[]=[],fetcher=vi.fn<typeof fetch>(async url=>{starts.push(Date.now());return new Promise(resolve=>setTimeout(()=>resolve(validResponse(url)),7900));}),p=createTaifexProvider({gate:g,fetcher,isolatedForTests:true});
  const responses=[p.optionsHandler(request()),p.futuresHandler(request('futures'))];await vi.advanceTimersByTimeAsync(15000);expect(fetcher).toHaveBeenCalledTimes(2);expect(g.release).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(1900);
  const [o,f]=await Promise.all(responses);expect(o.status).toBe(200);expect(f.status).toBe(200);expect(starts).toEqual([at,at+9000]);expect(g.acquire).toHaveBeenCalledTimes(1);expect(g.release).toHaveBeenCalledTimes(1);const stored=vi.mocked(g.release).mock.calls[0][1].snapshot!;
  expect(bundleSchema.safeParse(stored).success).toBe(true);expect(Date.parse(stored.fetched_at)-Date.parse(stored.acquisition_started_at)).toBe(16900);expect(stored.options.fetched_at).toBe(new Date(at+7900).toISOString());expect(stored.futures.acquisition_started_at).toBe(new Date(at+9000).toISOString());expect(stored.futures.fetched_at).toBe(new Date(at+16900).toISOString());
 });
 it('includes pacing in the single 25-second deadline and never starts a late second GET',async()=>{
  const g=gate(),fetcher=vi.fn<typeof fetch>(async url=>new Promise(resolve=>setTimeout(()=>resolve(validResponse(url)),MAX_ACQUISITION_MS-1000))),p=createTaifexProvider({gate:g,fetcher,isolatedForTests:true});
  const pending=p.optionsHandler(request());await vi.advanceTimersByTimeAsync(MAX_ACQUISITION_MS-1);expect(fetcher).toHaveBeenCalledTimes(1);expect(g.release).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(1);const r=await readReply(await pending);expect(r.status.error_code).toBe('timeout');expect(g.release).toHaveBeenCalledExactlyOnceWith('synthetic-owned',{kind:'temporary_failure',retryAfterMs:REFRESH_MS});expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('does not grant the second endpoint a new 25-second deadline',async()=>{
  const g=gate(),fetcher=vi.fn<typeof fetch>(async(url,init)=>url===TAIFEX_URL?validResponse(url):new Promise((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true}))),p=createTaifexProvider({gate:g,fetcher,isolatedForTests:true});
  const pending=p.futuresHandler(request('futures'));await vi.advanceTimersByTimeAsync(1100);expect(fetcher).toHaveBeenCalledTimes(2);await vi.advanceTimersByTimeAsync(MAX_ACQUISITION_MS-1100);expect((await readReply(await pending)).status.error_code).toBe('timeout');expect(g.release).toHaveBeenCalledExactlyOnceWith('synthetic-owned',{kind:'temporary_failure',retryAfterMs:REFRESH_MS});
 });
 it('shares one 25-second deadline across both endpoints and retains a late release',async()=>{
  const g=gate(),release=deferred<void>();let retained:Promise<unknown>|undefined;const fetcher=vi.fn<typeof fetch>(async url=>validResponse(url));vi.mocked(g.release).mockReturnValue(release.promise);
  const p=createTaifexProvider({gate:g,fetcher,now:()=>at,waitUntil:promise=>{retained=promise;}}),pending=p.optionsHandler(request());await vi.advanceTimersByTimeAsync(1100);expect(g.release).toHaveBeenCalledTimes(1);await vi.advanceTimersByTimeAsync(MAX_ACQUISITION_MS-1100);
  const r=await readReply(await pending);expect(r.status.error_code).toBe('source_gate_outcome_unconfirmed');let done=false;void retained!.then(()=>{done=true;});await Promise.resolve();expect(done).toBe(false);release.resolve();await retained;expect(done).toBe(true);expect(g.release).toHaveBeenCalledTimes(1);expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('retains late admission and its abort cleanup without starting any GET',async()=>{
  const admitted=deferred<D1Result>(),finished=deferred<D1Result>(),run=vi.fn<(sql:string,values:unknown[])=>Promise<D1Result>>(async sql=>sql===TAIFEX_SQL.inspect?{success:true,results:[{status:'idle',not_before_ms:0,payload:null}]}:sql===TAIFEX_SQL.acquire?admitted.promise:finished.promise);
  let retained:Promise<unknown>|undefined;const fetcher=vi.fn(),p=createTaifexProvider({gate:new D1TaifexGate(dbWith(run)),fetcher,now:()=>at,waitUntil:promise=>{retained=promise;}});
  const pending=p.futuresHandler(request('futures'));await vi.advanceTimersByTimeAsync(MAX_ACQUISITION_MS);expect((await readReply(await pending)).status.error_code).toBe('source_gate_outcome_unconfirmed');let done=false;void retained!.then(()=>{done=true;});admitted.resolve({success:true,meta:{changes:1}});await vi.advanceTimersByTimeAsync(0);expect(done).toBe(false);expect(run.mock.calls.filter(([sql])=>sql===TAIFEX_SQL.finish)).toHaveLength(1);finished.resolve({success:true,meta:{changes:1}});await retained;expect(done).toBe(true);expect(fetcher).not.toHaveBeenCalled();
 });
 it('releases local complete-bundle validation failure as temporary, before any success write',async()=>{
  const t=setup(),invalid=bundleSchema.safeParse({}),spy=vi.spyOn(bundleSchema,'safeParse').mockReturnValueOnce(invalid);const r=await t.reply();expect(r.status.error_code).toBe('invalid_cache_bundle');expect(t.g.release).toHaveBeenCalledExactlyOnceWith('synthetic-owned',{kind:'temporary_failure',retryAfterMs:REFRESH_MS});spy.mockRestore();t.advance(REFRESH_MS);expect((await t.reply()).status.state).toBe('available');
 });
 it('validates and UTF8-bounds the whole bundle before starting success release',async()=>{
  const t=setup(),encoder=TextEncoder.prototype.encode,spy=vi.spyOn(TextEncoder.prototype,'encode').mockImplementation(function(this:TextEncoder,value?:string){const bytes=encoder.call(this,value);return value?.startsWith('{"schema":"taifex-institutions/2"')?new Uint8Array(MAX_BYTES+1):bytes;});
  const r=await t.reply();expect(r.status.error_code).toBe('cache_byte_budget');expect(r.status.state).toBe('unavailable');expect(t.g.release).toHaveBeenCalledExactlyOnceWith('synthetic-owned',{kind:'temporary_failure',retryAfterMs:REFRESH_MS});spy.mockRestore();t.advance(REFRESH_MS);expect((await t.reply()).status.state).toBe('available');
 });
});

describe('strict shared cache and original D1 boundary',()=>{
 it('reads only exact v1 or complete strict v2, and accepts new success writes only as v2',async()=>{
  const b=bundle(),legacy=taifexReply().snapshot!;expect(cacheSchema.safeParse(legacy).success).toBe(true);expect(cacheSchema.safeParse(b).success).toBe(true);
  for(const value of [{...b,futures:undefined},{...b,options:undefined},{...b,unknown:true},{...legacy,futures:b.futures}])expect(cacheSchema.safeParse(value).success).toBe(false);
  const run=vi.fn(async()=>({success:true,meta:{changes:1}})),g=new D1TaifexGate(dbWith(run));await expect(g.release('owned',{kind:'success',snapshot:legacy as unknown as TaifexBundle})).rejects.toMatchObject({code:'source_gate_unavailable'});expect(run).not.toHaveBeenCalled();await g.release('owned',{kind:'success',snapshot:b});expect(run).toHaveBeenCalledExactlyOnceWith(TAIFEX_SQL.finish,['idle',REFRESH_MS,0,serializeBundle(b),'owned']);
 });
 it('bounds a new bundle to one collection window without changing legacy acceptance',()=>{
  const b=bundle();b.fetched_at=new Date(at+MAX_ACQUISITION_MS).toISOString();expect(bundleSchema.safeParse(b).success).toBe(true);b.fetched_at=new Date(at+MAX_ACQUISITION_MS+1).toISOString();expect(bundleSchema.safeParse(b).success).toBe(false);
  const legacy=taifexReply().snapshot!;legacy.fetched_at=new Date(at+MAX_ACQUISITION_MS+1).toISOString();expect(cacheSchema.safeParse(legacy).success).toBe(true);expect(MAX_CACHE_BYTES).toBe(256000);expect(MAX_ACQUISITION_MS).toBe(25000);
 });
 it('uses UTF8 byte size rather than JS character count for persisted cache',async()=>{
  expect(utf8Bytes('期貨')).toBe(6);const raw='期'.repeat(Math.floor(MAX_BYTES/3)+1);expect(raw.length).toBeLessThan(MAX_BYTES);expect(utf8Bytes(raw)).toBeGreaterThan(MAX_BYTES);
  const run=vi.fn(async()=>({success:true,results:[{status:'idle',not_before_ms:0,payload:raw}]}));await expect(new D1TaifexGate(dbWith(run)).inspect()).rejects.toMatchObject({code:'source_gate_unavailable'});expect(run).toHaveBeenCalledTimes(1);
  const b=bundle();b.fetched_at='2026-11-06T03:00:00.'+'0'.repeat(MAX_BYTES)+'Z';expect(bundleSchema.safeParse(b).success).toBe(true);expect(()=>serializeBundle(b)).toThrow('cache_byte_budget');
 });
 it('bounds collector-generated full coverage even at conservative maximum numeric widths',()=>{
  // All allowed product/participant IDs are included. Every actual numeric
  // value is at most 17 serialized characters, and collector ISO clocks use
  // at most 27. This intentionally overestimates valid aggregate totals.
  const widen=(value:unknown,key=''):unknown=>typeof value==='number'?-Number.MAX_SAFE_INTEGER:Array.isArray(value)?value.map(item=>widen(item)):value!==null&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([name,item])=>[name,widen(item,name)])):typeof value==='string'&&(key==='fetched_at'||key==='acquisition_started_at')?value.padEnd(27,'0'):value;
  const bytes=utf8Bytes(JSON.stringify(widen(bundle())));expect(bytes).toBeLessThan(60_000);expect(bytes).toBeLessThan(MAX_CACHE_BYTES);expect(utf8Bytes(serializeBundle(bundle()))).toBeLessThan(bytes);
 });
 it.each(['busy','blocked'] as const)('never decodes stopped %s provider cache and inspect is read-only',async state=>{
  const run=vi.fn(async()=>({success:true,results:[{status:state,not_before_ms:123,payload:'invalid stale payload'}]}));expect(await new D1TaifexGate(dbWith(run)).inspect()).toEqual({state,retryAt:123,snapshot:null});expect(run).toHaveBeenCalledExactlyOnceWith(TAIFEX_SQL.inspect,[]);
 });
 it.each([null,{status:'unknown',not_before_ms:0,payload:null},{status:'idle',not_before_ms:-1,payload:null},{status:'idle',not_before_ms:0.1,payload:null},{status:'idle',not_before_ms:0,payload:'{}'},{status:'idle',not_before_ms:0,payload:'x'.repeat(MAX_BYTES+1)}])('fails closed on malformed shared state %#',async row=>{
  const run=vi.fn(async()=>({success:true,results:row?[row]:[]}));await expect(new D1TaifexGate(dbWith(run)).inspect()).rejects.toMatchObject({code:'source_gate_unavailable'});expect(run).toHaveBeenCalledTimes(1);
 });
 it.each(['legacy','bundle'])('reads exact original %s clocks without rewriting',async kind=>{
  const snapshot=kind==='legacy'?taifexReply().snapshot!:bundle(),run=vi.fn(async()=>({success:true,results:[{status:'idle',not_before_ms:at+REFRESH_MS,payload:JSON.stringify(snapshot)}]}));expect(await new D1TaifexGate(dbWith(run)).inspect()).toEqual({state:'idle',retryAt:at+REFRESH_MS,snapshot});expect(run).toHaveBeenCalledExactlyOnceWith(TAIFEX_SQL.inspect,[]);
 });
 it.each([['blocked','source_denied'],['busy','source_busy'],['idle','source_cooldown']] as const)('never takes over %s admission',async(status,code)=>{
  const run=vi.fn(async(sql:string)=>sql===TAIFEX_SQL.acquire?{success:true,meta:{changes:0}}:{success:true,results:[{status,now_ms:at,not_before_ms:at+REFRESH_MS}]});await expect(new D1TaifexGate(dbWith(run)).acquire()).rejects.toMatchObject({code});expect(run).toHaveBeenCalledTimes(2);expect(run.mock.calls.every(([sql])=>sql!==TAIFEX_SQL.finish)).toBe(true);
 });
 it('atomically blocks, clears the complete cache and releases only its original owned lease',async()=>{
  const run=vi.fn(async()=>({success:true,meta:{changes:1}}));await new D1TaifexGate(dbWith(run)).release('owned',{kind:'denied',retryAfterMs:7_200_000});expect(run).toHaveBeenCalledExactlyOnceWith(TAIFEX_SQL.finish,['blocked',7_200_000,1,null,'owned']);expect(TAIFEX_SQL.finish).toContain("status='busy' AND lease_token=?");expect(TAIFEX_SQL.finish).toContain("id='daily_institutions'");expect(Object.values(TAIFEX_SQL).join(' ')).not.toContain('deribit');
 });
 it.each([0,1,REFRESH_MS,REFRESH_MS+1])('enforces minimum hour cooldown for delay %i',async delay=>{
  const run=vi.fn(async()=>({success:true,meta:{changes:1}}));await new D1TaifexGate(dbWith(run)).release('owned',{kind:'temporary_failure',retryAfterMs:delay});expect(run).toHaveBeenCalledWith(TAIFEX_SQL.finish,['idle',Math.max(REFRESH_MS,delay),0,null,'owned']);
 });
 it('does not write partial bundles or retry stale/uncertain release outcomes',async()=>{
  const run=vi.fn(async()=>({success:true,meta:{changes:0}})),g=new D1TaifexGate(dbWith(run)),b=bundle();b.futures.rows.pop();await expect(g.release('owned',{kind:'success',snapshot:b})).rejects.toMatchObject({code:'source_gate_unavailable'});expect(run).not.toHaveBeenCalled();await expect(g.release('wrong-owner',{kind:'denied'})).rejects.toMatchObject({code:'source_stale_lease'});expect(run).toHaveBeenCalledTimes(1);
 });
 it('cleans late acknowledged aborted admission exactly once, with no new source budget',async()=>{
  const admitted=deferred<D1Result>(),controller=new AbortController(),run=vi.fn<(sql:string,values:unknown[])=>Promise<D1Result>>(async sql=>sql===TAIFEX_SQL.acquire?admitted.promise:{success:true,meta:{changes:1}}),g=new D1TaifexGate(dbWith(run));const acquisition=g.acquire(controller.signal);controller.abort();admitted.resolve({success:true,meta:{changes:1}});await expect(acquisition).rejects.toMatchObject({code:'source_aborted'});const token=run.mock.calls[0][1][0];expect(run.mock.calls[1]).toEqual([TAIFEX_SQL.finish,['idle',REFRESH_MS,0,null,token]]);expect(run).toHaveBeenCalledTimes(2);
 });
 it('does not touch D1 for an already aborted acquisition',async()=>{
  const run=vi.fn(async()=>({success:true,meta:{changes:1}})),controller=new AbortController();controller.abort();await expect(new D1TaifexGate(dbWith(run)).acquire(controller.signal)).rejects.toMatchObject({code:'source_aborted'});expect(run).not.toHaveBeenCalled();
 });
});
