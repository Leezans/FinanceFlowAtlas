import {ReportError,type ReportDefinition,type ReportOptions,type ReportSnapshot,type ReportReply} from './types';
import {readJSON,readCp932CSV,boundedFetch} from './json';
function fail(code:string):never{throw new ReportError(code);}
const gateErrors=new Set(['source_denied','source_busy','source_cooldown','source_gate_unavailable','source_stale_lease','source_aborted']);
function settleGate<T>(operation:Promise<T>,signal:AbortSignal):Promise<T>{
 let cancel=()=>{};
 const deadline=new Promise<never>((_resolve,reject)=>{cancel=()=>reject(new ReportError('source_gate_outcome_unconfirmed',true));signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();});
 // A late/uncertain DB result is never taken over or retried.
 return Promise.race([operation,deadline]).finally(()=>signal.removeEventListener('abort',cancel));
}
function retryAfter(value:string|null,now:number){if(value===null)return 0;if(/^\d+$/.test(value))return Math.min(Number.MAX_SAFE_INTEGER,Number(value)*1000);const date=Date.parse(value);return Number.isFinite(date)?Math.max(0,date-now):0;}
export function createReportHandler<T extends ReportSnapshot>(definition:ReportDefinition<T>,options:ReportOptions<T>){
 const {refreshMs:REFRESH_MS,maxCacheAgeMs:MAX_CACHE_AGE_MS,maxReportAgeDays:MAX_REPORT_AGE_DAYS,staleReportDays:STALE_REPORT_DAYS,reportAge}=definition;
 const DEADLINE_MS=definition.deadlineMs??25_000;
 const now=options.now??Date.now,fetcher=options.fetcher??fetch;
 let snapshot:T|null=null,pending:Promise<void>|undefined,error:string|null=null,denied=false,lastAttempt:number|null=null,retryAt=0,failures=0;
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
   // Admission may settle after the provider changes. Recheck before I/O; our
   // own busy summary lease is expected and is not a provider busy condition.
   const admitted=await settleGate(options.gate.inspect(),deadline.signal);
   if(admitted.state==='blocked')throw new ReportError('source_denied',true);
   if(admitted.providerUnavailable)throw new ReportError(admitted.providerError??'source_busy');
   if(controller.signal.aborted)fail(requestSignal.aborted?'source_aborted':'timeout');
   const response=await boundedFetch(fetcher,definition.url,{method:'GET',headers:{Accept:definition.responseFormat==='cp932_csv'?'text/csv':'application/json'},credentials:'omit',redirect:'manual',cache:'no-store',signal:controller.signal});
   let raw:unknown;
   try{
    if([401,403,407,429,451].includes(response.status))throw new ReportError('source_access_denied',true);
    if(response.redirected||response.status>=300&&response.status<400)throw new ReportError('redirect_denied',true);
    if(/^(text\/html|application\/xhtml\+xml)(?:\s*;|$)/i.test(response.headers.get('content-type')??''))throw new ReportError('html_challenge',true);
    if(response.status!==200)throw new ReportError('upstream_http',false,retryAfter(response.headers.get('retry-after'),now()));
    raw=await (definition.responseFormat==='cp932_csv'?readCp932CSV:readJSON)(response,controller.signal,definition.maxBytes??1_000_000);
   }finally{if(!response.body?.locked)void response.body?.cancel().catch(()=>{});}
   const candidate=definition.validate(definition.parse(raw,new Date(started).toISOString(),new Date(now()).toISOString()));
   const previousDate=snapshot?.report_date;
   if(previousDate&&candidate.report_date<previousDate)fail('report_date_regression');
   if(snapshot)definition.validateRevision?.(candidate,snapshot);
   releasing=true;const publication=await settleGate(track(options.gate.release(token,{kind:'success',snapshot:candidate})),deadline.signal);token=undefined;
   if(publication&&!publication.published){snapshot=null;error=publication.error_code??'source_gate_unavailable';denied=denied||error==='source_denied';retryAt=now()+REFRESH_MS;return;}
   snapshot=candidate;error=null;failures=0;retryAt=now()+REFRESH_MS;
  }catch(caught){
   const code=caught instanceof ReportError?caught.code:typeof (caught as {code?:unknown})?.code==='string'&&gateErrors.has((caught as {code:string}).code)?(caught as {code:string}).code:requestSignal.aborted?'source_aborted':controller.signal.aborted?'timeout':'source_unavailable';
   denied=denied||(caught instanceof ReportError&&caught.denied)||code==='source_denied';error=code;
   const coordinating=code==='source_busy'||code==='source_cooldown';
   if(!coordinating)failures++;
   const pause=coordinating?60_000:Math.max(Math.min(REFRESH_MS*2**Math.min(failures-1,4),MAX_CACHE_AGE_MS),caught instanceof ReportError?caught.retryAfterMs:0);
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
 function reply():ReportReply<T>{
  const at=now(),age=snapshot?at-Date.parse(snapshot.fetched_at):null;
  const days=snapshot?reportAge(snapshot,at):null;
  const valid=age!==null&&age>=0&&age<=MAX_CACHE_AGE_MS&&days!==null&&days>=0&&days<=MAX_REPORT_AGE_DAYS;
  return {snapshot:!denied&&valid?snapshot:null,status:{state:denied?'denied':!valid?'unavailable':error||age!>REFRESH_MS||days!>STALE_REPORT_DAYS?'stale':'available',error_code:error,last_attempt_at:lastAttempt===null?null:new Date(lastAttempt).toISOString(),fetched_at:snapshot?.fetched_at??null,cache_age_ms:age,report_age_days:days,refresh_ms:REFRESH_MS,max_cache_age_ms:MAX_CACHE_AGE_MS,next_retry_at:denied||retryAt===0||retryAt>8.64e15?null:new Date(retryAt).toISOString()}};
 }
 return async(request:Request):Promise<Response>=>{
  const url=new URL(request.url),mode=url.pathname.split('/').at(-1);
  if(request.method!=='GET')return Response.json({error:'method_not_allowed'},{status:405,headers:{Allow:'GET'}});
  if(!['snapshot','status'].includes(mode??'')||url.search)return Response.json({error:'invalid_request'},{status:400});
  let busy=false;
  try{
   const shared=await settleGate(options.gate.inspect(),AbortSignal.timeout(2_000));
   if(denied||shared.state==='blocked'){denied=true;snapshot=null;error='source_denied';}
   else if(shared.providerUnavailable){snapshot=null;error=shared.providerError??'source_busy';busy=true;retryAt=Math.max(retryAt,shared.retryAt);}
   else if(!denied){
    busy=shared.state==='busy';retryAt=Math.max(retryAt,shared.retryAt);
    if(shared.snapshot&&(!snapshot||Date.parse(shared.snapshot.fetched_at)>Date.parse(snapshot.fetched_at))){snapshot=definition.validate(shared.snapshot);error=null;}
    if(!snapshot&&(busy||now()<retryAt))error=busy?'source_busy':'source_cooldown';
   }
  }
  catch{snapshot=null;error='source_gate_unavailable';const status={...reply().status,state:denied?'denied':'unavailable',error_code:denied?'source_denied':error};return Response.json(mode==='status'?status:{status,snapshot:null},{status:503,headers:{'Cache-Control':'no-store'}});}
  if(mode==='snapshot'&&!denied&&!busy&&now()>=retryAt){pending??=retainedRefresh(request.signal).finally(()=>{pending=undefined;});await pending;}
  // Recheck after asynchronous acquisition, and immediately before exposing any
  // cached evidence. Provider transitions must also veto a local candidate.
  try{
   const finalState=await settleGate(options.gate.inspect(),AbortSignal.timeout(2_000));
   if(finalState.state==='blocked'){denied=true;snapshot=null;error='source_denied';}
   else if(denied){snapshot=null;}
   else if(finalState.providerUnavailable){snapshot=null;error=finalState.providerError??'source_busy';retryAt=Math.max(retryAt,finalState.retryAt);}
  }catch{snapshot=null;error=denied?'source_denied':'source_gate_unavailable';}
  const result=reply();return Response.json(mode==='status'?result.status:result,{status:mode==='status'||result.snapshot?200:503,headers:{'Cache-Control':'no-store','X-Data-Status':result.status.state}});
 };
}
