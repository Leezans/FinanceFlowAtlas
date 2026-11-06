import {strictJSON} from '../../ashare/strict-json';
import {TAIFEX_URL,TaifexError,parseTaifex} from './adapter';
import {REFRESH_MS,MAX_CACHE_AGE_MS,MAX_BYTES,MAX_REPORT_AGE_DAYS,STALE_REPORT_DAYS,reportAge,type TaifexSnapshot,type TaifexReply} from './model';
const DEADLINE_MS=15_000;
export type TaifexOutcome={kind:'success'|'temporary_failure'|'denied';retryAfterMs?:number;snapshot?:TaifexSnapshot};
export type TaifexGateState={state:'idle'|'busy'|'blocked';retryAt:number;snapshot:TaifexSnapshot|null};
export interface TaifexGate {inspect():Promise<TaifexGateState>;acquire(signal?:AbortSignal):Promise<{token:string}>;release(token:string,outcome:TaifexOutcome):Promise<void>}
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
function retryAfter(value:string|null,now:number){if(value===null)return 0;if(/^\d+$/.test(value))return Math.min(Number.MAX_SAFE_INTEGER,Number(value)*1000);const date=Date.parse(value);return Number.isFinite(date)?Math.max(0,date-now):0;}
export function createTaifexHandler(options:{gate:TaifexGate;fetcher?:typeof fetch;now?:()=>number;waitUntil?:(promise:Promise<unknown>)=>void;isolatedForTests?:boolean}){
 const now=options.now??Date.now,fetcher=options.fetcher??fetch;
 let snapshot:TaifexSnapshot|null=null,pending:Promise<void>|undefined,error:string|null=null,denied=false,lastAttempt:number|null=null,retryAt=0,failures=0;
 async function refresh(requestSignal:AbortSignal,lifetimeReady:()=>boolean,track:<T>(operation:Promise<T>)=>Promise<T>){
  const controller=new AbortController(),deadline=new AbortController();
  const abort=()=>controller.abort();requestSignal.addEventListener('abort',abort,{once:true});if(requestSignal.aborted)abort();
  const timer=setTimeout(()=>{deadline.abort();controller.abort();},DEADLINE_MS);let token:string|undefined,releasing=false;
  const started=now();lastAttempt=started;
  try{
   if(!lifetimeReady())fail('runtime_lifetime_unverified');
   if(controller.signal.aborted)fail('source_aborted');
   // A request abort cancels collection, but cannot abandon a pending D1 write.
   // The retained lifetime also waits for late admission/release settlement.
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
   const candidate=parseTaifex(await fetchRows(TAIFEX_URL),new Date(started).toISOString(),new Date(now()).toISOString());
   if(reportAge(candidate,now())>MAX_REPORT_AGE_DAYS)fail('source_report_too_old');
   if(snapshot&&candidate.report_date<snapshot.report_date)fail('report_date_regressed');
   releasing=true;await settleGate(track(options.gate.release(token,{kind:'success',snapshot:candidate})),deadline.signal);token=undefined;
   snapshot=candidate;error=null;failures=0;retryAt=now()+REFRESH_MS;
  }catch(caught){
   const code=caught instanceof TaifexError?caught.code:typeof (caught as {code?:unknown})?.code==='string'&&gateErrors.has((caught as {code:string}).code)?(caught as {code:string}).code:requestSignal.aborted?'source_aborted':controller.signal.aborted?'timeout':!token&&!releasing?'source_gate_unavailable':'source_unavailable';
   denied=denied||(caught instanceof TaifexError&&caught.denied)||code==='source_denied';error=code;
   const coordinating=code==='source_busy'||code==='source_cooldown';
   if(!coordinating)failures++;
   const pause=coordinating?60_000:Math.max(Math.min(REFRESH_MS*2**Math.min(failures-1,4),MAX_CACHE_AGE_MS),caught instanceof TaifexError?caught.retryAfterMs:0);
   retryAt=now()+pause;
   if(token&&!releasing){
    try{await settleGate(track(options.gate.release(token,{kind:denied?'denied':'temporary_failure',retryAfterMs:pause})),AbortSignal.timeout(2_000));}
    catch{denied=true;error='source_gate_outcome_unconfirmed';}
   }else if(releasing){denied=true;error='source_gate_outcome_unconfirmed';}
   if(denied)snapshot=null;
  }finally{clearTimeout(timer);requestSignal.removeEventListener('abort',abort);controller.abort();}
 }
 function retainedRefresh(requestSignal:AbortSignal):Promise<void>{
  const operations:Promise<unknown>[]=[];
  const track=<T,>(operation:Promise<T>):Promise<T>=>{operations.push(operation);return operation;};
  let retained=options.isolatedForTests===true&&!options.waitUntil;
  // Defer admission until waitUntil synchronously accepts the complete lifetime.
  const work=Promise.resolve().then(()=>refresh(requestSignal,()=>retained,track));
  // A response deadline may win a DB race, but its owned operation is still
  // retained through settlement (including acquire's late-abort release).
  const lifetime=work.then(()=>Promise.allSettled(operations)).then(()=>{});
  try{if(options.waitUntil){options.waitUntil(lifetime);retained=true;}}
  catch{retained=false;}
  return work;
 }
 function reply():TaifexReply{
  const at=now(),age=snapshot?at-Date.parse(snapshot.fetched_at):null;
  const days=snapshot?reportAge(snapshot,at):null;
  const gateUnconfirmed=error!==null&&['source_busy','source_gate_unavailable','source_stale_lease','source_cooldown','source_gate_outcome_unconfirmed','runtime_lifetime_unverified'].includes(error);
  const valid=!gateUnconfirmed&&age!==null&&age>=-5_000&&age<=MAX_CACHE_AGE_MS&&days!==null&&days>=0&&days<=MAX_REPORT_AGE_DAYS;
  return {snapshot:!denied&&valid?snapshot:null,status:{state:denied?'denied':!valid?'unavailable':error||age!>REFRESH_MS||days!>STALE_REPORT_DAYS?'stale':'available',error_code:error,last_attempt_at:lastAttempt===null?null:new Date(lastAttempt).toISOString(),fetched_at:snapshot?.fetched_at??null,cache_age_ms:age,refresh_ms:REFRESH_MS,max_cache_age_ms:MAX_CACHE_AGE_MS,next_retry_at:denied||retryAt===0||retryAt>8.64e15?null:new Date(retryAt).toISOString()}};
 }
 return async(request:Request):Promise<Response>=>{
  const url=new URL(request.url),mode=url.pathname.split('/').at(-1);
  if(request.method!=='GET')return Response.json({error:'method_not_allowed'},{status:405,headers:{Allow:'GET'}});
  if(!['snapshot','status'].includes(mode??'')||url.search)return Response.json({error:'invalid_request'},{status:400});
  let busy=false;
  try{
   const shared=await settleGate(options.gate.inspect(),AbortSignal.timeout(2_000));
   if(shared.state==='blocked'){denied=true;snapshot=null;error='source_denied';}
   else if(!denied){
    busy=shared.state==='busy';if(busy)error='source_busy';else if(error==='source_busy')error=null;retryAt=Math.max(retryAt,shared.retryAt);
    if(!busy&&shared.snapshot&&(!snapshot||Date.parse(shared.snapshot.fetched_at)>Date.parse(snapshot.fetched_at))){snapshot=shared.snapshot;error=null;}
    if(!snapshot&&(busy||now()<retryAt))error=busy?'source_busy':'source_cooldown';
   }
  }
  // A failed read suppresses this response, but must not poison the retained
  // acquisition state. A later confirmed read can restore the same valid cache.
  catch{const status={...reply().status,state:'unavailable',error_code:'source_gate_unavailable'};return Response.json(mode==='status'?status:{status,snapshot:null},{status:503,headers:{'Cache-Control':'no-store'}});}
  if(mode==='snapshot'&&!denied&&!busy&&now()>=retryAt){pending??=retainedRefresh(request.signal).finally(()=>{pending=undefined;});await pending;}
  const result=reply();return Response.json(mode==='status'?result.status:result,{status:mode==='status'||result.snapshot?200:503,headers:{'Cache-Control':'no-store','X-Data-Status':result.status.state}});
 };
}
