import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {TAIFEX_URL,parseTaifex} from '../lib/options/taifex/adapter';
import {createTaifexHandler,type TaifexGate} from '../lib/options/taifex/handler';
import {D1TaifexGate,TAIFEX_SQL} from '../lib/options/taifex/source-gate';
import {MAX_BYTES,MAX_CACHE_AGE_MS,MAX_REPORT_AGE_DAYS,REFRESH_MS,STALE_REPORT_DAYS,reportAge,replySchema,visibleSnapshot,type TaifexReply} from '../lib/options/taifex/model';
import type {D1Result,GateD1} from '../lib/ashare/source-gate';
import {at,iso,taifexPayload,taifexReply} from './taifex-options-fixture';

const request=(mode='snapshot')=>new Request('https://app.invalid/api/v1/options/taifex/'+mode);
const gate=():TaifexGate=>({
 inspect:vi.fn(async()=>({state:'idle' as const,retryAt:0,snapshot:null})),
 acquire:vi.fn(async()=>({token:'synthetic-owned'})),release:vi.fn(async()=>{}),
});
function setup(){
 let time=at;const g=gate(),fetcher=vi.fn<typeof fetch>(async()=>Response.json(taifexPayload()));
 const handler=createTaifexHandler({gate:g,fetcher,now:()=>time,isolatedForTests:true});
 return {g,fetcher,handler,advance:(ms:number)=>{time+=ms;},reply:async()=>await(await handler(request())).json() as TaifexReply};
}
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}
function dbWith(run:(sql:string,values:unknown[])=>Promise<D1Result>):GateD1{return {prepare:sql=>({bind:(...values)=>({run:()=>run(sql,values)})})};}
function datedPayload(date:string){return taifexPayload().map(row=>({...row,Date:date.replaceAll('-','')}));}
beforeEach(()=>{vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('External networking is disabled in TAIFEX unit tests');}));});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});

describe('TAIFEX official daily source contract',()=>{
 it('uses exactly one fixed official URL and retains all 30 synthetic source rows',()=>{
  expect(TAIFEX_URL).toBe('https://openapi.taifex.com.tw/v1/MarketDataOfMajorInstitutionalTradersDetailsOfCallsAndPutsBytheDate');
  const s=parseTaifex(taifexPayload(),iso,iso);
  expect(s.rows).toHaveLength(30);expect(new Set(s.rows.map(row=>row.id)).size).toBe(30);
  expect(s.report_date).toBe('2026-11-05');expect(s.source_released_at).toBeNull();expect(s.frequency).toBe('daily');
  expect(s.source_unit).toBe('thousand_TWD');expect(s.currency).toBe('TWD');expect(s.net_capital_flow).toBeNull();
  expect(s.rows[0]).toMatchObject({buy_contracts:10,buy_amount:12000,sell_amount:9000,reported_net_amount:4000,long_oi_amount:15000,short_oi_amount:6000,reported_net_oi_amount:9000});
  expect(s.rows[0].reported_net_amount).not.toBe(s.rows[0].buy_amount-s.rows[0].sell_amount);
 });
 it.each(['missing','duplicate','extra','mixed-date','unknown-product','invalid-date','future-date'])('rejects %s rather than publishing partial or invented evidence',kind=>{
  const p=taifexPayload();
  if(kind==='missing')p.pop();if(kind==='duplicate')p[1]={...p[0]};if(kind==='extra')p.push({...p[0]});
  if(kind==='mixed-date')p[1].Date='20261104';if(kind==='unknown-product')p[0].ContractCode='unverified';
  if(kind==='invalid-date')p.forEach(row=>row.Date='20260230');if(kind==='future-date')p.forEach(row=>row.Date='20261107');
  expect(()=>parseTaifex(p,iso,iso)).toThrow();
 });
 it.each(['','1.5','-1','01','1e3',' 2','9007199254741'])('rejects ambiguous or unsafe source amount %j',value=>{
  const p=taifexPayload();p[0]['TradingValue(Long)(Thousands)']=value;expect(()=>parseTaifex(p,iso,iso)).toThrow();
 });
 it('preserves true zero rows and negative reported net values',()=>{
  const s=parseTaifex(taifexPayload(),iso,iso);expect(s.rows.filter(row=>row.product==='teo').every(row=>row.buy_amount===0&&row.reported_net_amount===0)).toBe(true);
  expect(s.rows.some(row=>row.reported_net_amount<0)).toBe(true);
 });
});

describe('TAIFEX shared acquisition lifecycle',()=>{
 it.each(['application/json','application/octet-stream','application/octet-stream; charset=utf-8'])('accepts bounded %s JSON with no login, redirects or caller-defined URL',async contentType=>{
  const t=setup();t.fetcher.mockResolvedValue(new Response(JSON.stringify(taifexPayload()),{headers:{'content-type':contentType}}));
  const r=await t.reply();expect(replySchema.safeParse(r).success).toBe(true);expect(r.snapshot?.rows).toHaveLength(30);
  expect(t.fetcher).toHaveBeenCalledExactlyOnceWith(TAIFEX_URL,expect.objectContaining({method:'GET',credentials:'omit',redirect:'manual',cache:'no-store',headers:{Accept:'application/json'},signal:expect.any(AbortSignal)}));
  expect(t.g.acquire).toHaveBeenCalledTimes(1);expect(t.g.release).toHaveBeenCalledWith('synthetic-owned',{kind:'success',snapshot:r.snapshot});
 });
 it('status is strictly read-only before, during and after collection',async()=>{
  const t=setup();const before=await(await t.handler(request('status'))).json() as TaifexReply['status'];expect(before.state).toBe('unavailable');expect(t.g.acquire).not.toHaveBeenCalled();expect(t.g.release).not.toHaveBeenCalled();expect(t.fetcher).not.toHaveBeenCalled();
  const source=deferred<Response>();t.fetcher.mockReturnValue(source.promise);const collecting=t.handler(request());await vi.waitFor(()=>expect(t.fetcher).toHaveBeenCalledTimes(1));
  await t.handler(request('status'));expect(t.g.acquire).toHaveBeenCalledTimes(1);expect(t.g.release).not.toHaveBeenCalled();
  source.resolve(Response.json(taifexPayload()));await collecting;const calls=t.fetcher.mock.calls.length;const commits=vi.mocked(t.g.release).mock.calls.length;
  t.advance(REFRESH_MS*2);const status=await(await t.handler(request('status'))).json() as TaifexReply['status'];expect(status.state).toBe('stale');expect(t.fetcher).toHaveBeenCalledTimes(calls);expect(t.g.release).toHaveBeenCalledTimes(commits);
 });
 it('coalesces concurrent snapshot requests and does not reacquire before the hour boundary',async()=>{
  const t=setup();const responses=await Promise.all(Array.from({length:12},()=>t.handler(request())));
  expect(responses.every(r=>r.status===200)).toBe(true);expect(t.fetcher).toHaveBeenCalledTimes(1);expect(t.g.acquire).toHaveBeenCalledTimes(1);
  const initial=await responses[0].json() as TaifexReply;t.advance(REFRESH_MS-1);expect((await t.reply()).snapshot).toEqual(initial.snapshot);expect(t.fetcher).toHaveBeenCalledTimes(1);
  t.advance(1);await t.reply();expect(t.fetcher).toHaveBeenCalledTimes(2);expect(t.g.acquire).toHaveBeenCalledTimes(2);
 });
 it('reads the exact cold-worker snapshot through the shared hour cooldown',async()=>{
  const t=setup();const shared=taifexReply().snapshot;vi.mocked(t.g.inspect).mockResolvedValue({state:'idle',retryAt:at+REFRESH_MS,snapshot:shared});
  expect((await t.reply()).snapshot).toEqual(shared);expect(t.fetcher).not.toHaveBeenCalled();expect(t.g.acquire).not.toHaveBeenCalled();
 });
 it.each(['busy','blocked','unknown'] as const)('suppresses a previously valid warm cache when shared gate is %s',async state=>{
  const t=setup();await t.reply();t.advance(REFRESH_MS+1);
  if(state==='unknown')vi.mocked(t.g.inspect).mockRejectedValue(new Error('private database detail'));
  else vi.mocked(t.g.inspect).mockResolvedValue({state,retryAt:0,snapshot:taifexReply().snapshot});
  const r=await t.reply();expect(r.snapshot).toBeNull();expect(r.status.state).toBe(state==='blocked'?'denied':'unavailable');expect(t.fetcher).toHaveBeenCalledTimes(1);expect(t.g.acquire).toHaveBeenCalledTimes(1);expect(JSON.stringify(r)).not.toContain('private database');
 });
 it('recovers after a transient inspect failure without reacquiring or replacing the exact shared snapshot',async()=>{
  const t=setup();const accepted=await t.reply();t.advance(1000);vi.mocked(t.g.inspect).mockRejectedValueOnce(new Error('transient D1 read failure'));
  const failed=await t.handler(request());expect(failed.status).toBe(503);expect((await failed.json() as TaifexReply).snapshot).toBeNull();
  t.advance(1000);vi.mocked(t.g.inspect).mockResolvedValue({state:'idle',retryAt:at+REFRESH_MS,snapshot:accepted.snapshot});
  const recovered=await t.handler(request());expect(recovered.status).toBe(200);const body=await recovered.json() as TaifexReply;expect(body.snapshot).toEqual(accepted.snapshot);expect(body.status.error_code).toBeNull();expect(t.fetcher).toHaveBeenCalledTimes(1);expect(t.g.acquire).toHaveBeenCalledTimes(1);
 });
 it.each(['release-uncertain','denied'] as const)('never clears %s after a later successful idle-cache inspection',async mode=>{
  const t=setup();const accepted=await t.reply();t.advance(REFRESH_MS);
  if(mode==='release-uncertain')vi.mocked(t.g.release).mockRejectedValueOnce(new Error('lost acknowledgement'));
  else t.fetcher.mockResolvedValue(new Response('',{status:403}));
  const stopped=await t.reply();expect(stopped.snapshot).toBeNull();expect(stopped.status.state).toBe('denied');expect(stopped.status.error_code).toBe(mode==='release-uncertain'?'source_gate_outcome_unconfirmed':'source_access_denied');
  vi.mocked(t.g.inspect).mockResolvedValue({state:'idle',retryAt:0,snapshot:accepted.snapshot});t.advance(REFRESH_MS*2);
  const inspected=await t.reply();expect(inspected.snapshot).toBeNull();expect(inspected.status.state).toBe('denied');expect(inspected.status.error_code).toBe(stopped.status.error_code);expect(t.fetcher).toHaveBeenCalledTimes(2);expect(t.g.acquire).toHaveBeenCalledTimes(2);
 });
 it.each(['source_busy','source_gate_unavailable','source_stale_lease','source_cooldown','unclassified'])('suppresses stale evidence when admission races to %s',async code=>{
  const t=setup();await t.reply();t.advance(REFRESH_MS);vi.mocked(t.g.acquire).mockRejectedValue(code==='unclassified'?new Error('opaque'): {code});
  const r=await t.reply();expect(r.snapshot).toBeNull();expect(r.status.state).toBe('unavailable');expect(t.fetcher).toHaveBeenCalledTimes(1);expect(t.g.release).toHaveBeenCalledTimes(1);
 });
 it.each([false,true])('refuses unregistered or synchronously rejected worker lifetime (throw=%s)',async throwing=>{
  const g=gate(),fetcher=vi.fn();const handler=createTaifexHandler({gate:g,fetcher,now:()=>at,...(throwing?{waitUntil:()=>{throw new Error('not retained');}}:{})});
  const body=await(await handler(request())).json() as TaifexReply;expect(body.status.error_code).toBe('runtime_lifetime_unverified');expect(body.snapshot).toBeNull();expect(g.acquire).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();
 });
 it.each([401,403,407,429,451,301,302,307])('persists HTTP %s denial, purges prior cache, and never falls back',async status=>{
  const t=setup();await t.reply();t.advance(REFRESH_MS);t.fetcher.mockResolvedValue(new Response('',{status}));
  const r=await t.reply();expect(r.status.state).toBe('denied');expect(r.snapshot).toBeNull();expect(t.g.release).toHaveBeenLastCalledWith('synthetic-owned',expect.objectContaining({kind:'denied'}));
  t.advance(MAX_CACHE_AGE_MS*3);await t.reply();expect(t.fetcher).toHaveBeenCalledTimes(2);
 });
 it.each(['text/html','application/xhtml+xml','application/json','application/octet-stream'])('treats HTML under %s as persistent denial',async contentType=>{
  const t=setup();t.fetcher.mockResolvedValue(new Response(' \n<html>synthetic challenge</html>',{headers:{'content-type':contentType}}));
  expect((await t.reply()).status.state).toBe('denied');expect(t.g.release).toHaveBeenCalledWith('synthetic-owned',expect.objectContaining({kind:'denied'}));t.advance(REFRESH_MS*3);await t.reply();expect(t.fetcher).toHaveBeenCalledTimes(1);
 });
 it.each(['7200','Fri, 06 Nov 2026 06:00:00 GMT'])('honors Retry-After %s beyond the one-hour minimum while retaining unchanged stale evidence',async value=>{
  const t=setup();const prior=await t.reply();t.advance(REFRESH_MS);t.fetcher.mockResolvedValue(new Response('{}',{status:503,headers:{'content-type':'application/json','retry-after':value}}));
  const r=await t.reply();expect(r.snapshot).toEqual(prior.snapshot);expect(r.status.state).toBe('stale');expect(r.status.next_retry_at).toBe('2026-11-06T06:00:00.000Z');expect(t.g.release).toHaveBeenLastCalledWith('synthetic-owned',{kind:'temporary_failure',retryAfterMs:7_200_000});
  t.advance(REFRESH_MS);await t.reply();expect(t.fetcher).toHaveBeenCalledTimes(2);
 });
 it('rejects a regressed report date without replacing the accepted daily report',async()=>{
  const t=setup();const prior=await t.reply();t.advance(REFRESH_MS);t.fetcher.mockResolvedValue(Response.json(datedPayload('2026-11-04')));
  const r=await t.reply();expect(r.snapshot).toEqual(prior.snapshot);expect(r.status.error_code).toBe('report_date_regressed');expect(r.status.state).toBe('stale');expect(t.g.release).toHaveBeenLastCalledWith('synthetic-owned',expect.objectContaining({kind:'temporary_failure'}));
 });
 it.each(['declared','streamed','malformed-length'])('bounds %s bytes before any shared publication',async kind=>{
  const t=setup();const oversized=' '.repeat(MAX_BYTES+1);
  const headers={'content-type':'application/json',...(kind==='declared'?{'content-length':String(MAX_BYTES+1)}:kind==='malformed-length'?{'content-length':'-1'}:{})};
  t.fetcher.mockResolvedValue(new Response(kind==='streamed'?oversized:'[]',{headers}));
  const r=await t.reply();expect(r.snapshot).toBeNull();expect(r.status.error_code).toBe('byte_budget');expect(t.g.release).toHaveBeenCalledWith('synthetic-owned',expect.objectContaining({kind:'temporary_failure'}));
 });
 it.each(['duplicate-json','invalid-utf8','invalid-json','missing-row','unknown-column'])('refuses %s with no partial cache or leaked response body',async kind=>{
  const t=setup();const p=taifexPayload();if(kind==='missing-row')p.pop();if(kind==='unknown-column')p[0].Unverified='sensitive opaque text';
  const body=kind==='duplicate-json'?'[{"Date":"20261105","Date":"20261104"}]':kind==='invalid-utf8'?new Uint8Array([0xff,0xfe]):kind==='invalid-json'?'sensitive opaque text':JSON.stringify(p);
  t.fetcher.mockResolvedValue(new Response(body,{headers:{'content-type':'application/json'}}));const r=await t.reply();expect(r.snapshot).toBeNull();expect(r.status.state).toBe('unavailable');expect(JSON.stringify(r)).not.toContain('sensitive opaque');expect(t.g.release).toHaveBeenCalledWith('synthetic-owned',expect.objectContaining({kind:'temporary_failure'}));
 });
 it('rejects methods, parameters and unknown modes before inspecting or fetching',async()=>{
  const t=setup();for(const r of [new Request(request(),{method:'POST'}),new Request(request().url+'?url=https://untrusted.invalid'),request('other')])expect((await t.handler(r)).status).toBe(r.method==='POST'?405:400);
  expect(t.g.inspect).not.toHaveBeenCalled();expect(t.fetcher).not.toHaveBeenCalled();
 });
 it('retains cancellation cleanup until its exact owned D1 release settles',async()=>{
  const g=gate(),controller=new AbortController(),release=deferred<void>();let retained:Promise<unknown>|undefined;
  vi.mocked(g.release).mockReturnValue(release.promise);const fetcher=vi.fn<typeof fetch>(async(_url,init)=>new Promise((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true})));
  const h=createTaifexHandler({gate:g,fetcher,now:()=>at,waitUntil:p=>{retained=p;}});const pending=h(new Request(request(),{signal:controller.signal}));
  await vi.waitFor(()=>expect(fetcher).toHaveBeenCalled());controller.abort();await vi.waitFor(()=>expect(g.release).toHaveBeenCalledWith('synthetic-owned',expect.objectContaining({kind:'temporary_failure'})));
  let done=false;void retained!.then(()=>{done=true;});await Promise.resolve();expect(done).toBe(false);release.resolve();await pending;await retained;expect(done).toBe(true);expect(fetcher).toHaveBeenCalledTimes(1);
 });
});

describe('TAIFEX daily age boundaries',()=>{
 it.each([[STALE_REPORT_DAYS,'2026-11-02','available'],[STALE_REPORT_DAYS+1,'2026-11-01','stale'],[MAX_REPORT_AGE_DAYS,'2026-10-23','stale'],[MAX_REPORT_AGE_DAYS+1,'2026-10-22','unavailable']] as const)('treats a %i-day report dated %s as %s',async(age,date,state)=>{
  const t=setup();t.fetcher.mockResolvedValue(Response.json(datedPayload(date)));const r=await t.reply();expect(r.status.state).toBe(state);
  if(state==='unavailable'){expect(r.snapshot).toBeNull();expect(r.status.error_code).toBe('source_report_too_old');}
  else expect(reportAge(r.snapshot!,at)).toBe(age);
 });
 it('uses Taipei calendar boundaries without fabricating release times or market holidays',()=>{
  const s=taifexReply().snapshot!;expect(reportAge(s,Date.parse('2026-11-06T15:59:59.999Z'))).toBe(1);expect(reportAge(s,Date.parse('2026-11-06T16:00:00.000Z'))).toBe(2);
  expect(s.source_released_at).toBeNull();
 });
 it('shows cache only through the exact 24-hour and five-second clock-skew bounds',()=>{
  const r=taifexReply();expect(visibleSnapshot(r,at+MAX_CACHE_AGE_MS)).toEqual(r.snapshot);expect(visibleSnapshot(r,at+MAX_CACHE_AGE_MS+1)).toBeNull();
  expect(visibleSnapshot(r,at-5000)).toEqual(r.snapshot);expect(visibleSnapshot(r,at-5001)).toBeNull();expect(visibleSnapshot(r,NaN)).toBeNull();
  r.status.state='denied';expect(visibleSnapshot(r,at)).toBeNull();
 });
 it('expires aged shared cache without contacting the source on a status read',async()=>{
  const t=setup();await t.reply();t.advance(MAX_CACHE_AGE_MS+1);const r=await(await t.handler(request('status'))).json() as TaifexReply['status'];expect(r.state).toBe('unavailable');expect(t.fetcher).toHaveBeenCalledTimes(1);
 });
});

describe('TAIFEX persistent D1 gate boundary',()=>{
 it('inspect is read-only and never decodes stopped or busy provider payloads',async()=>{
  for(const state of ['busy','blocked'] as const){const run=vi.fn(async()=>({success:true,results:[{status:state,not_before_ms:123,payload:'invalid stale payload'}]}));
   expect(await new D1TaifexGate(dbWith(run)).inspect()).toEqual({state,retryAt:123,snapshot:null});expect(run).toHaveBeenCalledExactlyOnceWith(TAIFEX_SQL.inspect,[]);
  }
 });
 it.each([null,{status:'unknown',not_before_ms:0,payload:null},{status:'idle',not_before_ms:-1,payload:null},{status:'idle',not_before_ms:0.1,payload:null},{status:'idle',not_before_ms:0,payload:'{}'},{status:'idle',not_before_ms:0,payload:'x'.repeat(MAX_BYTES+1)}])('fails closed on absent, malformed or unbounded shared state %#',async row=>{
  const run=vi.fn(async()=>({success:true,results:row?[row]:[]}));await expect(new D1TaifexGate(dbWith(run)).inspect()).rejects.toMatchObject({code:'source_gate_unavailable'});expect(run).toHaveBeenCalledTimes(1);
 });
 it('accepts exactly the validated 30-row shared snapshot',async()=>{
  const snapshot=taifexReply().snapshot;const run=vi.fn(async()=>({success:true,results:[{status:'idle',not_before_ms:at+REFRESH_MS,payload:JSON.stringify(snapshot)}]}));
  expect(await new D1TaifexGate(dbWith(run)).inspect()).toEqual({state:'idle',retryAt:at+REFRESH_MS,snapshot});
 });
 it.each([['blocked','source_denied'],['busy','source_busy'],['idle','source_cooldown']] as const)('does not take over %s admission',async(status,code)=>{
  const run=vi.fn(async(sql:string)=>sql===TAIFEX_SQL.acquire?{success:true,meta:{changes:0}}:{success:true,results:[{status,now_ms:at,not_before_ms:at+REFRESH_MS}]});
  await expect(new D1TaifexGate(dbWith(run)).acquire()).rejects.toMatchObject({code});expect(run).toHaveBeenCalledTimes(2);expect(run.mock.calls.every(([sql])=>sql!==TAIFEX_SQL.finish)).toBe(true);
 });
 it('atomically blocks, clears the cached payload and releases only the owned token',async()=>{
  const run=vi.fn(async()=>({success:true,meta:{changes:1}}));await new D1TaifexGate(dbWith(run)).release('owned',{kind:'denied',retryAfterMs:7_200_000});
  expect(run).toHaveBeenCalledExactlyOnceWith(TAIFEX_SQL.finish,['blocked',7_200_000,1,null,'owned']);
  expect(TAIFEX_SQL.finish).toContain("status='busy' AND lease_token=?");expect(TAIFEX_SQL.finish).toContain("id='daily_institutions'");expect(Object.values(TAIFEX_SQL).join(' ')).not.toContain('deribit');
 });
 it.each([0,1,REFRESH_MS,REFRESH_MS+1])('enforces a full hour minimum for release delay %i',async delay=>{
  const run=vi.fn(async()=>({success:true,meta:{changes:1}}));await new D1TaifexGate(dbWith(run)).release('owned',{kind:'temporary_failure',retryAfterMs:delay});expect(run).toHaveBeenCalledWith(TAIFEX_SQL.finish,['idle',Math.max(REFRESH_MS,delay),0,null,'owned']);
 });
 it('never writes a partial snapshot or releases with another owner',async()=>{
  const run=vi.fn(async()=>({success:true,meta:{changes:0}})),g=new D1TaifexGate(dbWith(run)),snapshot=taifexReply().snapshot!;snapshot.rows.pop();
  await expect(g.release('owned',{kind:'success',snapshot})).rejects.toMatchObject({code:'source_gate_unavailable'});expect(run).not.toHaveBeenCalled();
  await expect(g.release('wrong-owner',{kind:'denied'})).rejects.toMatchObject({code:'source_stale_lease'});expect(run).toHaveBeenCalledTimes(1);
 });
 it('cleans a late acknowledged acquisition exactly once after the request has aborted',async()=>{
  const admitted=deferred<D1Result>(),controller=new AbortController();const run=vi.fn<(sql:string,values:unknown[])=>Promise<D1Result>>(async sql=>sql===TAIFEX_SQL.acquire?admitted.promise:{success:true,meta:{changes:1}});const g=new D1TaifexGate(dbWith(run));
  const acquisition=g.acquire(controller.signal);controller.abort();admitted.resolve({success:true,meta:{changes:1}});await expect(acquisition).rejects.toMatchObject({code:'source_aborted'});
  const token=run.mock.calls[0][1][0];expect(typeof token).toBe('string');expect(run.mock.calls[1][1]).toEqual(['idle',REFRESH_MS,0,null,token]);
  expect(run).toHaveBeenCalledTimes(2);expect(run.mock.calls[1][0]).toBe(TAIFEX_SQL.finish);
 });
 it('refuses an already aborted acquisition without touching D1',async()=>{
  const run=vi.fn(async()=>({success:true,meta:{changes:1}})),controller=new AbortController();controller.abort();await expect(new D1TaifexGate(dbWith(run)).acquire(controller.signal)).rejects.toMatchObject({code:'source_aborted'});expect(run).not.toHaveBeenCalled();
 });
});
