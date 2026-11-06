import {strictJSON} from './strict-json';
import {safeSourceCode} from './recovery';
import {type SourceGateCode,type SourceGate,type SourceOutcome,type SourceLease} from './source-gate';
export type {SourceGate,SourceOutcome} from './source-gate';
import {FIELDS,parseScope,validateRow,type Row,type Scope,type Snapshot,SNAPSHOT_FRESH_MS as TTL} from './snapshot';
import type {SnapshotStore,SnapshotRead} from './snapshot-store';
import {StageSaveNotStarted,type StageStore} from './stage-store';
import {STAGE_MAX_AGE_MS,type Stage} from './stage';
export {NUMERIC_FIELDS,FIELDS,parseScope} from './snapshot';
export type {Row,Scope} from './snapshot';
const PATH='/api/qt/clist/get';
const ORIGIN='https://push2.eastmoney.com';
const DELAY='https://push2delay.eastmoney.com';
// Workers retain waitUntil work for at most 30s after the client disconnects.
// Start one 20s budget at handler entry, leaving room for disposal and D1 release.
// This bounds ordinary native-abort work, not uncertain network/storage results.
export const ACQUISITION_BUDGET_MS=20_000;
const INTERVAL=3_000, MAX_BYTES=4_000_000, MAX_ROWS=2000, MAX_PAGES=20;
type Entry={snapshot?:Snapshot;published:number;error:boolean;failures:number;retryAt:number;pending?:Promise<void>;errorCode?:string;localIssue?:string;committedMs?:number};
type Fetcher=(input:string,init:RequestInit)=>Promise<Response>;
type State={entries:Map<string,Entry>;tail:Promise<unknown>;lastRequest:number;backoffUntil:number;backoffFailures:number;denied:boolean;errorCode?:string};
class SourceDenied extends Error {
  constructor(code:string,readonly response?:Response){super(code);}
}
const DISPOSAL_MS=1000;
async function boundedDisposal(dispose:()=>Promise<unknown>|undefined):Promise<void>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{await Promise.race([Promise.resolve().then(dispose).catch(()=>{}),new Promise<void>(resolve=>{timer=setTimeout(resolve,DISPOSAL_MS);})]);}
  finally{if(timer!==undefined)clearTimeout(timer);}
}
async function discardDeniedResponse(response?:Response):Promise<void> {
  // Called only after the durable denial write has settled.
  if(response)await boundedDisposal(()=>response.body?.cancel());
}
// Only bounded codes leave the server. Never expose upstream bodies, URLs, or
// runtime exception text through the owner-facing API or production logs.
const ERROR_CODES=new Set(['source_denial_latched','runtime_routing_unverified','runtime_lifetime_unverified','source_gate_required','snapshot_store_required','snapshot_store_unavailable','snapshot_invalid','source_gate_unavailable','source_busy','source_outcome_unconfirmed','source_cooldown','source_denied','source_aborted','source_stale_lease','persistent_source_denial','invalid_source_lease','source_gate_release_unconfirmed','source_access_denied','html_challenge','non_json_challenge','redirect_denied','automatic_redirect_denied','provider_error_or_challenge','unsupported_content_encoding','byte_budget','upstream_http','not_json','invalid_schema','invalid_json','row_budget','unstable_total','incomplete_page','duplicate_id','incomplete_snapshot','invalid_row','missing_fields','invalid_id','invalid_name','invalid_numeric','negative_price','invalid_return','deadline','aborted','disabled','missing_snapshot','stage_invalid','stage_store_unavailable','acquisition_expired','unstable_order','collection_in_progress']);
function failureCode(error:unknown):string {
  if(error&&typeof error==='object'&&'code'in error&&typeof error.code==='string'&&ERROR_CODES.has(error.code))return error.code;
  if(error instanceof Error&&ERROR_CODES.has(error.message))return error.message;
  if(error instanceof Error&&error.name==='AbortError')return 'aborted';
  if(error instanceof SyntaxError)return 'invalid_json';
  if(error instanceof TypeError)return 'transport_or_encoding_failure';
  return 'collection_failed';
}
function failureMessage(code?:string):string {
  if(code==='source_gate_unavailable'||code==='snapshot_store_required'||code==='snapshot_store_unavailable')return '数据协调存储尚未就绪，请检查数据库迁移。';
  if(code==='source_outcome_unconfirmed')return '上次采集未能确认结果，已停止自动重试；需要核查请求结束记录。';
  if(code==='source_busy')return '已有采集占用，尚未确认完成。';
  if(code==='collection_in_progress')return '完整分页仍在核对，部分数据不会用于资金矩阵；稍后继续采集。';
  if(code==='source_cooldown')return '来源限速等待中。';
  if(code==='unsupported_content_encoding')return '来源返回不支持的内容编码，传输校验未通过。';
  if(code==='source_access_denied'||code==='persistent_source_denial'||code==='source_denied'||code==='source_denial_latched')return '来源限制访问，已停止采集，不会绕过限制。';
  if(code==='runtime_routing_unverified')return '当前运行环境的来源连接未通过校验。';
  if(code==='aborted'||code==='deadline')return '数据请求中断或超时，尚未取得完整快照。';
  return '来源连接或数据校验失败，尚无完整有效快照。';
}
const stateKey=Symbol.for('FinanceFlowAtlas.ashare.controlled.v1');
const globals=globalThis as typeof globalThis & {[stateKey]?:State};
function processState():State{return globals[stateKey]??=(freshState());}
function freshState():State{return {entries:new Map(),tail:Promise.resolve(),lastRequest:-Infinity,backoffUntil:0,backoffFailures:0,denied:false};}
function abortCheck(signal:AbortSignal){if(signal.aborted)throw new Error(signal.reason instanceof Error&&signal.reason.message==='deadline'?'deadline':'aborted');}
function sleep(ms:number,signal:AbortSignal):Promise<void>{return new Promise((resolve,reject)=>{abortCheck(signal);const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',cancel);};const cancel=()=>{done();reject(new Error('aborted'));};const timer=setTimeout(()=>{done();resolve();},ms);signal.addEventListener('abort',cancel,{once:true});});}
// Page by immutable provider code, not live flow rank: f62 can move a row
// across page boundaries mid-acquisition. The UI sorts the collected f62 values
// independently. Stable code order does not make separate pages atomic.
function params(scope:Scope,page:number):URLSearchParams{return new URLSearchParams({pn:String(page),pz:'100',po:'1',np:'1',fltt:'2',invt:'2',fid:'f12',fs:scope.fs,fields:FIELDS.join(',')});}
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
  // Workers native fetch decodes gzip/Brotli as the body is read. The source
  // header may remain; rejecting it discards otherwise valid decoded JSON.
  // Accept only a single supported coding, never decode the stream twice, and
  // enforce MAX_BYTES against the decoded stream below (not Content-Length).
  const encoding=response.headers.get('content-encoding')?.trim().toLowerCase();
  if(encoding&&!['identity','gzip','br'].includes(encoding)){await boundedDisposal(()=>response.body?.cancel());throw new Error('unsupported_content_encoding');}
  const length=response.headers.get('content-length');
  if(length!==null&&(!/^[0-9]{1,12}$/.test(length)||Number(length)>budget)){await boundedDisposal(()=>response.body?.cancel());throw new Error('byte_budget');}
  const reader=response.body?.getReader();if(!reader)return new Uint8Array();
  const chunks:Uint8Array[]=[];let size=0;
  const cancel=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
  try{while(true){abortCheck(signal);const part=await reader.read();abortCheck(signal);if(part.done)break;if(part.value.byteLength>budget-size)throw new Error('byte_budget');size+=part.value.byteLength;chunks.push(part.value);}}
  finally{signal.removeEventListener('abort',cancel);await boundedDisposal(()=>reader.cancel());reader.releaseLock();}
  const result=new Uint8Array(size);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result;
}
/** Server-only: no background worker; no network until an enabled snapshot GET. */
export function createAshareHandler(options:{enabled?:()=>boolean;fetcher?:Fetcher;now?:()=>number;isolatedForTests?:boolean;runtime?:'cloudflare-workers';sourceGate?:SourceGate;snapshotStore?:SnapshotStore;stageStore?:StageStore;waitUntil?:(promise:Promise<unknown>)=>void}={}){
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
  async function collect(scope:Scope,requestSignal:AbortSignal,deadline:number,stage?:Stage,acquiredAtMs?:number,acquiredClock=now(),onSourceStart:()=>void=()=>{}):Promise<{snapshot:Snapshot}|{stage:Stage}>{
    const controller=new AbortController();const abort=()=>controller.abort(requestSignal.reason);
    requestSignal.addEventListener('abort',abort,{once:true});if(requestSignal.aborted)abort();
    const signal=controller.signal;
    let bytes=stage?.bytes??0,redirects=stage?.redirect_count??0,total:number|undefined=stage?.source_total,endpoint=stage?.endpoint==='official_redirect'?DELAY:ORIGIN;
    const rows:Row[]=stage?[...stage.rows]:[],ids=new Set(rows.map(row=>row.f12));
    // DB-origin start plus monotonic elapsed avoids mixing Worker and D1 wall clocks.
    const clock=()=>acquiredAtMs===undefined?Date.now():acquiredAtMs+Math.max(0,now()-acquiredClock);
    const timestamp=()=>new Date(clock()).toISOString();
    const startedAt=stage?.started_at??new Date(acquiredAtMs??Date.now()).toISOString(),firstPage=(stage?.page_count??0)+1;
    const staged=!!options.stageStore;
    try {
      for(let page=firstPage;page<=MAX_PAGES;page++){
        if(staged&&clock()-Date.parse(startedAt)>=STAGE_MAX_AGE_MS)throw new Error('acquisition_expired');
        const query=params(scope,page);let url=`${endpoint}${PATH}?${query}`;let response:Response;let raw:Uint8Array;
        while(true){
          abortCheck(signal);if(state.denied)throw new SourceDenied('source_denial_latched');if(!enabled())throw new Error('disabled');if(!routingAllowed())throw new Error('runtime_routing_unverified');
          const wait=INTERVAL-(now()-state.lastRequest);if(wait>0)await sleep(wait,signal);
          abortCheck(signal);if(!enabled())throw new Error('disabled');if(now()>=deadline)throw new Error('deadline');
          state.lastRequest=now();
          console.info('[ashare lifecycle]',JSON.stringify({event:'source_request',scope:scope.kind,page,redirects,route:endpoint===ORIGIN?'primary':'official_redirect'}));
          onSourceStart();response=await fetcher(url,{method:'GET',redirect:'manual',credentials:'omit',cache:'no-store',headers:{Accept:'application/json'},signal});
          console.info('[ashare lifecycle]',JSON.stringify({event:'source_response',scope:scope.kind,page,status:response.status}));
          const isRedirect=[301,302,303,307,308].includes(response.status);
          let nextUrl:string|undefined;
          if(isRedirect){
            // A normal official redirect may have an HTML body. Validate its
            // exact target first; an off-policy/login redirect is a denial.
            try{if(redirects>=1)throw new Error('redirect_budget');nextUrl=redirect(url,response.headers.get('location')??'',query);}
            catch{throw new SourceDenied('redirect_denied',response);}
          }
          const responseType=response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
          if(!isRedirect&&(responseType==='text/html'||responseType==='application/xhtml+xml')){throw new SourceDenied('html_challenge',response);}
          // Once observed, a denial remains a denial even if abort/cancel also fails.
          if([401,403,407,429,451].includes(response.status)){throw new SourceDenied('source_access_denied',response);}
          if(response.status===200&&response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json'){throw new SourceDenied('non_json_challenge',response);}
          if(response.redirected)throw new SourceDenied('automatic_redirect_denied',response);
          abortCheck(signal);if(now()>=deadline)throw new Error('deadline');
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
        for(const item of items){const value=validateRow(item,scope);if(ids.has(value.f12))throw new Error('duplicate_id');
          if(staged&&rows.length&&rows[rows.length-1].f12<=value.f12)throw new Error('unstable_order');
          ids.add(value.f12);rows.push(value);}
        abortCheck(signal);if(!enabled())throw new Error('disabled');
        if(staged&&clock()-Date.parse(startedAt)>=STAGE_MAX_AGE_MS)throw new Error('acquisition_expired');
        if(rows.length===total)return {snapshot:{rows,source_total:total,scope,page_count:page,fetched_at:staged?timestamp():new Date().toISOString(),...(staged?{collection_started_at:startedAt}:{})}};
        // Yield only after validating a whole page. Durable partial rows never
        // enter a public snapshot or its denominator. The next normal request
        // must acquire the same gate again, respecting its shared pacing.
        if(staged&&(page-firstPage+1>=3||now()>=deadline-6000))return {stage:{rows,source_total:total,scope,page_count:page,started_at:startedAt,updated_at:timestamp(),endpoint:endpoint===DELAY?'official_redirect':'primary',redirect_count:redirects as 0|1,bytes}};
      }
      throw new Error('incomplete_snapshot');
    }finally{requestSignal.removeEventListener('abort',abort);controller.abort();}
  }
  async function refresh(entry:Entry,scope:Scope,signal:AbortSignal,lifetimeReady:()=>boolean,deadline:number){
    // Serialize entire acquisitions globally, so pages and redirects share pacing.
    const run=state.tail.catch(()=>{}).then(async()=>{
      if(state.denied||now()<state.backoffUntil){entry.error=true;entry.errorCode=state.errorCode??'source_cooldown';entry.retryAt=state.denied?Infinity:state.backoffUntil;return;}
      let sourceStarted=false;
      try{
        // Gate covers the whole acquisition, not just each page or individual isolate.
        // No lease takeover/expiry is permitted: unknown crashed work stays busy.
        if(!lifetimeReady())throw new Error('runtime_lifetime_unverified');
        if(!sourceGate)throw new Error('source_gate_required');
        if(!options.snapshotStore&&!options.isolatedForTests)throw new Error('snapshot_store_required');
        if(!enabled())throw new Error('disabled');
        if(!routingAllowed())throw new Error('runtime_routing_unverified');
        abortCheck(signal);if(now()>=deadline)throw new Error('deadline');
        const reuseFresh=async()=>{
          if(!options.snapshotStore)return false;
          const current=await readShared(scope);hydrate(entry,current);
          if(current?.snapshot&&(current.ageMs??Infinity)<TTL)return true;
          if(current?.canAcquire===false)throw new Error(current.code??'snapshot_store_unavailable');
          return false;
        };
        // A queued/cold request may be overtaken by another isolate's commit.
        // Reuse that complete snapshot rather than acquire and fetch it again.
        if(await reuseFresh())return;
        const acquire=async()=>{
          abortCheck(signal);if(now()>=deadline)throw new Error('deadline');
          if(!enabled())throw new Error('disabled');
          try{return await sourceGate.acquire(scope.fs,signal);}
          catch(error){if(error&&typeof error==='object'&&'code'in error&&error.code==='source_denied')throw new SourceDenied('persistent_source_denial');throw error;}
        };
        let lease:SourceLease;
        try{lease=await acquire();}
        catch(error){
          if(!error||typeof error!=='object'||!('code'in error)||error.code!=='source_cooldown')throw error;
          // One bounded admission wait, NOT an upstream request retry. Busy,
          // denied and unavailable are never retried or taken over here.
          await sleep(3100,signal);
          if(await reuseFresh())return;
          lease=await acquire();
        }
        if(!lease||typeof lease.token!=='string'||!lease.token)throw new SourceDenied('invalid_source_lease');
        const acquiredClock=now();
        console.info('[ashare lifecycle]',JSON.stringify({event:'lease_acquired',scope:scope.kind}));
        let next:Snapshot|undefined,partial:Stage|undefined,collectionError:unknown;
        let outcome:SourceOutcome={kind:'success'};
        try{abortCheck(signal);if(now()>=deadline)throw new Error('deadline');
          const previous=await options.stageStore?.read(lease.token,scope);
          const collected=await collect(scope,signal,deadline,previous,lease.acquiredAtMs,acquiredClock,()=>{sourceStarted=true;});
          if('snapshot'in collected)next=collected.snapshot;else partial=collected.stage;}
        catch(error){
          // An uncertain mutation inside stage-read expiry cleanup is already an
          // unsettled write. Never retry cleanup or guess a lease release.
          if(error&&typeof error==='object'&&'code'in error&&error.code==='source_gate_release_unconfirmed')throw new SourceDenied('source_gate_release_unconfirmed');
          // Never let a deadline erase an actually observed denial.
          collectionError=!(error instanceof SourceDenied)&&signal.aborted&&signal.reason instanceof Error&&signal.reason.message==='deadline'?new Error('deadline'):error;
          outcome=error instanceof SourceDenied?{kind:'denied',reason:'source_denial'}:{kind:sourceStarted?'temporary_failure':'cancelled',reason:failureCode(collectionError)};
        }
        if((next||partial)&&!collectionError){
          // Check before issuing the atomic commit, not after it. An issued
          // commit must settle; a timeout is not permission for a second release.
          try{abortCheck(signal);if(now()>=deadline)throw new Error('deadline');}
          catch(error){next=undefined;partial=undefined;collectionError=error;outcome={kind:'temporary_failure',reason:failureCode(error)};}
        }
        // Release exactly once, including cancellation, and never silently ignore a
        // failed/uncertain write. No publication until persistence confirms release.
        try{
          if(next&&!collectionError&&options.snapshotStore)await options.snapshotStore.commit(lease.token,next);
          else if(partial&&!collectionError&&options.stageStore)await options.stageStore.save(lease.token,partial);
          else {
            // Only this invocation's owned stage may be discarded. An uncertain
            // stage mutation is not followed by a guessed gate release.
            if(options.stageStore&&outcome.kind!=='denied')await options.stageStore.discard(lease.token,scope);
            await sourceGate.release(lease.token,outcome);
          }
          console.info('[ashare lifecycle]',JSON.stringify({event:'lease_released',scope:scope.kind,outcome:outcome.kind}));}
        catch(error){
          if(error instanceof StageSaveNotStarted){
            // Deterministic preflight rejection is known not to have issued the
            // save batch. Clean up this owner's scope once and release normally.
            try{await options.stageStore!.discard(lease.token,scope);await sourceGate.release(lease.token,{kind:'temporary_failure',reason:'collection_failed'});}
            catch{throw new SourceDenied('source_gate_release_unconfirmed');}
            throw new Error('stage_invalid');
          }
          throw new SourceDenied('source_gate_release_unconfirmed');
        }
        finally{if(collectionError instanceof SourceDenied)await discardDeniedResponse(collectionError.response);}
        if(collectionError)throw collectionError;
        if(partial){entry.localIssue=undefined;entry.error=false;entry.errorCode='collection_in_progress';entry.retryAt=now()+3000;return;}
        if(!next)throw new Error('missing_snapshot');
        entry.localIssue=undefined;entry.snapshot=next;entry.published=now();entry.error=false;entry.errorCode=undefined;entry.failures=0;entry.retryAt=0;state.backoffFailures=0;state.errorCode=undefined;
      }
      catch(error){entry.errorCode=failureCode(error);if(!sourceStarted&&!['source_cooldown','source_busy'].includes(entry.errorCode))entry.localIssue=entry.errorCode;state.errorCode=entry.errorCode;console.warn('[ashare acquisition]',JSON.stringify({scope:scope.kind,code:entry.errorCode}));if(error instanceof SourceDenied||entry.errorCode==='source_outcome_unconfirmed'){state.denied=true;state.backoffUntil=Infinity;}entry.error=true;entry.failures++;state.backoffFailures++;entry.retryAt=state.denied?Infinity:now()+Math.min(900_000,60_000*2**Math.min(state.backoffFailures-1,4));state.backoffUntil=entry.retryAt;}
    });state.tail=run;await run;
  }
  function retainedRefresh(entry:Entry,scope:Scope,requestSignal:AbortSignal,deadline:number):Promise<void> {
    // Register the complete acquisition/release promise before any asynchronous
    // admission. Workers may otherwise terminate it immediately on disconnect.
    // Do not depend on end-to-end disconnect propagation through the host. One
    // absolute deadline includes reads/admission/queue/redirects/all pages; the
    // retained lifetime is for this operation's cleanup, not background refresh.
    const controller=new AbortController();
    const abort=()=>controller.abort(requestSignal.reason);
    requestSignal.addEventListener('abort',abort,{once:true});
    if(requestSignal.aborted)abort();
    const expire=()=>{console.info('[ashare lifecycle]',JSON.stringify({event:'acquisition_deadline',scope:scope.kind,budget_ms:ACQUISITION_BUDGET_MS}));controller.abort(new Error('deadline'));};
    const remaining=deadline-now();
    if(remaining<=0)expire();
    const timer=remaining>0?setTimeout(expire,remaining):undefined;
    let retained=options.isolatedForTests===true&&!options.waitUntil;
    const work=refresh(entry,scope,controller.signal,()=>retained,deadline).finally(()=>{
      if(timer!==undefined)clearTimeout(timer);
      requestSignal.removeEventListener('abort',abort);controller.abort();
    });
    try{if(options.waitUntil){options.waitUntil(work);retained=true;}}
    catch{controller.abort();}
    return work;
  }
  type Diagnostic={code:string;stopped:boolean;retrySeconds:number};
  function diagnostic(entry?:Entry):Diagnostic|undefined {
    const code=state.denied ? state.errorCode??'source_denial_latched' : entry?.errorCode??(now()<state.backoffUntil?state.errorCode??'source_cooldown':undefined);
    if(!code)return;
    return {code:safeSourceCode(code)??'collection_failed',stopped:state.denied,
      retrySeconds:state.denied?0:Math.max(1,Math.ceil((Math.max(entry?.retryAt??0,state.backoffUntil)-now())/1000))};
  }
  function reply(status:number,payload?:unknown,etag?:string,issue?:Diagnostic,refreshSeconds?:number){
    const headers:Record<string,string>={'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
    if(etag)headers.ETag=etag;
    if(refreshSeconds!==undefined)headers['X-Ashare-Refresh-After']=String(refreshSeconds);
    // These headers accompany stale 200 and 304 too. They do not alter snapshot
    // bytes/ETags and never expose upstream bodies, URLs, credentials or leases.
    if(issue){headers['X-Ashare-Error-Code']=issue.code;headers['X-Ashare-Recovery']=issue.stopped?'stopped':'retry';
      if(!issue.stopped)headers['Retry-After']=String(issue.retrySeconds);
    }else if(status===503)headers['Retry-After']='60';
    return new Response(payload===undefined?null:JSON.stringify(payload),{status,headers});
  }
  async function readShared(scope:Scope):Promise<SnapshotRead|undefined> {
    if(!options.snapshotStore)return;
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{return await Promise.race([options.snapshotStore.read(scope),new Promise<SnapshotRead>(resolve=>{
      timer=setTimeout(()=>resolve({code:'snapshot_store_unavailable',canAcquire:false}),2000);
    })]);}catch{return {code:'snapshot_store_unavailable',canAcquire:false};}
    finally{if(timer!==undefined)clearTimeout(timer);}
  }
  function hydrate(entry:Entry,shared:SnapshotRead|undefined) {
    if(!shared)return;
    if(shared.committedMs!==undefined&&(entry.committedMs===undefined||shared.committedMs>entry.committedMs)){
      if(entry.committedMs!==undefined)entry.localIssue=undefined;
      entry.committedMs=shared.committedMs;
    }
    if(shared.durableBackoff&&!state.denied){
      state.backoffUntil=0;state.backoffFailures=0;state.errorCode=undefined;
      entry.retryAt=shared.canAcquire?0:now()+(shared.retryAfterMs??0);
      entry.error=!!(shared.failureCode??entry.localIssue);entry.errorCode=shared.failureCode??entry.localIssue;
    }
    if(shared.snapshot?.fetched_at!==entry.snapshot?.fetched_at){entry.error=false;entry.errorCode=undefined;}
    entry.snapshot=shared.snapshot;
    entry.published=now()-(shared.ageMs??0);
    if(shared.code==='source_denied'||shared.code==='source_outcome_unconfirmed'){
      state.denied=true;state.errorCode=shared.code;state.backoffUntil=Infinity;
    }
  }
  function sharedDiagnostic(shared:SnapshotRead|undefined,entry?:Entry):Diagnostic|undefined {
    const local=diagnostic(entry);
    if(shared?.durableBackoff&&!local?.stopped){
      const code=shared.failureCode??entry?.localIssue??shared.code;
      if(code)return {code,stopped:code==='source_denied'||code==='source_outcome_unconfirmed',retrySeconds:Math.max(1,Math.ceil((shared.retryAfterMs??60000)/1000))};
    }
    if(local?.stopped||!shared?.code||(shared.code==='source_cooldown'&&local))return local;
    return {code:shared.code,stopped:shared.code==='source_denied'||shared.code==='source_outcome_unconfirmed',retrySeconds:60};
  }
  return async function handle(request:Request):Promise<Response>{
    const deadline=now()+ACQUISITION_BUDGET_MS;
    if(request.method!=='GET')return reply(405,{error:'method_not_allowed'});
    const url=new URL(request.url);if(!['/api/v1/ashare/snapshot','/api/v1/ashare/status'].includes(url.pathname))return reply(404,{error:'not_found'});
    let scope:Scope;try{scope=parseScope(url);}catch{return reply(400,{error:'invalid_scope'});}
    if(!enabled())return reply(403,{state:'display_not_authorized',message:'来源展示权限未建立；不会返回缓存行情。'});
    let shared=await readShared(scope);
    const key=scope.fs;const entry:Entry=state.entries.get(key)??{published:0,error:false,failures:0,retryAt:0};
    hydrate(entry,shared);
    if(url.pathname.endsWith('/status')){
      let issue=sharedDiagnostic(shared,entry);
      if(!options.snapshotStore&&sourceGate?.inspect){
        let timer:ReturnType<typeof setTimeout>|undefined;
        try{
          const shared=await Promise.race([sourceGate.inspect(),new Promise<SourceGateCode>(resolve=>{timer=setTimeout(()=>resolve('source_gate_unavailable'),2000);})]);
          if(shared){const code=safeSourceCode(shared)??'source_gate_unavailable';const next={code,stopped:code==='source_denied'||code==='source_outcome_unconfirmed',retrySeconds:60};if(!issue?.stopped||next.stopped)issue=next;}
        }catch{if(!issue?.stopped)issue={code:'source_gate_unavailable',stopped:false,retrySeconds:60};}
        finally{if(timer!==undefined)clearTimeout(timer);}
      }
      return reply(200,{state:!state.denied&&entry?.snapshot?'ready':'unavailable',refreshing:!!entry?.pending,stale:!!entry?.snapshot&&(!!issue||entry.error||now()-entry.published>=TTL),has_error:!!issue&&issue.code!=='collection_in_progress',refresh_interval_seconds:60,acquisition_is_separate:false,collection_trigger:'snapshot_request',background_collection:false,...(issue?{error_code:issue.code,message:failureMessage(issue.code)}:{})},undefined,issue);
    }
    if(!state.entries.has(key)){
      // One level-1 plus one selected industry cache. Never evict in-flight work.
      if(scope.kind==='industry_stocks'){for(const [k,v]of state.entries){if(k.startsWith('b:')){if(v.pending)return reply(503,{state:'unavailable',error_code:'source_busy',message:'行业采集进行中，请稍后重试。'},undefined,{code:'source_busy',stopped:false,retrySeconds:60});state.entries.delete(k);}}}
      state.entries.set(key,entry);
    }
    const stale=()=>!!entry!.snapshot&&(state.denied||entry!.error||now()-entry!.published>=TTL);
    if(!state.denied&&shared?.canAcquire!==false&&(!entry.snapshot||now()-entry.published>=TTL)&&now()>=entry.retryAt&&now()>=state.backoffUntil&&!entry.pending){const target=entry;target.pending=retainedRefresh(target,scope,request.signal,deadline).finally(()=>{target.pending=undefined;});}
    if(entry.pending)await entry.pending;
    if(!enabled())return reply(403,{state:'display_not_authorized',message:'来源展示权限未建立；不会返回缓存行情。'});
    shared=await readShared(scope);hydrate(entry,shared);
    const issue=sharedDiagnostic(shared,entry);
    if(state.denied||!entry.snapshot)return reply(503,{state:'unavailable',error_code:issue?.code??'not_yet_acquired',message:failureMessage(issue?.code)},undefined,issue);
    // f124 is treated as a quote/update timestamp by third-party adapters, but
    // its relationship to this f62 observation has not been verified. Neither
    // it, an HTTP Date header, nor fetched_at can establish flow freshness.
    // See docs/ASHARE-SOURCE-TIME-AUDIT.md before changing these null fields.
    const payload={schema:'ashare-provider-evidence/1',...entry.snapshot,source_observed_at:null,trade_date:null,metric_kind:'provider_order_flow_proxy',metric_field:'f62',unit:'CNY',field_units:{f62:'CNY',f3:'percent',f2:scope.kind==='industry_rank'?'index_points':'CNY'},delay_status:'not_provided',classification_exclusivity:'not_established',notice:'供应商订单分类净额代理，非市场真实新增资金；抓取时间不是行情时间。',stale:stale()||!!issue,has_error:!!issue&&issue.code!=='collection_in_progress'};
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(payload)));
    const etag='"'+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')+'"';
    // The ETag digest yields. Recheck shared permission as the final async step
    // so a denial observed while hashing cannot return warm evidence or a 304.
    if(options.snapshotStore&&sourceGate?.inspect){
      let code:SourceGateCode|null,timer:ReturnType<typeof setTimeout>|undefined;
      try{code=await Promise.race([sourceGate.inspect(),new Promise<SourceGateCode>(resolve=>{
        timer=setTimeout(()=>resolve('source_gate_unavailable'),2000);
      })]);}catch{code='source_gate_unavailable';}finally{if(timer!==undefined)clearTimeout(timer);}
      if(code&&code!=='source_cooldown'){
        const stopped=code==='source_denied'||code==='source_outcome_unconfirmed';
        if(stopped){state.denied=true;state.errorCode=code;state.backoffUntil=Infinity;}
        return reply(503,{state:'unavailable',error_code:code,message:failureMessage(code)},undefined,{code,stopped,retrySeconds:60});
      }
    }
    if(!enabled())return reply(403,{state:'display_not_authorized',message:'来源展示权限未建立；不会返回缓存行情。'});
    if(state.denied){const stopped=diagnostic(entry)!;return reply(503,{state:'unavailable',error_code:stopped.code,message:failureMessage(stopped.code)},undefined,stopped);}
    // Relative to the authoritative oldest-page age, not the browser wall clock.
    // A mount-time 60s poll can land just before expiry and otherwise reuse the
    // same bytes for another full minute. This is scheduling, never source age
    // evidence or permission to bypass the shared gate. Diagnostics take priority.
    const refreshSeconds=issue?undefined:Math.max(1,Math.min(60,Math.ceil((TTL-(now()-entry.published))/1000)));
    if(request.headers.get('if-none-match')===etag)return reply(304,undefined,etag,issue,refreshSeconds);
    return reply(200,payload,etag,issue,refreshSeconds);
  };
}
