import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {COUNT_URL,RANK_URL,REFRESH_MS,createSinaIndustryHandler,parseSinaCount,parseSinaIndustries,type SinaGate} from '../lib/sina/industry';
// Entirely synthetic. No captured provider observations or prices.
const row=(category='new_test')=>({cate_type:'0',category,name:'合成行业',inamount:'0.3000',outamount:'0.2000',netamount:'0.1000',ratioamount:'0.02',avg_price:'2.0000',avg_changeratio:'-0.01'});
const response=(payload:unknown)=>new Response(JSON.stringify(payload),{headers:{'content-type':'application/json; charset=utf-8'}});
const request=(path='snapshot',headers?:HeadersInit)=>new Request(`https://private.example/api/v1/ashare/sina/${path}`,{headers});
const gate=():SinaGate=>({acquire:vi.fn(async()=>({token:'test-lease'})),release:vi.fn(async()=>{})});
const happy=()=>vi.fn(async(url:string)=>response(url===COUNT_URL?'1':[row()]));
const make=(fetcher=happy(),sourceGate=gate(),enabled=()=>true)=>createSinaIndustryHandler({enabled,sourceGate,fetcher,isolatedForTests:true});
async function settle<T>(promise:Promise<T>){let done=false;void promise.finally(()=>{done=true;});for(let i=0;i<15&&!done;i++)await vi.advanceTimersByTimeAsync(3000);return promise;}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));});
afterEach(()=>vi.useRealTimers());
describe('source-specific decimal contract',()=>{
 it('retains exact decimal money and fraction units without pretending to be f62',()=>{
  const [r]=parseSinaIndustries([row()],1);expect(r).toMatchObject({id:'0/new_test',net_flow_cny:'0.1000',net_flow_ratio:'0.02',average_return_ratio:'-0.01'});expect(r).not.toHaveProperty('f62');
 });
 it.each(['01','1e3','+1',' 1','1.','NaN','Infinity','1,000',1,undefined])('rejects non-provider decimal syntax %s',value=>expect(()=>parseSinaIndustries([{...row(),netamount:value}],1)).toThrow());
 it('uses exact arithmetic beyond safe binary-float precision',()=>{
  expect(()=>parseSinaIndustries([{...row(),inamount:'999999999999999.9999999999',outamount:'999999999999999.9999999998',netamount:'0.0000000001'}],1)).not.toThrow();
  expect(()=>parseSinaIndustries([{...row(),netamount:'0.1000000001'}],1)).toThrow('flow_arithmetic_mismatch');
 });
 it('retains explicit missing values and flags zero price without declaring inactivity',()=>{
  expect(parseSinaIndustries([{...row(),netamount:null,ratioamount:null,avg_price:'0.00'}],1)[0]).toMatchObject({net_flow_cny:null,quality_flags:['missing_flow','missing_ratio','zero_price']});
 });
 it.each([{cate_type:'1'},{category:'BK0001'},{category:'../bad'},{name:''},{name:'bad\nname'},{inamount:'-1'},{avg_price:'-1'},{avg_changeratio:'-1.0001'}])('rejects bad identity or signed bounds %s',patch=>expect(()=>parseSinaIndustries([{...row(),...patch}],1)).toThrow());
 it('requires a single bounded complete unique page and canonical string count',()=>{
  for(const n of [null,48,'0','01','101','1000'])expect(()=>parseSinaCount(n)).toThrow();
  expect(parseSinaCount('100')).toBe(100);
  expect(()=>parseSinaIndustries([row(),row()],2)).toThrow('duplicate_id');
  expect(()=>parseSinaIndustries([row()],2)).toThrow('incomplete_snapshot');
 });
});
describe('controlled source access',()=>{
 it('defaults off and status never acquires, including no DB access',async()=>{
  const f=happy(),g=gate();const off=createSinaIndustryHandler({fetcher:f,sourceGate:g,isolatedForTests:true});
  expect(await (await off(request())).json()).toMatchObject({state:'source_use_review_pending'});
  expect((await off(request('status'))).status).toBe(403);await make(f,g)(request('status'));expect(f).not.toHaveBeenCalled();expect(g.acquire).not.toHaveBeenCalled();
 });
 it('rejects unsupported path/method/query with no acquisition',async()=>{
  const f=happy(),h=make(f);for(const [r,status]of [[new Request(request().url,{method:'POST'}),405],[request('other'),404],[request('snapshot?scope=BK0001'),400]]as const)expect((await h(r)).status).toBe(status);expect(f).not.toHaveBeenCalled();
 });
 it('needs an independent persistent gate and verified runtime',async()=>{
  const f=happy();expect((await createSinaIndustryHandler({enabled:()=>true,fetcher:f,isolatedForTests:true})(request())).status).toBe(503);
  expect((await createSinaIndustryHandler({enabled:()=>true,fetcher:f,sourceGate:gate()})(request())).status).toBe(503);expect(f).not.toHaveBeenCalled();
 });
 it('count/rank/count are paced and published together with honest provenance',async()=>{
  const times:number[]=[],f=vi.fn(async(url:string)=>{times.push(Date.now());return response(url===COUNT_URL?'1':[row()]);}),g=gate(),h=make(f,g);
  const r=await settle(h(request()));expect(r.status).toBe(200);expect(times[1]-times[0]).toBeGreaterThanOrEqual(3000);expect(times[2]-times[1]).toBeGreaterThanOrEqual(3000);
  expect(f.mock.calls.map(call=>call[0])).toEqual([COUNT_URL,RANK_URL,COUNT_URL]);
  expect(await r.json()).toMatchObject({schema:'sina-industry-evidence/1',source:{provider:'sina',metric_id:'sina_net_active_flow',classification:'sina_industry_fenlei_0'},source_total:1,page_count:1,source_observed_at:null,trade_date:null,monetary_encoding:'decimal_string',ratio_unit:'fraction',stale:false});
  expect(g.release).toHaveBeenCalledWith('test-lease',{kind:'success'});
  const cached=await h(request('snapshot',{'If-None-Match':r.headers.get('etag')!}));expect(cached.status).toBe(304);expect(f).toHaveBeenCalledTimes(3);
  const init=(f.mock.calls as unknown as [string,RequestInit][])[0][1];expect(init).toMatchObject({credentials:'omit',redirect:'manual',cache:'no-store',headers:{Accept:'application/json'}});
 });
 it.each(['changed','incomplete','duplicate','over_cap'])('rejects %s without publishing partial data or flow-rank pagination',async mode=>{
  let n=0;const f=vi.fn(async()=>{n++;return response(n===1?(mode==='over_cap'?'101':mode==='duplicate'?'2':'1'):n===2?(mode==='incomplete'?[]:mode==='duplicate'?[row(),row()]:[row()]):'2');});
  const r=await settle(make(f)(request()));expect(r.status).toBe(503);expect(await r.text()).not.toContain('合成行业');expect(f).toHaveBeenCalledTimes(mode==='over_cap'?1:mode==='changed'?3:2);
 });
 it.each([401,403,407,429,451,302])('latches HTTP %s without retries or invalid Retry-After',async status=>{
  const f=vi.fn(async()=>new Response('',{status,headers:{location:'https://vip.stock.finance.sina.com.cn/login'}})),g=gate(),h=make(f,g);
  const r=await h(request());expect(r.status).toBe(503);expect(r.headers.get('retry-after')).toBeNull();expect(g.release).toHaveBeenCalledWith('test-lease',{kind:'denied'});
  await vi.advanceTimersByTimeAsync(86_400_000);await h(request());expect(f).toHaveBeenCalledTimes(1);
 });
 it.each(['text/html','application/xhtml+xml','text/plain'])('latches challenge content %s',async type=>{
  const f=vi.fn(async()=>new Response('<html>challenge</html>',{headers:{'content-type':type}})),h=make(f);await h(request());await vi.advanceTimersByTimeAsync(86_400_000);await h(request());expect(f).toHaveBeenCalledTimes(1);
 });
 it('preserves denial across handler recreation via its separate gate',async()=>{
  let denied=false;const g:SinaGate={async acquire(){if(denied)throw Object.assign(new Error(),{code:'source_denied'});return {token:'one'};},async release(_token,outcome){denied=outcome.kind==='denied';}};
  const f=vi.fn(async()=>new Response('',{status:403}));await make(f,g)(request());await make(f,g)(request());expect(f).toHaveBeenCalledTimes(1);
 });
 it('honors 503 Retry-After in handler and persistent release without immediate retry',async()=>{
  const f=vi.fn(async()=>new Response('',{status:503,headers:{'retry-after':'3600'}})),g=gate(),h=make(f,g);
  const r=await h(request());expect(r.headers.get('retry-after')).toBe('3600');expect(g.release).toHaveBeenCalledWith('test-lease',{kind:'temporary_failure',retryAfterMs:3_600_000});
  await vi.advanceTimersByTimeAsync(REFRESH_MS);await h(request());expect(f).toHaveBeenCalledTimes(1);
 });
 it('retains last good stale data on failure, never substitutes another provider',async()=>{
  let n=0;const f=vi.fn(async(url:string)=>++n<=3?response(url===COUNT_URL?'1':[row()]):new Response('',{status:403})),h=make(f);
  const first=await settle(h(request()));await vi.advanceTimersByTimeAsync(REFRESH_MS+1);const stale=await h(request('snapshot',{'If-None-Match':first.headers.get('etag')!}));
  expect(stale.status).toBe(200);expect(await stale.json()).toMatchObject({stale:true,has_error:true,source:{provider:'sina'},rows:[{net_flow_cny:'0.1000'}]});expect(f).toHaveBeenCalledTimes(4);
 });
 it('deduplicates concurrent requests and never auto-polls',async()=>{
  const f=happy(),h=make(f);const results=await settle(Promise.all([h(request()),h(request())]));expect(results.map(r=>r.status)).toEqual([200,200]);expect(f).toHaveBeenCalledTimes(3);await vi.advanceTimersByTimeAsync(REFRESH_MS*2);expect(f).toHaveBeenCalledTimes(3);
 });
 it('fails closed on unavailable gate without any source calls',async()=>{
  const f=happy(),g=gate();g.acquire=vi.fn(async()=>{throw Object.assign(new Error('private SQL'),{code:'source_gate_unavailable'});});const r=await make(f,g)(request());expect(await r.json()).toMatchObject({error_code:'source_gate_unavailable'});expect(f).not.toHaveBeenCalled();
 });
});
describe('transport limits and publication safety',()=>{
 it.each(['gzip','br'])('accepts runtime-decoded %s with strict JSON parsing',async encoding=>{
  const f=vi.fn(async(url:string)=>{const r=response(url===COUNT_URL?'1':[row()]);r.headers.set('content-encoding',encoding);return r;});expect((await settle(make(f)(request()))).status).toBe(200);
 });
 it.each(['bad_json','duplicate_key','byte_budget','raw_gzip','bad_charset','compression'])('rejects %s without exposing raw payload',async mode=>{
  const data=mode==='byte_budget'?new Uint8Array(262145):mode==='raw_gzip'?new Uint8Array([31,139,8,0]):mode==='duplicate_key'?'{"x":1,"x":2}':'provider private bad payload';
  const f=vi.fn(async()=>new Response(data,{headers:{'content-type':mode==='bad_charset'?'application/json;charset=unknown':'application/json',...(mode==='compression'?{'content-encoding':'gzip, br'}:{})}}));
  const r=await make(f)(request());expect(r.status).toBe(503);expect(await r.text()).not.toContain('private bad payload');expect(f).toHaveBeenCalledTimes(1);
 });
 it('persists an observed denial without awaiting a hung body cancellation',async()=>{
  const body=new ReadableStream({cancel(){return new Promise(()=>{});}}),g=gate();
  const h=make(vi.fn(async()=>new Response(body,{status:403})),g);
  const r=await h(request());expect(r.status).toBe(503);expect(g.release).toHaveBeenCalledWith('test-lease',{kind:'denied'});
 });
 it('aborts hung acquisition by deadline and releases exactly once',async()=>{
  const f=vi.fn(async(_url:string,init:RequestInit)=>new Promise<Response>((_resolve,reject)=>init.signal!.addEventListener('abort',()=>reject(new Error('abort'))))),g=gate();
  const pending=make(f,g)(request());await vi.advanceTimersByTimeAsync(30_001);expect((await pending).status).toBe(503);expect(g.release).toHaveBeenCalledTimes(1);
 });
 it.each(['acquire','release'])('bounds a hung gate %s and never publishes or retries uncertain outcome',async operation=>{
  const f=happy(),g=gate();if(operation==='acquire')g.acquire=()=>new Promise(()=>{});else g.release=()=>new Promise(()=>{});
  const h=make(f,g),pending=h(request());await vi.advanceTimersByTimeAsync(30_001);expect((await pending).status).toBe(503);const calls=f.mock.calls.length;await vi.advanceTimersByTimeAsync(86_400_000);await h(request());expect(f).toHaveBeenCalledTimes(calls);
 });
 it('never publishes after release-time revocation',async()=>{
  let enabled=true;const g=gate();g.release=async()=>{enabled=false;};const h=make(happy(),g,()=>enabled);expect((await settle(h(request()))).status).toBe(403);
 });
 it('suppresses cached data after revocation',async()=>{
  let enabled=true;const h=make(happy(),gate(),()=>enabled);expect((await settle(h(request()))).status).toBe(200);enabled=false;expect((await h(request())).status).toBe(403);
 });
});
