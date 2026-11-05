import {strictJSON} from './strict-json';
export const NUMERIC_FIELDS=['f2','f3','f62','f184','f66','f69','f72','f75','f78','f81','f84','f87'] as const;
export const FIELDS=['f12','f14',...NUMERIC_FIELDS] as const;
const PATH='/api/qt/clist/get';
const ORIGIN='https://push2.eastmoney.com';
const DELAY='https://push2delay.eastmoney.com';
const TTL=60_000, INTERVAL=3_000, DEADLINE=90_000, MAX_BYTES=4_000_000, MAX_ROWS=2000, MAX_PAGES=20;
export type Scope={kind:'industry_rank'|'industry_stocks';fs:string;classification_level:'eastmoney_level_1'|'unknown_may_mix_levels'};
export type Row={f12:string;f14:string}&Record<typeof NUMERIC_FIELDS[number],number|null|'-'|'--'|''>;
type Snapshot={rows:Row[];source_total:number;fetched_at:string;scope:Scope;page_count:number};
type Entry={snapshot?:Snapshot;published:number;error:boolean;failures:number;retryAt:number;pending?:Promise<void>;errorCode?:string};
export type SourceOutcome={kind:'success'|'temporary_failure'|'denied';reason?:string};
export interface SourceGate {acquire(scopeKey:string,signal:AbortSignal):Promise<{token:string}>;release(token:string,outcome:SourceOutcome):Promise<void>;}
type Fetcher=(input:string,init:RequestInit)=>Promise<Response>;
type State={entries:Map<string,Entry>;tail:Promise<unknown>;lastRequest:number;backoffUntil:number;backoffFailures:number;denied:boolean};
class SourceDenied extends Error {}
// Only bounded codes leave the server. Never expose upstream bodies, URLs, or
// runtime exception text through the owner-facing API or production logs.
const ERROR_CODES=new Set(['source_denial_latched','runtime_routing_unverified','source_gate_required','source_gate_unavailable','source_busy','source_cooldown','source_denied','source_aborted','source_stale_lease','persistent_source_denial','invalid_source_lease','source_gate_release_unconfirmed','source_access_denied','html_challenge','non_json_challenge','redirect_denied','automatic_redirect_denied','provider_error_or_challenge','compressed_body_denied','byte_budget','upstream_http','not_json','invalid_schema','invalid_json','row_budget','unstable_total','incomplete_page','duplicate_id','incomplete_snapshot','invalid_row','missing_fields','invalid_id','invalid_name','invalid_numeric','negative_price','invalid_return','deadline','aborted','disabled','missing_snapshot']);
function failureCode(error:unknown):string {
  if(error&&typeof error==='object'&&'code'in error&&typeof error.code==='string'&&ERROR_CODES.has(error.code))return error.code;
  if(error instanceof Error&&ERROR_CODES.has(error.message))return error.message;
  if(error instanceof Error&&error.name==='AbortError')return 'aborted';
  if(error instanceof SyntaxError)return 'invalid_json';
  if(error instanceof TypeError)return 'transport_or_encoding_failure';
  return 'collection_failed';
}
function failureMessage(code?:string):string {
  if(code==='source_gate_unavailable')return '数据协调存储尚未就绪，请检查数据库迁移。';
  if(code==='source_busy'||code==='source_cooldown')return '另一项数据采集仍在进行或限速等待中。';
  if(code==='compressed_body_denied')return '来源返回压缩内容，当前传输校验未通过。';
  if(code==='source_access_denied'||code==='persistent_source_denial'||code==='source_denied'||code==='source_denial_latched')return '来源限制访问，已停止采集，不会绕过限制。';
  if(code==='runtime_routing_unverified')return '当前运行环境的来源连接未通过校验。';
  if(code==='aborted'||code==='deadline')return '数据请求中断或超时，尚未取得完整快照。';
  return '来源连接或数据校验失败，尚无完整有效快照。';
}
const stateKey=Symbol.for('FinanceFlowAtlas.ashare.controlled.v1');
const globals=globalThis as typeof globalThis & {[stateKey]?:State};
function processState():State{return globals[stateKey]??=(freshState());}
function freshState():State{return {entries:new Map(),tail:Promise.resolve(),lastRequest:-Infinity,backoffUntil:0,backoffFailures:0,denied:false};}
export function parseScope(url:URL):Scope {
  if([...url.searchParams.keys()].some(k=>k!=='scope')||url.searchParams.getAll('scope').length>1)throw new Error('invalid_scope');
  const scope=url.searchParams.get('scope')??'level1';
  if(scope==='level1')return {kind:'industry_rank',fs:'m:90+s:2+f:!50',classification_level:'eastmoney_level_1'};
  if(/^BK[0-9]{4}$/.test(scope))return {kind:'industry_stocks',fs:`b:${scope}`,classification_level:'unknown_may_mix_levels'};
  throw new Error('invalid_scope');
}
function abortCheck(signal:AbortSignal){if(signal.aborted)throw new Error('aborted');}
function sleep(ms:number,signal:AbortSignal):Promise<void>{return new Promise((resolve,reject)=>{abortCheck(signal);const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',cancel);};const cancel=()=>{done();reject(new Error('aborted'));};const timer=setTimeout(()=>{done();resolve();},ms);signal.addEventListener('abort',cancel,{once:true});});}
function row(value:unknown,scope:Scope):Row {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('invalid_row');
  const obj=value as Record<string,unknown>;
  if(!FIELDS.every(k=>Object.hasOwn(obj,k)))throw new Error('missing_fields');
  if(typeof obj.f12!=='string'||!(scope.kind==='industry_stocks'?/^[0-9]{6}$/:/^BK[0-9]{4}$/).test(obj.f12))throw new Error('invalid_id');
  if(typeof obj.f14!=='string'||!obj.f14.trim()||obj.f14.length>128)throw new Error('invalid_name');
  for(const key of NUMERIC_FIELDS){const v=obj[key];if(v===null||v==='-'||v==='--'||v==='')continue;if(typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>Number.MAX_SAFE_INTEGER)throw new Error('invalid_numeric');}
  if(typeof obj.f2==='number'&&obj.f2<0)throw new Error('negative_price');
  if(typeof obj.f3==='number'&&obj.f3< -100)throw new Error('invalid_return');
  return Object.fromEntries(FIELDS.map(k=>[k,obj[k]])) as Row;
}
function params(scope:Scope,page:number):URLSearchParams{return new URLSearchParams({pn:String(page),pz:'100',po:'1',np:'1',fltt:'2',invt:'2',fid:'f62',fs:scope.fs,fields:FIELDS.join(',')});}
function redirect(current:string,location:string,query:URLSearchParams):string {
  if(!location||location.length>2048||/[^\x21-\x7e]/.test(location)||location.includes('#'))throw new Error('redirect_denied');
  // Inspect raw authority/path before URL normalization can hide :443, dot segments or encoded hosts.
  if(!/^(?:https:)?\/\/push2delay\.eastmoney\.com\/api\/qt\/clist\/get(?:\?[^#]*)?$/.test(location))throw new Error('redirect_denied');
  const target=new URL(location,current);
  if(target.origin!==DELAY||target.pathname!==PATH||target.username||target.password||target.hash||target.port)throw new Error('redirect_denied');
  if(target.search){const pairs=[...target.searchParams];if(pairs.length!==[...query].length||pairs.some(([k,v])=>query.get(k)!==v)||new Set(pairs.map(([k])=>k)).size!==pairs.length)throw new Error('redirect_params_changed');}
  return `${DELAY}${PATH}?${query}`;
}
async function body(response:Response,budget:number,signal:AbortSignal):Promise<Uint8Array>{
  const encoding=response.headers.get('content-encoding');
  if(encoding&&encoding!=='identity'){await response.body?.cancel();throw new Error('compressed_body_denied');}
  const length=response.headers.get('content-length');
  if(length!==null&&(!/^[0-9]{1,12}$/.test(length)||Number(length)>budget)){await response.body?.cancel();throw new Error('byte_budget');}
  const reader=response.body?.getReader();if(!reader)return new Uint8Array();
  const chunks:Uint8Array[]=[];let size=0;
  const cancel=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
  try{while(true){abortCheck(signal);const part=await reader.read();abortCheck(signal);if(part.done)break;if(part.value.byteLength>budget-size)throw new Error('byte_budget');size+=part.value.byteLength;chunks.push(part.value);}}
  finally{signal.removeEventListener('abort',cancel);await reader.cancel().catch(()=>{});reader.releaseLock();}
  const result=new Uint8Array(size);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result;
}
/** Server-only: no background worker; no network until an enabled snapshot GET. */
export function createAshareHandler(options:{enabled?:()=>boolean;fetcher?:Fetcher;now?:()=>number;isolatedForTests?:boolean;runtime?:'cloudflare-workers';sourceGate?:SourceGate}={}){
  const state=options.isolatedForTests?freshState():processState();
  const fetcher=options.fetcher??((url,init)=>fetch(url,init));
  const sourceGate:SourceGate|undefined=options.sourceGate??(options.isolatedForTests?{async acquire(){return {token:'synthetic-only'};},async release(){}}:undefined);
  const now=options.now??(()=>performance.now());
  const enabled=()=>{try{return options.enabled?.()===true;}catch{return false;}};
  function routingAllowed():boolean {
    // Host-declared Cloudflare Workers native fetch is the only live adapter.
    // Do not use shell Node fetch to evade environment routing during previews.
    if(options.isolatedForTests&&options.fetcher)return true;
    if(options.runtime!=='cloudflare-workers')return false;
    const host=globalThis as typeof globalThis & {process?:{env?:Record<string,string|undefined>}};
    const env=host.process?.env;
    return !env||!['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'].some(k=>!!env[k]);
  }
  async function collect(scope:Scope,requestSignal:AbortSignal):Promise<Snapshot>{
    const controller=new AbortController();const abort=()=>controller.abort();
    requestSignal.addEventListener('abort',abort,{once:true});if(requestSignal.aborted)abort();
    const timer=setTimeout(abort,DEADLINE);const signal=controller.signal;
    const start=now();let bytes=0,redirects=0,total:number|undefined,endpoint=ORIGIN;const rows:Row[]=[],ids=new Set<string>();
    try {
      for(let page=1;page<=MAX_PAGES;page++){
        const query=params(scope,page);let url=`${endpoint}${PATH}?${query}`;let response:Response;let raw:Uint8Array;
        while(true){
          abortCheck(signal);if(state.denied)throw new SourceDenied('source_denial_latched');if(!enabled())throw new Error('disabled');if(!routingAllowed())throw new Error('runtime_routing_unverified');
          const wait=INTERVAL-(now()-state.lastRequest);if(wait>0)await sleep(wait,signal);
          abortCheck(signal);if(!enabled())throw new Error('disabled');if(now()-start>=DEADLINE)throw new Error('deadline');
          state.lastRequest=now();
          response=await fetcher(url,{method:'GET',redirect:'manual',credentials:'omit',cache:'no-store',headers:{Accept:'application/json','Accept-Encoding':'identity'},signal});
          const isRedirect=[301,302,303,307,308].includes(response.status);
          let nextUrl:string|undefined;
          if(isRedirect){
            // A normal official redirect may have an HTML body. Validate its
            // exact target first; an off-policy/login redirect is a denial.
            try{if(redirects>=1)throw new Error('redirect_budget');nextUrl=redirect(url,response.headers.get('location')??'',query);}
            catch{await response.body?.cancel().catch(()=>{});throw new SourceDenied('redirect_denied');}
          }
          const responseType=response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
          if(!isRedirect&&(responseType==='text/html'||responseType==='application/xhtml+xml')){await response.body?.cancel().catch(()=>{});throw new SourceDenied('html_challenge');}
          // Once observed, a denial remains a denial even if abort/cancel also fails.
          if([401,403,407,429,451].includes(response.status)){await response.body?.cancel().catch(()=>{});throw new SourceDenied('source_access_denied');}
          if(response.status===200&&response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json'){await response.body?.cancel().catch(()=>{});throw new SourceDenied('non_json_challenge');}
          abortCheck(signal);if(now()-start>=DEADLINE)throw new Error('deadline');if(response.redirected){await response.body?.cancel().catch(()=>{});throw new SourceDenied('automatic_redirect_denied');}
          raw=await body(response,MAX_BYTES-bytes,signal);bytes+=raw.byteLength;
          if(isRedirect){redirects++;url=nextUrl!;endpoint=DELAY;continue;}
          if(response.status!==200)throw new Error('upstream_http');
          if(response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')throw new Error('not_json');break;
        }
        const payload=strictJSON(new TextDecoder('utf-8',{fatal:true}).decode(raw)) as {rc?:unknown;data?:{total?:unknown;diff?:unknown}};
        if(payload&&typeof payload==='object'&&payload.rc!==0)throw new SourceDenied('provider_error_or_challenge');
        if(!payload||typeof payload!=='object'||!payload.data||!Number.isSafeInteger(payload.data.total)||!Array.isArray(payload.data.diff))throw new Error('invalid_schema');
        const count=payload.data.total as number;if(count<=0||count>MAX_ROWS||Math.ceil(count/100)>MAX_PAGES)throw new Error('row_budget');
        if(total===undefined)total=count;if(count!==total)throw new Error('unstable_total');
        const items=payload.data.diff;if(items.length!==Math.min(100,total-rows.length))throw new Error('incomplete_page');
        for(const item of items){const value=row(item,scope);if(ids.has(value.f12))throw new Error('duplicate_id');ids.add(value.f12);rows.push(value);}
        if(rows.length===total){abortCheck(signal);if(!enabled())throw new Error('disabled');return {rows,source_total:total,scope,page_count:page,fetched_at:new Date().toISOString()};}
      }
      throw new Error('incomplete_snapshot');
    }finally{clearTimeout(timer);requestSignal.removeEventListener('abort',abort);controller.abort();}
  }
  async function refresh(entry:Entry,scope:Scope,signal:AbortSignal){
    // Serialize entire acquisitions globally, so pages and redirects share pacing.
    const run=state.tail.catch(()=>{}).then(async()=>{
      if(state.denied||now()<state.backoffUntil){entry.error=true;entry.retryAt=state.denied?Infinity:state.backoffUntil;return;}
      const acquisition=new AbortController();
      const abort=()=>acquisition.abort();
      signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
      const timer=setTimeout(abort,DEADLINE);
      try{
        // Gate covers the whole acquisition, not just each page or individual isolate.
        // No lease takeover/expiry is permitted: unknown crashed work stays busy.
        if(!sourceGate)throw new Error('source_gate_required');
        if(!enabled())throw new Error('disabled');
        if(!routingAllowed())throw new Error('runtime_routing_unverified');
        abortCheck(acquisition.signal);
        const acquire=async()=>{
          abortCheck(acquisition.signal);
          if(!enabled())throw new Error('disabled');
          try{return await sourceGate.acquire(scope.fs,acquisition.signal);}
          catch(error){if(error&&typeof error==='object'&&'code'in error&&error.code==='source_denied')throw new SourceDenied('persistent_source_denial');throw error;}
        };
        let lease:{token:string};
        try{lease=await acquire();}
        catch(error){
          if(!error||typeof error!=='object'||!('code'in error)||error.code!=='source_cooldown')throw error;
          // One bounded admission wait, NOT an upstream request retry. Busy,
          // denied and unavailable are never retried or taken over here.
          await sleep(3100,acquisition.signal);
          lease=await acquire();
        }
        if(!lease||typeof lease.token!=='string'||!lease.token)throw new SourceDenied('invalid_source_lease');
        let next:Snapshot|undefined, collectionError:unknown;
        let outcome:SourceOutcome={kind:'success'};
        try{next=await collect(scope,acquisition.signal);}
        catch(error){collectionError=error;outcome=error instanceof SourceDenied?{kind:'denied',reason:'source_denial'}:{kind:'temporary_failure',reason:'collection_failed'};}
        // Release exactly once, including cancellation, and never silently ignore a
        // failed/uncertain write. No publication until persistence confirms release.
        try{await sourceGate.release(lease.token,outcome);}
        catch{throw new SourceDenied('source_gate_release_unconfirmed');}
        if(collectionError)throw collectionError;
        if(!next)throw new Error('missing_snapshot');
        entry.snapshot=next;entry.published=now();entry.error=false;entry.errorCode=undefined;entry.failures=0;entry.retryAt=0;state.backoffFailures=0;
      }
      catch(error){entry.errorCode=failureCode(error);console.warn('[ashare acquisition]',JSON.stringify({scope:scope.kind,code:entry.errorCode}));if(error instanceof SourceDenied){state.denied=true;state.backoffUntil=Infinity;}entry.error=true;entry.failures++;state.backoffFailures++;entry.retryAt=state.denied?Infinity:now()+Math.min(900_000,60_000*2**Math.min(state.backoffFailures-1,4));state.backoffUntil=entry.retryAt;}
      finally{clearTimeout(timer);signal.removeEventListener('abort',abort);acquisition.abort();}
    });state.tail=run;await run;
  }
  function reply(status:number,payload?:unknown,etag?:string){const headers:Record<string,string>={'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};if(etag)headers.ETag=etag;if(status===503)headers['Retry-After']='60';return new Response(payload===undefined?null:JSON.stringify(payload),{status,headers});}
  return async function handle(request:Request):Promise<Response>{
    if(request.method!=='GET')return reply(405,{error:'method_not_allowed'});
    const url=new URL(request.url);if(!['/api/v1/ashare/snapshot','/api/v1/ashare/status'].includes(url.pathname))return reply(404,{error:'not_found'});
    let scope:Scope;try{scope=parseScope(url);}catch{return reply(400,{error:'invalid_scope'});}
    if(!enabled())return reply(403,{state:'display_not_authorized',message:'来源展示权限未建立；不会返回缓存行情。'});
    const key=scope.fs;let entry=state.entries.get(key);
    if(url.pathname.endsWith('/status'))return reply(200,{state:entry?.snapshot?'ready':'unavailable',refreshing:!!entry?.pending,stale:!!entry?.snapshot&&(state.denied||entry.error||now()-entry.published>=TTL),has_error:state.denied||(entry?.error??false),refresh_interval_seconds:60,acquisition_is_separate:false,...(entry?.errorCode?{error_code:entry.errorCode,message:failureMessage(entry.errorCode)}:{})});
    if(!entry){
      // One level-1 plus one selected industry cache. Never evict in-flight work.
      if(scope.kind==='industry_stocks'){for(const [k,v]of state.entries){if(k.startsWith('b:')){if(v.pending)return reply(503,{state:'unavailable',message:'行业采集进行中，请稍后重试。'});state.entries.delete(k);}}}
      entry={published:0,error:false,failures:0,retryAt:0};state.entries.set(key,entry);
    }
    const stale=()=>!!entry!.snapshot&&(state.denied||entry!.error||now()-entry!.published>=TTL);
    if(!state.denied&&(!entry.snapshot||now()-entry.published>=TTL)&&now()>=entry.retryAt&&now()>=state.backoffUntil&&!entry.pending){const target=entry;target.pending=refresh(target,scope,request.signal).finally(()=>{target.pending=undefined;});}
    if(entry.pending)await entry.pending;
    if(!enabled())return reply(403,{state:'display_not_authorized',message:'来源展示权限未建立；不会返回缓存行情。'});
    if(!entry.snapshot)return reply(503,{state:'unavailable',error_code:entry.errorCode??'not_yet_acquired',message:failureMessage(entry.errorCode)});
    const payload={schema:'ashare-provider-evidence/1',...entry.snapshot,source_observed_at:null,trade_date:null,metric_kind:'provider_order_flow_proxy',metric_field:'f62',unit:'CNY',field_units:{f62:'CNY',f3:'percent',f2:'CNY'},delay_status:'not_provided',classification_exclusivity:'not_established',notice:'供应商订单分类净额代理，非市场真实新增资金；抓取时间不是行情时间。',stale:stale(),has_error:state.denied||entry.error};
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(payload)));
    const etag='"'+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')+'"';
    if(request.headers.get('if-none-match')===etag)return reply(304,undefined,etag);
    return reply(200,payload,etag);
  };
}
