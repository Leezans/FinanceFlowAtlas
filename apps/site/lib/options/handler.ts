import {strictJSON} from '../ashare/strict-json';
import {SUMMARY_URLS,INSTRUMENTS_URLS,OptionsError,resultRows,parseMetadata,reusableMetadata,parseSummary,combineSnapshots} from './adapter';
import {REFRESH_MS,MAX_CACHE_AGE_MS,MAX_BYTES,type OptionsSnapshot,type OptionsReply} from './model';
const DEADLINE_MS=15_000;
export type OptionsOutcome={kind:'success'|'temporary_failure'|'denied';retryAfterMs?:number;snapshot?:OptionsSnapshot};
export type OptionsGateState={state:'idle'|'busy'|'blocked';retryAt:number;snapshot:OptionsSnapshot|null};
export interface OptionsGate {inspect():Promise<OptionsGateState>;acquire(signal?:AbortSignal):Promise<{token:string}>;release(token:string,outcome:OptionsOutcome):Promise<void>}
function fail(code:string):never{throw new OptionsError(code);}
const gateErrors=new Set(['source_denied','source_busy','source_cooldown','source_gate_unavailable','source_stale_lease','source_aborted']);
async function readJSON(response:Response,signal:AbortSignal){
 if(!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')??''))throw new OptionsError('unexpected_content_type',true);
 const length=response.headers.get('content-length');if(length!==null&&(!/^\d{1,10}$/.test(length)||Number(length)>MAX_BYTES))fail('byte_budget');
 const reader=response.body?.getReader();if(!reader)fail('empty_response');
 const chunks:Uint8Array[]=[];let size=0;
 const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
 try{while(true){if(signal.aborted)fail('timeout');const part=await reader.read();if(signal.aborted)fail('timeout');if(part.done)break;size+=part.value.byteLength;if(size>MAX_BYTES)fail('byte_budget');chunks.push(part.value);}}
 finally{signal.removeEventListener('abort',abort);void reader.cancel().catch(()=>{});reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(/^\s*</.test(text))throw new OptionsError('html_challenge',true);
 return strictJSON(text);
}
function settleGate<T>(operation:Promise<T>,signal:AbortSignal):Promise<T>{
 let cancel=()=>{};
 const deadline=new Promise<never>((_resolve,reject)=>{cancel=()=>reject(new OptionsError('source_gate_outcome_unconfirmed',true));signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();});
 // A late/uncertain DB result is never taken over or retried.
 return Promise.race([operation,deadline]).finally(()=>signal.removeEventListener('abort',cancel));
}
function retryAfter(value:string|null,now:number){if(value===null)return 0;if(/^\d+$/.test(value))return Math.min(Number.MAX_SAFE_INTEGER,Number(value)*1000);const date=Date.parse(value);return Number.isFinite(date)?Math.max(0,date-now):0;}
export function createOptionsHandler(options:{gate:OptionsGate;fetcher?:typeof fetch;now?:()=>number;waitUntil?:(promise:Promise<unknown>)=>void;isolatedForTests?:boolean}){
 const now=options.now??Date.now,fetcher=options.fetcher??fetch;
 let snapshot:OptionsSnapshot|null=null,pending:Promise<void>|undefined,error:string|null=null,denied=false,lastAttempt:number|null=null,retryAt=0,failures=0;
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
     if([401,403,407,429,451].includes(response.status))throw new OptionsError('source_access_denied',true);
     if(response.redirected||response.status>=300&&response.status<400)throw new OptionsError('redirect_denied',true);
     if(/^(text\/html|application\/xhtml\+xml)(?:\s*;|$)/i.test(response.headers.get('content-type')??''))throw new OptionsError('html_challenge',true);
     if(response.status!==200)throw new OptionsError('upstream_http',false,retryAfter(response.headers.get('retry-after'),now()));
     return await readJSON(response,controller.signal);
    }finally{if(!response.body?.locked)void response.body?.cancel().catch(()=>{});}
   };
   // One fixed universe, one durable provider lease. A denied currency stops both.
   // Summaries precede metadata so their observation interval stays coherent.
   const currencies=['BTC','ETH'] as const, summaries=new Map<string,Record<string,unknown>[]>();
   for(const currency of currencies)summaries.set(currency,resultRows(await fetchRows(SUMMARY_URLS[currency])));
   const parts:OptionsSnapshot[]=[];let lastMetadataStart:number|undefined;
   for(const currency of currencies){
    const rows=summaries.get(currency)!;
    let metadata=reusableMetadata(snapshot,rows,started,currency),metadataFetched=snapshot?.metadata_fetched_at[currency]??'';
    if(!metadata){
     // get_instruments has a separate low rate limit. Even one cold batch does not burst it.
     if(lastMetadataStart!==undefined){
      const delay=Math.max(0,1100-(performance.now()-lastMetadataStart));
      if(delay)await new Promise<void>((resolve,reject)=>{
       const stop=()=>{clearTimeout(timer);controller.signal.removeEventListener('abort',stop);reject(new OptionsError(requestSignal.aborted?'source_aborted':'timeout'));};
       const timer=setTimeout(()=>{controller.signal.removeEventListener('abort',stop);resolve();},delay);
       controller.signal.addEventListener('abort',stop,{once:true});if(controller.signal.aborted)stop();
      });
     }
     lastMetadataStart=performance.now();metadata=parseMetadata(await fetchRows(INSTRUMENTS_URLS[currency]),currency);metadataFetched=new Date(now()).toISOString();
    }
    parts.push(parseSummary(rows,metadata,new Date(started).toISOString(),new Date(now()).toISOString(),metadataFetched,currency));
   }
   const candidate=combineSnapshots(parts);
   releasing=true;await settleGate(track(options.gate.release(token,{kind:'success',snapshot:candidate})),deadline.signal);token=undefined;
   snapshot=candidate;error=null;failures=0;retryAt=now()+REFRESH_MS;
  }catch(caught){
   const code=caught instanceof OptionsError?caught.code:typeof (caught as {code?:unknown})?.code==='string'&&gateErrors.has((caught as {code:string}).code)?(caught as {code:string}).code:requestSignal.aborted?'source_aborted':controller.signal.aborted?'timeout':!token&&!releasing?'source_gate_unavailable':'source_unavailable';
   denied=denied||(caught instanceof OptionsError&&caught.denied)||code==='source_denied';error=code;
   const coordinating=code==='source_busy'||code==='source_cooldown';
   if(!coordinating)failures++;
   const pause=coordinating?60_000:Math.max(Math.min(REFRESH_MS*2**Math.min(failures-1,4),MAX_CACHE_AGE_MS),caught instanceof OptionsError?caught.retryAfterMs:0);
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
 function reply():OptionsReply{
  const at=now(),age=snapshot?at-Date.parse(snapshot.fetched_at):null;
  const sourceAge=snapshot?at-Date.parse(snapshot.source_as_of):null;
  const gateUnconfirmed=error!==null&&['source_busy','source_gate_unavailable','source_stale_lease','source_cooldown','source_gate_outcome_unconfirmed','runtime_lifetime_unverified'].includes(error);
  const valid=!gateUnconfirmed&&age!==null&&age>=-5_000&&age<=MAX_CACHE_AGE_MS&&sourceAge!==null&&sourceAge>=-5_000&&sourceAge<=MAX_CACHE_AGE_MS&&snapshot!.rows.some(r=>r.expiration_timestamp>at);
  return {snapshot:!denied&&valid?snapshot:null,status:{state:denied?'denied':!valid?'unavailable':error||age!>REFRESH_MS||sourceAge!>REFRESH_MS?'stale':'available',error_code:error,last_attempt_at:lastAttempt===null?null:new Date(lastAttempt).toISOString(),fetched_at:snapshot?.fetched_at??null,cache_age_ms:age,refresh_ms:REFRESH_MS,max_cache_age_ms:MAX_CACHE_AGE_MS,next_retry_at:denied||retryAt===0||retryAt>8.64e15?null:new Date(retryAt).toISOString()}};
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
  catch{error='source_gate_unavailable';const status={...reply().status,state:'unavailable'};return Response.json(mode==='status'?status:{status,snapshot:null},{status:503,headers:{'Cache-Control':'no-store'}});}
  if(mode==='snapshot'&&!denied&&!busy&&now()>=retryAt){pending??=retainedRefresh(request.signal).finally(()=>{pending=undefined;});await pending;}
  const result=reply();return Response.json(mode==='status'?result.status:result,{status:mode==='status'||result.snapshot?200:503,headers:{'Cache-Control':'no-store','X-Data-Status':result.status.state}});
 };
}
