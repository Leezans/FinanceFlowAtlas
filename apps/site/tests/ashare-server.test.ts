import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createAshareHandler,FIELDS,parseScope} from '../lib/ashare/ashare';
import {strictJSON} from '../lib/ashare/strict-json';
import {validateEvidence,type EvidenceSnapshot} from '../components/ashare/model';
const request=(scope='level1',path='snapshot',headers?:HeadersInit)=>new Request(`https://private.example/api/v1/ashare/${path}?scope=${scope}`,{headers});
const item=(i=1,stock=false)=>Object.fromEntries(FIELDS.map(f=>[f,f==='f12'?(stock?String(i).padStart(6,'0'):`BK${String(i).padStart(4,'0')}`):f==='f14'?'合成行业':1]));
const upstream=(rows:unknown[]=[item()],total=rows.length)=>new Response(JSON.stringify({rc:0,data:{total,diff:rows}}),{headers:{'content-type':'application/json'}});
type HandlerOptions=NonNullable<Parameters<typeof createAshareHandler>[0]>;
const make=(fetcher:HandlerOptions['fetcher'],extra:HandlerOptions={})=>createAshareHandler({enabled:()=>true,fetcher,isolatedForTests:true,...extra});
async function settle<T>(promise:Promise<T>){let done=false;promise.finally(()=>done=true);for(let i=0;i<40&&!done;i++)await vi.advanceTimersByTimeAsync(3000);return promise;}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-04T12:00:00Z'));});
afterEach(()=>vi.useRealTimers());
describe('scope and private access',()=>{
 it('defaults disabled and makes zero calls',async()=>{const fetcher=vi.fn();const h=createAshareHandler({fetcher,isolatedForTests:true});expect((await h(request())).status).toBe(403);expect(fetcher).not.toHaveBeenCalled();});
 it('accepts only one strict scope',()=>{for(const q of ['scope=BK0001','scope=level1',''])expect(()=>parseScope(new URL(`https://x/?${q}`))).not.toThrow();for(const q of ['scope=BK１２３４','scope=BK12345','scope=level2','scope=level1&scope=level1','url=https://evil.test','scope=b:BK0001'])expect(()=>parseScope(new URL(`https://x/?${q}`))).toThrow();});
 it('rejects method/path/query before network',async()=>{const f=vi.fn();const h=make(f);expect((await h(new Request('https://x/api/v1/ashare/snapshot',{method:'POST'}))).status).toBe(405);expect((await h(request('bad'))).status).toBe(400);expect((await h(request('level1','other'))).status).toBe(404);expect(f).not.toHaveBeenCalled();});
 it('status never acquires and is truthful',async()=>{const f=vi.fn();const r=await make(f)(request('level1','status'));expect(await r.json()).toMatchObject({acquisition_is_separate:false,refresh_interval_seconds:60});expect(f).not.toHaveBeenCalled();});
});
describe('controlled transport and contract',()=>{
 it('emits exact schema, cache and 304, without source freshness claims',async()=>{const f=vi.fn(async()=>upstream());const h=make(f);const r=await h(request());expect(r.status).toBe(200);const p=await r.json();expect(p).toMatchObject({schema:'ashare-provider-evidence/1',scope:{fs:'m:90+s:2+f:!50',classification_level:'eastmoney_level_1'},source_observed_at:null,trade_date:null,delay_status:'not_provided',stale:false,has_error:false,field_units:{f62:'CNY',f3:'percent',f2:'index_points'}});expect(Object.keys(p as Record<string,unknown>).sort()).toEqual(['schema','rows','source_total','fetched_at','scope','page_count','source_observed_at','trade_date','metric_kind','metric_field','unit','field_units','delay_status','classification_exclusivity','notice','stale','has_error'].sort());const etag=r.headers.get('etag')!;const cached=await h(request('level1','snapshot',{'If-None-Match':etag}));expect(cached.status).toBe(304);expect(await cached.text()).toBe('');expect(f).toHaveBeenCalledTimes(1);const [url,init]=f.mock.calls[0] as unknown as [string,RequestInit];expect(new URL(url).origin).toBe('https://push2.eastmoney.com');expect(new URL(url).searchParams.get('pz')).toBe('100');expect(init).toMatchObject({method:'GET',redirect:'manual',credentials:'omit',cache:'no-store'});});
 it('allows one normal redirect preserving every parameter and 3s pacing',async()=>{const times:number[]=[];const f=vi.fn(async()=>{times.push(Date.now());return times.length===1?new Response('',{status:302,headers:{location:'https://push2delay.eastmoney.com/api/qt/clist/get'}}):upstream();});const r=await settle(make(f)(request()));expect(r.status).toBe(200);expect(times[1]-times[0]).toBeGreaterThanOrEqual(3000);const calls=f.mock.calls as unknown as [string,RequestInit][];expect(new URL(calls[1][0]).search).toBe(new URL(calls[0][0]).search);expect(new URL(calls[1][0]).host).toBe('push2delay.eastmoney.com');});
 it.each(['https://evil.test/api/qt/clist/get','http://push2delay.eastmoney.com/api/qt/clist/get','https://push2delay.eastmoney.com/api/qt/clist/get?fs=evil','https://user@push2delay.eastmoney.com/api/qt/clist/get','https://push2delay.eastmoney.com/api/qt/clist/get#fragment','https://push2delay.eastmoney.com:443/api/qt/clist/get','https://push2delay.eastmoney.com/api/qt/x/../clist/get','https://%70ush2delay.eastmoney.com/api/qt/clist/get'])('denies unsafe redirect %s',async location=>{const f=vi.fn(async()=>new Response('',{status:302,headers:{location}}));expect((await make(f)(request())).status).toBe(503);expect(f).toHaveBeenCalledTimes(1);});
 it('does not follow second redirect or retry denial/challenge',async()=>{for(const status of [302,403,429,500]){const f=vi.fn(async()=>new Response('',{status,headers:{location:'https://push2delay.eastmoney.com/api/qt/clist/get'}}));const h=make(f);expect((await settle(h(request()))).status).toBe(503);expect(f).toHaveBeenCalledTimes(status===302?2:1);await h(request());expect(f).toHaveBeenCalledTimes(status===302?2:1);}});
 it('accepts exact official protocol-relative redirect and preserves HTTPS/query',async()=>{let n=0;const f=vi.fn(async(url:string)=>++n===1?new Response('',{status:302,headers:{location:'//push2delay.eastmoney.com/api/qt/clist/get'+new URL(url).search}}):upstream());expect((await settle(make(f)(request()))).status).toBe(200);expect(f.mock.calls[1][0]).toMatch(/^https:\/\/push2delay\.eastmoney\.com\/api\/qt\/clist\/get\?/);expect(new URL(f.mock.calls[0][0]).search).toBe(new URL(f.mock.calls[1][0]).search);});
 it.each(['//push2delay.eastmoney.com:443/api/qt/clist/get','//evil.test/api/qt/clist/get','//push2delay.eastmoney.com/api/qt/x/../clist/get','///push2delay.eastmoney.com/api/qt/clist/get'])('still rejects protocol-relative normalization %s',async location=>{const f=vi.fn(async()=>new Response('',{status:302,headers:{location}}));expect((await make(f)(request())).status).toBe(503);expect(f).toHaveBeenCalledTimes(1);});
 it.each(['403','429','html','provider'])('latches %s across all scopes indefinitely, preserving last good as stale',async mode=>{let n=0;const f=vi.fn(async()=>{if(++n===1)return upstream();if(mode==='html')return new Response('<html>challenge</html>',{headers:{'content-type':'text/html'}});if(mode==='provider')return new Response('{"rc":-1,"data":null}',{headers:{'content-type':'application/json'}});return new Response('',{status:Number(mode)});});const h=make(f);expect((await h(request())).status).toBe(200);await vi.advanceTimersByTimeAsync(60001);const denied=await h(request());expect(await denied.json()).toMatchObject({stale:true,has_error:true,source_total:1});await vi.advanceTimersByTimeAsync(86400000);for(const scope of ['BK0001','BK0002','level1'])await h(request(scope));expect(f).toHaveBeenCalledTimes(2);expect(await (await h(request('BK0003','status'))).json()).toMatchObject({has_error:true});});
 it('temporary 500 network failure retries only after backoff',async()=>{let n=0;const f=vi.fn(async()=>++n===1?new Response('',{status:500}):upstream());const h=make(f);expect((await h(request())).status).toBe(503);expect((await h(request())).status).toBe(503);expect(f).toHaveBeenCalledTimes(1);await vi.advanceTimersByTimeAsync(60001);expect((await h(request())).status).toBe(200);expect(f).toHaveBeenCalledTimes(2);});
 it('accepts ordinary HTML 302 only after exact official Location validation',async()=>{let n=0;const f=vi.fn(async(url:string)=>++n===1?new Response('<html>Moved</html>',{status:302,headers:{'content-type':'text/html',location:'//push2delay.eastmoney.com/api/qt/clist/get'+new URL(url).search}}):upstream());const release=vi.fn(async()=>{});const gate={async acquire(){return {token:'one'};},release};expect((await settle(make(f,{sourceGate:gate})(request()))).status).toBe(200);expect(f).toHaveBeenCalledTimes(2);expect(release).toHaveBeenCalledWith('one',{kind:'success'});});
 it.each(['https://login.eastmoney.com/login','https://push2delay.eastmoney.com/api/qt/clist/get?fs=changed'])('persists disallowed redirect %s across handler recreation',async location=>{let denied=false;const gate={async acquire(){if(denied)throw Object.assign(new Error('denied'),{code:'source_denied'});return {token:'one'};},release:vi.fn(async(_token:string,outcome:{kind:string})=>{denied=outcome.kind==='denied';})};const f=vi.fn(async()=>new Response('<html>Login</html>',{status:302,headers:{'content-type':'text/html',location}}));expect((await make(f,{sourceGate:gate})(request())).status).toBe(503);expect(gate.release).toHaveBeenCalledWith('one',{kind:'denied',reason:'source_denial'});await vi.advanceTimersByTimeAsync(86400000);const fresh=make(f,{sourceGate:gate});await fresh(request('BK0001'));await fresh(request());expect(f).toHaveBeenCalledTimes(1);});
 it('serializes scopes and deduplicates same-scope refresh',async()=>{const times:number[]=[];const f=vi.fn(async(url:string)=>{times.push(Date.now());return upstream([item(1,new URL(url).searchParams.get('fs')!.startsWith('b:'))]);});const h=make(f);const all=await settle(Promise.all([h(request()),h(request()),h(request('BK0001'))]));expect(all.map(r=>r.status)).toEqual([200,200,200]);expect(f).toHaveBeenCalledTimes(2);expect(times[1]-times[0]).toBeGreaterThanOrEqual(3000);});
});
describe('persistent source gate integration',()=>{
 it('requires gate in production even when explicitly enabled',async()=>{const f=vi.fn();const h=createAshareHandler({enabled:()=>true,runtime:'cloudflare-workers',fetcher:f});expect((await h(request())).status).toBe(503);expect(f).not.toHaveBeenCalled();});
 it('acquires before first source request and releases only after complete collection',async()=>{const order:string[]=[];const gate={acquire:vi.fn(async(scope:string,signal:AbortSignal)=>{expect(scope).toBe('m:90+s:2+f:!50');expect(signal).toBeInstanceOf(AbortSignal);order.push('acquire');return {token:'lease-1'};}),release:vi.fn(async()=>{order.push('release');})};const f=vi.fn(async()=>{order.push('fetch');return upstream();});expect((await make(f,{sourceGate:gate})(request())).status).toBe(200);expect(order).toEqual(['acquire','fetch','release']);expect(gate.release).toHaveBeenCalledWith('lease-1',{kind:'success'});});
 it.each(['source_busy','source_cooldown','source_gate_unavailable','source_denied'])('fails closed on gate %s',async code=>{const f=vi.fn();const gate={async acquire(){throw Object.assign(new Error('gate'),{code});},release:vi.fn()};expect((await settle(make(f,{sourceGate:gate})(request()))).status).toBe(503);expect(f).not.toHaveBeenCalled();expect(gate.release).not.toHaveBeenCalled();});
 it('waits at most once for cooldown admission with no source request before 3.1s',async()=>{let attempts=0;const gate={acquire:vi.fn(async()=>{if(++attempts===1)throw Object.assign(new Error('cooldown'),{code:'source_cooldown'});return {token:'one'};}),release:vi.fn(async()=>{})};const f=vi.fn(async()=>upstream([item(1,true)]));const p=make(f,{sourceGate:gate})(request('BK0001'));await vi.advanceTimersByTimeAsync(3099);expect(f).not.toHaveBeenCalled();expect(gate.acquire).toHaveBeenCalledTimes(1);await vi.advanceTimersByTimeAsync(1);expect((await p).status).toBe(200);expect(gate.acquire).toHaveBeenCalledTimes(2);expect(f).toHaveBeenCalledTimes(1);});
 it('second cooldown stops admission without looping or source fetch',async()=>{const gate={acquire:vi.fn(async()=>{throw Object.assign(new Error('cooldown'),{code:'source_cooldown'});}),release:vi.fn(async()=>{})};const f=vi.fn();expect((await settle(make(f,{sourceGate:gate})(request()))).status).toBe(503);expect(gate.acquire).toHaveBeenCalledTimes(2);expect(f).not.toHaveBeenCalled();});
 it('aborting cooldown wait prevents second admission and source request',async()=>{const gate={acquire:vi.fn(async()=>{throw Object.assign(new Error('cooldown'),{code:'source_cooldown'});}),release:vi.fn(async()=>{})};const c=new AbortController();const f=vi.fn();const p=make(f,{sourceGate:gate})(new Request('https://x/api/v1/ashare/snapshot',{signal:c.signal}));await vi.advanceTimersByTimeAsync(100);c.abort();expect((await p).status).toBe(503);expect(gate.acquire).toHaveBeenCalledTimes(1);expect(f).not.toHaveBeenCalled();});
 it.each(['text/html','application/xhtml+xml'])('503 %s permanently denies across new handlers',async type=>{let denied=false;const gate={async acquire(){if(denied)throw Object.assign(new Error('denied'),{code:'source_denied'});return {token:'one'};},release:vi.fn(async(_t:string,outcome:{kind:string})=>{denied=outcome.kind==='denied';})};const f=vi.fn(async()=>new Response('<html>challenge</html>',{status:503,headers:{'content-type':type}}));expect((await make(f,{sourceGate:gate})(request())).status).toBe(503);expect(gate.release).toHaveBeenCalledWith('one',{kind:'denied',reason:'source_denial'});await vi.advanceTimersByTimeAsync(86400000);const h=make(f,{sourceGate:gate});await h(request('BK0001'));await h(request());expect(f).toHaveBeenCalledTimes(1);});
 it('persists denial before response and new handler remains stopped',async()=>{let denied=false;const gate={acquire:vi.fn(async()=>{if(denied)throw Object.assign(new Error('denied'),{code:'source_denied'});return {token:'one'};}),release:vi.fn(async(_token:string,outcome:{kind:string})=>{if(outcome.kind==='denied')denied=true;})};const first=vi.fn(async()=>new Response('',{status:403}));expect((await make(first,{sourceGate:gate})(request())).status).toBe(503);expect(gate.release).toHaveBeenCalledWith('one',{kind:'denied',reason:'source_denial'});const second=vi.fn(async()=>upstream());await vi.advanceTimersByTimeAsync(86400000);const restarted=make(second,{sourceGate:gate});expect((await restarted(request('BK0001'))).status).toBe(503);expect(second).not.toHaveBeenCalled();expect(first).toHaveBeenCalledTimes(1);});
 it('preserves cached data without source request if another handler has persistently denied',async()=>{let denied=false;const gate={async acquire(){if(denied)throw Object.assign(new Error('denied'),{code:'source_denied'});return {token:'one'};},async release(){}};const f=vi.fn(async()=>upstream());const h=make(f,{sourceGate:gate});expect((await h(request())).status).toBe(200);denied=true;await vi.advanceTimersByTimeAsync(60001);const r=await h(request());expect(r.status).toBe(200);expect(await r.json()).toMatchObject({stale:true,has_error:true});expect(f).toHaveBeenCalledTimes(1);});
 it('release write failure never publishes candidate or retries, and release called once',async()=>{const gate={async acquire(){return {token:'one'};},release:vi.fn(async()=>{throw new Error('write unavailable');})};const f=vi.fn(async()=>upstream());const h=make(f,{sourceGate:gate});expect((await h(request())).status).toBe(503);await vi.advanceTimersByTimeAsync(86400000);expect((await h(request('BK0001'))).status).toBe(503);expect(f).toHaveBeenCalledTimes(1);expect(gate.release).toHaveBeenCalledTimes(1);});
 it('observed denial is persisted even when body cancellation rejects',async()=>{const gate={async acquire(){return {token:'one'};},release:vi.fn(async()=>{})};const body=new ReadableStream({cancel(){throw new Error('cancel failed');}});expect((await make(async()=>new Response(body,{status:403}),{sourceGate:gate})(request())).status).toBe(503);expect(gate.release).toHaveBeenCalledWith('one',{kind:'denied',reason:'source_denial'});});
 it('temporary failure releases as temporary, not denial',async()=>{const gate={async acquire(){return {token:'one'};},release:vi.fn(async()=>{})};expect((await make(async()=>new Response('{\"error\":\"temporary\"}',{status:500,headers:{'content-type':'application/json'}}),{sourceGate:gate})(request())).status).toBe(503);expect(gate.release).toHaveBeenCalledWith('one',{kind:'temporary_failure',reason:'collection_failed'});});
});
describe('scope-specific quote units',()=>{
 it('revalidates a legacy quote-unit ETag without refetching cached rows',async()=>{
  const fetcher=vi.fn(async()=>upstream([{...item(),f2:5432.1}]));
  const handler=make(fetcher);
  const first=await handler(request());
  // Retain response key order because it is part of the serialized ETag input.
  const corrected=await first.json() as EvidenceSnapshot;
  validateEvidence(corrected);
  // Before the unit correction, the same rows/scope/timestamps were labeled CNY.
  const legacy={...corrected,field_units:{...corrected.field_units,f2:'CNY'}};
  const etagFor=async(value:unknown)=>{
   const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));
   return '"'+Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('')+'"';
  };
  expect(await etagFor(corrected)).toBe(first.headers.get('etag'));
  const legacyEtag=await etagFor(legacy);
  expect(()=>validateEvidence(legacy)).toThrow('Quote unit differs from source scope');
  const updated=await handler(request('level1','snapshot',{'If-None-Match':legacyEtag}));
  expect(updated.status).toBe(200);
  expect(updated.headers.get('etag')).not.toBe(legacyEtag);
  expect(updated.headers.get('etag')).toBe(first.headers.get('etag'));
  expect(await updated.json()).toEqual(corrected);
  expect(corrected.field_units.f2).toBe('index_points');
  const cached=await handler(request('level1','snapshot',{'If-None-Match':updated.headers.get('etag')!}));
  expect(cached.status).toBe(304);
  expect(await cached.text()).toBe('');
  expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it.each([false,true])('retains the raw quote and rejects incompatible metadata for stocks=%s',async stocks=>{
  const quote=stocks?12.34:5432.1;
  const response=await make(async()=>upstream([{...item(1,stocks),f2:quote}]))(request(stocks?'BK0001':'level1'));
  expect(response.status).toBe(200);
  const snapshot=validateEvidence(await response.json());
  expect(snapshot.field_units).toEqual({f62:'CNY',f3:'percent',f2:stocks?'CNY':'index_points'});
  expect(validateEvidence(snapshot).rows[0].f2).toBe(quote);
  expect(()=>validateEvidence({...snapshot,field_units:{...snapshot.field_units,f2:stocks?'index_points':'CNY'}})).toThrow('Quote unit differs from source scope');
  expect(()=>validateEvidence({...snapshot,field_units:{...snapshot.field_units,f2:'unknown'}})).toThrow();
 });
 it.each([null,'-','--',''])('does not manufacture an industry quote from missing value %s',async f2=>{
  const response=await make(async()=>upstream([{...item(),f2}]))(request());
  const snapshot=validateEvidence(await response.json());
  expect(validateEvidence(snapshot).rows[0].f2).toBe(f2);
  expect(snapshot.field_units.f2).toBe('index_points');
 });
});

describe('validation and publication',()=>{
 it('collects all pages with stable total and unique IDs',async()=>{const f=vi.fn(async(url:string)=>new URL(url).searchParams.get('pn')==='1'?upstream(Array.from({length:100},(_,i)=>item(i+1)),101):upstream([item(101)],101));const r=await settle(make(f)(request()));expect(r.status).toBe(200);expect(await r.json()).toMatchObject({source_total:101,page_count:2});});
 it.each(['changed','duplicate','truncated'])('rejects %s pagination without partial data',async mode=>{let n=0;const f=vi.fn(async()=>++n===1?upstream(Array.from({length:100},(_,i)=>item(i+1)),101):upstream(mode==='truncated'?[]:[item(mode==='duplicate'?1:101)],mode==='changed'?102:101));const r=await settle(make(f)(request()));expect(r.status).toBe(503);expect(await r.text()).not.toContain('合成');});
 it.each([NaN,Infinity,true,'123',9007199254740992])('rejects invalid numeric %s',async value=>{const row={...item(),f62:value};const encoded=JSON.stringify({rc:0,data:{total:1,diff:[row]}});const f=vi.fn(async()=>new Response(Number.isNaN(value)?encoded.replace('"f62":null','"f62":NaN'):value===Infinity?encoded.replace('"f62":null','"f62":1e999'):encoded,{headers:{'content-type':'application/json'}}));expect((await make(f)(request())).status).toBe(503);});
 it('permits explicit missing values and rejects negative price/return bounds',async()=>{for(const value of [null,'-','--','']){expect((await make(async()=>upstream([{...item(),f62:value}]))(request())).status).toBe(200);}for(const patch of [{f2:-1},{f3:-101},{f12:'BK１２３４'},{f14:''}])expect((await make(async()=>upstream([{...item(),...patch}]))(request())).status).toBe(503);});
 it('rejects invalid bytes, compression, oversized body and duplicate JSON keys',async()=>{for(const response of [new Response('{"rc":0,"rc":1}',{headers:{'content-type':'application/json'}}),new Response('{}',{headers:{'content-type':'text/html'}}),new Response('{}',{headers:{'content-type':'application/json','content-encoding':'compress'}}),new Response('{}',{headers:{'content-length':'4000001'}}),new Response(new Uint8Array([0xff]),{headers:{'content-type':'application/json'}}),new Response(new Uint8Array(4_000_001),{headers:{'content-type':'application/json'}})])expect((await make(async()=>response)(request())).status).toBe(503);});
 it('keeps last-good explicitly stale with a different etag after failure, then backs off',async()=>{let n=0;const f=vi.fn(async()=>++n===1?upstream():new Response('',{status:429}));const h=make(f);const first=await h(request());await vi.advanceTimersByTimeAsync(60001);const second=await h(request('level1','snapshot',{'If-None-Match':first.headers.get('etag')!}));expect(second.status).toBe(200);expect(second.headers.get('etag')).not.toBe(first.headers.get('etag'));expect(await second.json()).toMatchObject({stale:true,has_error:true,source_total:1});await h(request());expect(f).toHaveBeenCalledTimes(2);});
 it('revocation suppresses cached data',async()=>{let enabled=true;const h=make(async()=>upstream(),{enabled:()=>enabled});expect((await h(request())).status).toBe(200);enabled=false;expect((await h(request())).status).toBe(403);});
 it('aborts pending fetch on request cancellation and marks unavailable',async()=>{const c=new AbortController();const f=vi.fn(async(_url:string,init:RequestInit)=>new Promise<Response>((_,reject)=>init.signal?.addEventListener('abort',()=>reject(new Error('aborted')))));const h=make(f);const p=h(new Request('https://x/api/v1/ashare/snapshot',{signal:c.signal}));await vi.advanceTimersByTimeAsync(1);c.abort();expect((await p).status).toBe(503);expect(f).toHaveBeenCalledTimes(1);});
 it('deadline aborts a stalled fetch without retry',async()=>{const f=vi.fn(async(_url:string,init:RequestInit)=>new Promise<Response>((_,reject)=>init.signal?.addEventListener('abort',()=>reject(new Error('deadline')))));const p=make(f)(request());await vi.advanceTimersByTimeAsync(90001);expect((await p).status).toBe(503);expect(f).toHaveBeenCalledTimes(1);});
 it('byte budget is shared across redirect and success bodies',async()=>{let n=0;const f=vi.fn(async()=>++n===1?new Response(' '.repeat(3_999_990),{status:302,headers:{location:'https://push2delay.eastmoney.com/api/qt/clist/get'}}):upstream());expect((await settle(make(f)(request()))).status).toBe(503);expect(f).toHaveBeenCalledTimes(2);});
 it('unverified live routing fails closed before fetch',async()=>{const f=vi.fn();const h=createAshareHandler({enabled:()=>true,fetcher:f});expect((await h(request())).status).toBe(503);expect(f).not.toHaveBeenCalled();});
 it('strict parser rejects duplicates and deep JSON',()=>{for(const text of ['{"a":1,"a":2}','{"a":{"b":1,"b":2}}','[1,]','{"a":1,}','1e999','01','[true false]','['.repeat(25)+'0'+']'.repeat(25)])expect(()=>strictJSON(text)).toThrow();expect(strictJSON('{"a":"x\\\"y","b":[null,false,1e2]}')).toEqual({a:'x"y',b:[null,false,100]});});
});

describe('safe acquisition diagnostics',()=>{
 it('reports known failure without exposing upstream content and repeats it in status',async()=>{
  const h=make(async()=>new Response('private-provider-body',{headers:{'content-type':'application/json','content-encoding':'compress'}}));
  const response=await h(request());expect(response.status).toBe(503);
  const result=await response.json();expect(result).toMatchObject({error_code:'unsupported_content_encoding'});
  expect(JSON.stringify(result)).not.toContain('private-provider-body');
  expect(await (await h(request('level1','status'))).json()).toMatchObject({error_code:'unsupported_content_encoding',has_error:true});
 });
 it('does not expose arbitrary transport exception text',async()=>{
  const h=make(async()=>{throw new Error('private-token-or-target');});
  const result=await (await h(request())).json();expect(result).toMatchObject({error_code:'collection_failed'});
  expect(JSON.stringify(result)).not.toContain('private-token-or-target');
 });
 it('distinguishes missing source-gate storage before upstream',async()=>{
  const f=vi.fn();const gate={async acquire(){throw Object.assign(new Error('SQL detail'),{code:'source_gate_unavailable'});},async release(){}};
  const result=await (await make(f,{sourceGate:gate})(request())).json();
  expect(result).toMatchObject({error_code:'source_gate_unavailable'});expect(f).not.toHaveBeenCalled();
 });
});


describe('native decoded response handling',()=>{
 it.each(['gzip','br'])('accepts runtime-decoded %s JSON while preserving strict validation',async encoding=>{
  const f=vi.fn(async()=>{const result=upstream();result.headers.set('content-encoding',encoding);return result;});
  const response=await make(f)(request());expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({source_total:1,rows:[{f12:'BK0001'}]});
  const init=(f.mock.calls as unknown as [string,RequestInit][])[0][1];
  expect(new Headers(init.headers).has('accept-encoding')).toBe(false);
 });
 it('limits decoded bytes even when compressed content length is small',async()=>{
  const f=vi.fn(async()=>new Response(new Uint8Array(4_000_001),{headers:{'content-type':'application/json','content-encoding':'gzip','content-length':'50'}}));
  const response=await make(f)(request());expect(response.status).toBe(503);expect(await response.json()).toMatchObject({error_code:'byte_budget'});
 });
 it.each(['gzip, br','compress','deflate'])('rejects unsupported or chained coding %s without retry',async encoding=>{
  const f=vi.fn(async()=>{const result=upstream();result.headers.set('content-encoding',encoding);return result;});
  const h=make(f);const response=await h(request());expect(response.status).toBe(503);expect(await response.json()).toMatchObject({error_code:'unsupported_content_encoding'});
  await h(request());expect(f).toHaveBeenCalledTimes(1);
 });
 it('counts decoded bytes over multiple stream chunks',async()=>{
  const stream=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array(2_000_000));controller.enqueue(new Uint8Array(2_000_001));controller.close();}});
  const response=await make(async()=>new Response(stream,{headers:{'content-type':'application/json','content-encoding':'br','content-length':'50'}}))(request());
  expect(response.status).toBe(503);expect(await response.json()).toMatchObject({error_code:'byte_budget'});
 });
 it('still latches provider denial in decoded compressed JSON',async()=>{
  const gate={acquire:vi.fn(async()=>({token:'one'})),release:vi.fn(async()=>{})};
  const f=vi.fn(async()=>new Response('{"rc":1,"data":null}',{headers:{'content-type':'application/json','content-encoding':'gzip'}}));
  const h=make(f,{sourceGate:gate});expect((await h(request())).status).toBe(503);
  expect(gate.release).toHaveBeenCalledWith('one',{kind:'denied',reason:'source_denial'});
  await vi.advanceTimersByTimeAsync(86400000);await h(request());expect(f).toHaveBeenCalledTimes(1);
 });
 it('does not mistake raw compressed bytes for a decoded JSON snapshot',async()=>{
  const response=await make(async()=>new Response(new Uint8Array([31,139,8,0,0,0,0,0]),{headers:{'content-type':'application/json','content-encoding':'gzip'}}))(request());
  expect(response.status).toBe(503);
 });
});

describe('actionable recovery headers',()=>{
 it('advertises actual exponential backoff, carries it to a cold scope, and removes it on recovery',async()=>{
  let n=0;const f=vi.fn(async()=>++n<=2?new Response('{}',{status:500,headers:{'content-type':'application/json'}}):upstream());const h=make(f);
  const first=await h(request());expect(first.headers.get('retry-after')).toBe('60');expect(first.headers.get('x-ashare-recovery')).toBe('retry');
  await vi.advanceTimersByTimeAsync(60001);const second=await h(request());expect(second.headers.get('retry-after')).toBe('120');
  await vi.advanceTimersByTimeAsync(30000);const cold=await h(request('BK0002'));expect(cold.headers.get('retry-after')).toBe('90');expect(cold.headers.get('x-ashare-error-code')).toBe('upstream_http');expect(f).toHaveBeenCalledTimes(2);
  const status=await h(request('BK0002','status'));expect(status.headers.get('retry-after')).toBe('90');expect(f).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(90000);const recovered=await h(request());expect(recovered.status).toBe(200);expect(recovered.headers.get('retry-after')).toBeNull();expect(recovered.headers.get('x-ashare-error-code')).toBeNull();
 });
 it('keeps diagnostics on stale 200 and 304 without changing ETag as countdown elapses',async()=>{
  let n=0;const f=vi.fn(async()=>++n===1?upstream():new Response('{}',{status:500,headers:{'content-type':'application/json'}}));const h=make(f);
  await h(request());await vi.advanceTimersByTimeAsync(60001);const stale=await h(request());expect(stale.status).toBe(200);expect(stale.headers.get('x-ashare-error-code')).toBe('upstream_http');
  expect(await stale.json()).toMatchObject({stale:true,has_error:true});await vi.advanceTimersByTimeAsync(10000);
  const same=await h(request('level1','snapshot',{'If-None-Match':stale.headers.get('etag')!}));expect(same.status).toBe(304);expect(same.headers.get('retry-after')).toBe('50');expect(same.headers.get('x-ashare-error-code')).toBe('upstream_http');expect(f).toHaveBeenCalledTimes(2);
 });
 it('reports a permanent global stop to every scope without promising retry',async()=>{
  const f=vi.fn(async()=>new Response('',{status:403}));const h=make(f);
  for(const scope of ['level1','BK0001','BK0002']){
   const response=await h(request(scope));expect(response.headers.get('retry-after')).toBeNull();expect(response.headers.get('x-ashare-recovery')).toBe('stopped');expect(response.headers.get('x-ashare-error-code')).toBe('source_access_denied');
  }
  expect(f).toHaveBeenCalledTimes(1);
 });
 it('marks cached denial on both 200 and 304 so browser can remove evidence',async()=>{
  let n=0;const h=make(async()=>++n===1?upstream():new Response('',{status:403}));await h(request());await vi.advanceTimersByTimeAsync(60001);
  const first=await h(request());expect(first.status).toBe(200);expect(first.headers.get('x-ashare-recovery')).toBe('stopped');
  const cached=await h(request('level1','snapshot',{'If-None-Match':first.headers.get('etag')!}));expect(cached.status).toBe(304);expect(cached.headers.get('x-ashare-recovery')).toBe('stopped');expect(cached.headers.get('retry-after')).toBeNull();
 });
});

describe('request lifetime retention',()=>{
 it('registers acquisition and release lifetime before source admission',async()=>{
  const order:string[]=[];const retained:Promise<unknown>[]=[];
  const gate={async acquire(){order.push('acquire');return {token:'one'};},async release(){order.push('release');}};
  const h=make(async()=>{order.push('fetch');return upstream();},{sourceGate:gate,waitUntil:(promise:Promise<unknown>)=>{order.push('retain');retained.push(promise);}});
  expect((await h(request())).status).toBe(200);await Promise.all(retained);
  expect(order).toEqual(['retain','acquire','fetch','release']);expect(retained).toHaveLength(1);
 });
 it('fails closed before acquiring if lifetime registration throws',async()=>{
  const f=vi.fn();const gate={acquire:vi.fn(),release:vi.fn()};
  const h=make(f,{sourceGate:gate,waitUntil:()=>{throw new Error('unavailable');}});
  const result=await h(request());expect(result.status).toBe(503);
  expect(await result.json()).toMatchObject({error_code:'runtime_lifetime_unverified'});
  expect(f).not.toHaveBeenCalled();expect(gate.acquire).not.toHaveBeenCalled();
 });
 it('production requires lifetime registration without touching the gate',async()=>{
  const f=vi.fn();const gate={acquire:vi.fn(),release:vi.fn()};
  const h=createAshareHandler({enabled:()=>true,runtime:'cloudflare-workers',fetcher:f,sourceGate:gate});
  expect(await (await h(request())).json()).toMatchObject({error_code:'runtime_lifetime_unverified'});
  expect(f).not.toHaveBeenCalled();expect(gate.acquire).not.toHaveBeenCalled();
 });
 it('retained promise includes confirmed release after request cancellation',async()=>{
  const retained:Promise<unknown>[]=[];const c=new AbortController();let releaseDone!:()=>void;
  const releaseBarrier=new Promise<void>(resolve=>{releaseDone=resolve;});
  const gate={async acquire(){return {token:'one'};},release:vi.fn(async()=>releaseBarrier)};
  const f=vi.fn(async(_url:string,init:RequestInit)=>new Promise<Response>((_,reject)=>init.signal?.addEventListener('abort',()=>reject(new Error('aborted')))));
  const h=make(f,{sourceGate:gate,waitUntil:(promise:Promise<unknown>)=>retained.push(promise)});
  const pending=h(new Request('https://x/api/v1/ashare/snapshot',{signal:c.signal}));
  await vi.advanceTimersByTimeAsync(1);c.abort();await vi.advanceTimersByTimeAsync(1);
  expect(gate.release).toHaveBeenCalledWith('one',{kind:'temporary_failure',reason:'collection_failed'});
  let settled=false;void retained[0].then(()=>{settled=true;});await vi.advanceTimersByTimeAsync(1);expect(settled).toBe(false);
  releaseDone();expect((await pending).status).toBe(503);await Promise.all(retained);expect(settled).toBe(true);
  expect(f).toHaveBeenCalledTimes(1);expect(gate.release).toHaveBeenCalledTimes(1);
 });
});
