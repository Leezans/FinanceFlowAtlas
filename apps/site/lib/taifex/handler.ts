import {strictJSON} from '../ashare/strict-json';
import {TAIFEX_URL,TaifexError,parseTaifex} from '../options/taifex/adapter';
import {FUTURES_URL,FuturesError,parseFutures} from '../futures/taifex/adapter';
import {REFRESH_MS,MAX_CACHE_AGE_MS,MAX_BYTES,MAX_REPORT_AGE_DAYS,STALE_REPORT_DAYS,reportAge as optionsReportAge,type TaifexReply} from '../options/taifex/model';
import {reportAge as futuresReportAge,type FuturesReply} from '../futures/taifex/model';
import {optionsReport,futuresReport,serializeBundle,MAX_ACQUISITION_MS,type TaifexCache,type TaifexBundle} from './model';

const START_SPACING_MS=1_100;
export type TaifexOutcome={kind:'success'|'temporary_failure'|'denied';retryAfterMs?:number;snapshot?:TaifexBundle};
export type TaifexGateState={state:'idle'|'busy'|'blocked';retryAt:number;snapshot:TaifexCache|null};
export interface TaifexGate {inspect():Promise<TaifexGateState>;acquire(signal?:AbortSignal):Promise<{token:string}>;release(token:string,outcome:TaifexOutcome):Promise<void>}
export type TaifexProviderOptions={gate:TaifexGate;fetcher?:typeof fetch;now?:()=>number;waitUntil?:(promise:Promise<unknown>)=>void;isolatedForTests?:boolean};
type Report='options'|'futures';
function fail(code:string):never{throw new TaifexError(code);}
const gateErrors=new Set(['source_denied','source_busy','source_cooldown','source_gate_unavailable','source_stale_lease','source_aborted']);
async function readJSON(response:Response,signal:AbortSignal){
 if(!/^application\/(?:json|octet-stream)(?:\s*;|$)/i.test(response.headers.get('content-type')??''))throw new TaifexError('unexpected_content_type',true);
 const length=response.headers.get('content-length');if(length!==null&&(!/^\d{1,10}$/.test(length)||Number(length)>MAX_BYTES))fail('byte_budget');
 const reader=response.body?.getReader();if(!reader)fail('empty_response');
 const chunks:Uint8Array[]=[];let size=0;
 const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
 try{while(true){if(signal.aborted)fail('timeout');const part=await reader.read();if(signal.aborted)fail('timeout');if(part.done)break;size+=part.value.byteLength;if(size>MAX_BYTES)fail('byte_budget');chunks.push(part.value);}}
 finally{signal.removeEventListener('abort',abort);void reader.cancel().catch(()=>{});reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(/^\s*</.test(text))throw new TaifexError('html_challenge',true);
 return strictJSON(text);
}
function settleGate<T>(operation:Promise<T>,signal:AbortSignal):Promise<T>{
 let cancel=()=>{};
 const deadline=new Promise<never>((_resolve,reject)=>{cancel=()=>reject(new TaifexError('source_gate_outcome_unconfirmed',true));signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();});
 // A late/uncertain DB result is never taken over or retried.
 return Promise.race([operation,deadline]).finally(()=>signal.removeEventListener('abort',cancel));
}
function spaceRequests(signal:AbortSignal):Promise<void>{
 return new Promise((resolve,reject)=>{
  // Waiting after the first response is conservative even when the system wall
  // clock changes: the second GET starts at least 1.1 seconds after the first.
  const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(new Error('aborted'));};
  const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},START_SPACING_MS);
  signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
 });
}
function retryAfter(value:string|null,now:number){if(value===null)return 0;if(/^\d+$/.test(value))return Math.min(Number.MAX_SAFE_INTEGER,Number(value)*1000);const date=Date.parse(value);return Number.isFinite(date)?Math.max(0,date-now):0;}

/** Both fixed report projections share every acquisition and provider state. */
export function createTaifexProvider(options:TaifexProviderOptions){
 const now=options.now??Date.now,fetcher=options.fetcher??fetch;
 let cache:TaifexCache|null=null,pending:Promise<void>|undefined,error:string|null=null,denied=false,lastAttempt:number|null=null,retryAt=0,failures=0;
 async function refresh(requestSignal:AbortSignal,lifetimeReady:()=>boolean,track:<T>(operation:Promise<T>)=>Promise<T>){
  const controller=new AbortController(),deadline=new AbortController();
  const abort=()=>controller.abort();requestSignal.addEventListener('abort',abort,{once:true});if(requestSignal.aborted)abort();
  const timer=setTimeout(()=>{deadline.abort();controller.abort();},MAX_ACQUISITION_MS);let token:string|undefined,releasing=false;
  const started=now();lastAttempt=started;
  try{
   if(!lifetimeReady())fail('runtime_lifetime_unverified');
   if(controller.signal.aborted)fail('source_aborted');
   // Request abort cancels collection, but never abandons a pending D1 write.
   const lease=await settleGate(track(options.gate.acquire(controller.signal)),deadline.signal);token=lease.token;
   if(!token)fail('source_gate_unavailable');if(controller.signal.aborted)fail(requestSignal.aborted?'source_aborted':'timeout');
   const fetchRows=async(url:string)=>{
    if(controller.signal.aborted)fail(requestSignal.aborted?'source_aborted':'timeout');
    const response=await fetcher(url,{method:'GET',headers:{Accept:'application/json'},credentials:'omit',redirect:'manual',cache:'no-store',signal:controller.signal});
    try{
     if([401,403,407,429,451].includes(response.status))throw new TaifexError('source_access_denied',true);
     if(response.redirected||response.status>=300&&response.status<400)throw new TaifexError('redirect_denied',true);
     if(/^(text\/html|application\/xhtml\+xml)(?:\s*;|$)/i.test(response.headers.get('content-type')??''))throw new TaifexError('html_challenge',true);
     if(response.status!==200)throw new TaifexError('upstream_http',false,retryAfter(response.headers.get('retry-after'),now()));
     return await readJSON(response,controller.signal);
    }finally{if(!response.body?.locked)void response.body?.cancel().catch(()=>{});}
   };
   const optionsStarted=new Date(now()).toISOString();
   const optionsSnapshot=parseTaifex(await fetchRows(TAIFEX_URL),optionsStarted,new Date(now()).toISOString());
   if(optionsReportAge(optionsSnapshot,now())>MAX_REPORT_AGE_DAYS)fail('source_report_too_old');
   const priorOptions=optionsReport(cache);
   if(priorOptions&&optionsSnapshot.report_date<priorOptions.report_date)fail('report_date_regressed');
   await spaceRequests(controller.signal);
   const futuresStarted=new Date(now()).toISOString();
   const futuresSnapshot=parseFutures(await fetchRows(FUTURES_URL),futuresStarted,new Date(now()).toISOString());
   if(futuresReportAge(futuresSnapshot,now())>MAX_REPORT_AGE_DAYS)fail('source_report_too_old');
   const priorFutures=futuresReport(cache);
   if(priorFutures&&futuresSnapshot.report_date<priorFutures.report_date)fail('report_date_regressed');
   const candidate:TaifexBundle={schema:'taifex-institutions/2',source:'TAIFEX',acquisition_started_at:new Date(started).toISOString(),fetched_at:new Date(now()).toISOString(),options:optionsSnapshot,futures:futuresSnapshot};
   // All local validation/serialization happens before the uncertain-write
   // phase. An invalid or oversized bundle must release as a temporary failure.
   serializeBundle(candidate);
   if(controller.signal.aborted)fail(requestSignal.aborted?'source_aborted':'timeout');
   releasing=true;await settleGate(track(options.gate.release(token,{kind:'success',snapshot:candidate})),deadline.signal);token=undefined;
   cache=candidate;error=null;failures=0;retryAt=now()+REFRESH_MS;
  }catch(caught){
   const sourceError=caught instanceof TaifexError||caught instanceof FuturesError?caught:null;
   const code=sourceError?sourceError.code:typeof (caught as {code?:unknown})?.code==='string'&&gateErrors.has((caught as {code:string}).code)?(caught as {code:string}).code:requestSignal.aborted?'source_aborted':controller.signal.aborted?'timeout':!token&&!releasing?'source_gate_unavailable':'source_unavailable';
   denied=denied||!!sourceError?.denied||code==='source_denied';error=code;
   const coordinating=code==='source_busy'||code==='source_cooldown';
   if(!coordinating)failures++;
   const pause=coordinating?60_000:Math.max(Math.min(REFRESH_MS*2**Math.min(failures-1,4),MAX_CACHE_AGE_MS),sourceError?.retryAfterMs??0);
   retryAt=now()+pause;
   if(token&&!releasing){
    try{await settleGate(track(options.gate.release(token,{kind:denied?'denied':'temporary_failure',retryAfterMs:pause})),AbortSignal.timeout(2_000));}
    catch{denied=true;error='source_gate_outcome_unconfirmed';}
   }else if(releasing){denied=true;error='source_gate_outcome_unconfirmed';}
   if(denied)cache=null;
  }finally{clearTimeout(timer);requestSignal.removeEventListener('abort',abort);controller.abort();}
 }
 function retainedRefresh(requestSignal:AbortSignal):Promise<void>{
  const operations:Promise<unknown>[]=[];
  const track=<T,>(operation:Promise<T>):Promise<T>=>{operations.push(operation);return operation;};
  let retained=options.isolatedForTests===true&&!options.waitUntil;
  const work=Promise.resolve().then(()=>refresh(requestSignal,()=>retained,track));
  const lifetime=work.then(()=>Promise.allSettled(operations)).then(()=>{});
  try{if(options.waitUntil){options.waitUntil(lifetime);retained=true;}}
  catch{retained=false;}
  return work;
 }
 function reply(report:Report):TaifexReply|FuturesReply{
  const snapshot=report==='options'?optionsReport(cache):futuresReport(cache);
  const at=now(),age=snapshot?at-Date.parse(snapshot.fetched_at):null;
  const option=optionsReport(cache),future=futuresReport(cache);
  const days=report==='options'?(option?optionsReportAge(option,at):null):(future?futuresReportAge(future,at):null);
  const gateUnconfirmed=error!==null&&['source_busy','source_gate_unavailable','source_stale_lease','source_cooldown','source_gate_outcome_unconfirmed','runtime_lifetime_unverified'].includes(error);
  const valid=!gateUnconfirmed&&age!==null&&age>=-5_000&&age<=MAX_CACHE_AGE_MS&&days!==null&&days>=0&&days<=MAX_REPORT_AGE_DAYS;
  return {snapshot:!denied&&valid?snapshot:null,status:{state:denied?'denied':!valid?'unavailable':error||age!>REFRESH_MS||days!>STALE_REPORT_DAYS?'stale':'available',error_code:error,last_attempt_at:lastAttempt===null?null:new Date(lastAttempt).toISOString(),fetched_at:snapshot?.fetched_at??null,cache_age_ms:age,refresh_ms:REFRESH_MS,max_cache_age_ms:MAX_CACHE_AGE_MS,next_retry_at:denied||retryAt===0||retryAt>8.64e15?null:new Date(retryAt).toISOString()}} as TaifexReply|FuturesReply;
 }
 function handler(report:Report){return async(request:Request):Promise<Response>=>{
  const url=new URL(request.url),mode=url.pathname.split('/').at(-1);
  if(request.method!=='GET')return Response.json({error:'method_not_allowed'},{status:405,headers:{Allow:'GET'}});
  if(!['snapshot','status'].includes(mode??'')||url.search)return Response.json({error:'invalid_request'},{status:400});
  let busy=false;
  try{
   const shared=await settleGate(options.gate.inspect(),AbortSignal.timeout(2_000));
   if(shared.state==='blocked'){denied=true;cache=null;error='source_denied';}
   else if(!denied){
    busy=shared.state==='busy'||pending!==undefined;if(busy)error='source_busy';else if(error==='source_busy')error=null;retryAt=Math.max(retryAt,shared.retryAt);
    if(!busy&&shared.snapshot&&(!cache||Date.parse(shared.snapshot.fetched_at)>Date.parse(cache.fetched_at))){cache=shared.snapshot;error=null;}
    if(!cache&&(busy||now()<retryAt))error=busy?'source_busy':'source_cooldown';
   }
  }
  // A failed read suppresses only this response, never the retained acquisition
  // error or confirmed cache. Later reads can restore that exact evidence.
  catch{const status={...reply(report).status,state:'unavailable',error_code:'source_gate_unavailable'};return Response.json(mode==='status'?status:{status,snapshot:null},{status:503,headers:{'Cache-Control':'no-store'}});}
  if(mode==='snapshot'&&!denied){
   if(pending)await pending;
   else if(!busy&&now()>=retryAt){pending=retainedRefresh(request.signal).finally(()=>{pending=undefined;});await pending;}
  }
  const result=reply(report);return Response.json(mode==='status'?result.status:result,{status:mode==='status'||result.snapshot?200:503,headers:{'Cache-Control':'no-store','X-Data-Status':result.status.state}});
 };}
 return {optionsHandler:handler('options'),futuresHandler:handler('futures')};
}
