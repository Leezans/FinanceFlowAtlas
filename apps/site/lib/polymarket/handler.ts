import {PolymarketError,parsePolymarket} from './adapter';
import {fetchPolymarket} from './transport';
import {REFRESH_MS,MAX_CACHE_AGE_MS,MAX_CACHE_BYTES,type PolymarketSnapshot,type PolymarketReply} from './model';
export const DEADLINE_MS=12_000;
export type PolymarketOutcome={kind:'success'|'temporary_failure'|'denied';retryAfterMs?:number;snapshot?:PolymarketSnapshot;errorCode?:string};
export type PolymarketGateState={state:'idle'|'busy'|'blocked';retryAt:number;snapshot:PolymarketSnapshot|null;errorCode:string|null;checkedAt:number};
export interface PolymarketGate {
 inspect():Promise<PolymarketGateState>;
 acquire(signal?:AbortSignal):Promise<{token:string}>;
 release(token:string,outcome:PolymarketOutcome):Promise<void>;
}
const gateErrors=new Set(['source_denied','source_busy','source_cooldown','source_gate_unavailable','source_stale_lease','source_aborted']);
function settleGate<T>(operation:Promise<T>,signal:AbortSignal):Promise<T>{
 let cancel=()=>{};
 const deadline=new Promise<never>((_resolve,reject)=>{cancel=()=>reject(new PolymarketError('source_gate_outcome_unconfirmed',true));signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();});
 return Promise.race([operation,deadline]).finally(()=>signal.removeEventListener('abort',cancel));
}
export function createPolymarketHandler(options:{gate:PolymarketGate;fetcher?:typeof fetch;now?:()=>number;waitUntil?:(promise:Promise<unknown>)=>void;isolatedForTests?:boolean}){
 const now=options.now??Date.now,fetcher=options.fetcher??fetch;
 let snapshot:PolymarketSnapshot|null=null,pending:Promise<void>|undefined,error:string|null=null,denied=false,lastAttempt:number|null=null,retryAt=0,failures=0;
 async function refresh(requestSignal:AbortSignal,lifetimeReady:()=>boolean,track:<T>(operation:Promise<T>)=>Promise<T>){
  const controller=new AbortController(),deadline=new AbortController();
  const abort=()=>controller.abort();requestSignal.addEventListener('abort',abort,{once:true});if(requestSignal.aborted)abort();
  const timer=setTimeout(()=>{deadline.abort();controller.abort();},DEADLINE_MS);
  let token:string|undefined,releasing=false;
  const started=now();lastAttempt=started;
  try{
   if(!lifetimeReady())throw new PolymarketError('runtime_lifetime_unverified');
   if(controller.signal.aborted)throw new PolymarketError('source_aborted');
   // Request cancellation never abandons a pending admission write. The exact
   // owner releases late admission within its retained request lifetime.
   const lease=await settleGate(track(options.gate.acquire(controller.signal)),deadline.signal);token=lease.token;
   if(!token)throw new PolymarketError('source_gate_unavailable');
   if(controller.signal.aborted)throw new PolymarketError(requestSignal.aborted?'source_aborted':'timeout');
   const acquisition=await fetchPolymarket(fetcher,controller.signal,now);
   if(controller.signal.aborted)throw new PolymarketError(requestSignal.aborted?'source_aborted':'timeout');
   const candidate=parsePolymarket(acquisition.rows,new Date(started).toISOString(),new Date(now()).toISOString(),acquisition.coverage);
   // Metadata update clocks are not price observation clocks. Never synthesize
   // the latter from acquisition time or a market's record-level updatedAt.
   // Reject oversize evidence before entering uncertain publication state, so
   // the exact owner can release its lease as an ordinary failed acquisition.
   if(new TextEncoder().encode(JSON.stringify(candidate)).byteLength>MAX_CACHE_BYTES)throw new PolymarketError('snapshot_byte_budget');
   releasing=true;
   await settleGate(track(options.gate.release(token,{kind:'success',snapshot:candidate})),AbortSignal.timeout(2_000));
   token=undefined;snapshot=candidate;error=null;failures=0;retryAt=now()+REFRESH_MS;
  }catch(caught){
   const code=caught instanceof PolymarketError?(requestSignal.aborted&&!caught.denied&&caught.code==='timeout'?'source_aborted':caught.code):typeof (caught as {code?:unknown})?.code==='string'&&gateErrors.has((caught as {code:string}).code)?(caught as {code:string}).code:requestSignal.aborted?'source_aborted':controller.signal.aborted?'timeout':'source_unavailable';
   denied=denied||(caught instanceof PolymarketError&&caught.denied)||code==='source_denied';error=code;
   const coordinating=code==='source_busy'||code==='source_cooldown';
   if(!coordinating)failures++;
   const pause=coordinating?REFRESH_MS:Math.max(Math.min(REFRESH_MS*2**Math.min(failures-1,4),MAX_CACHE_AGE_MS),caught instanceof PolymarketError?caught.retryAfterMs:0);
   retryAt=now()+pause;
   if(token&&!releasing){
    try{await settleGate(track(options.gate.release(token,{kind:denied?'denied':'temporary_failure',retryAfterMs:pause,errorCode:code})),AbortSignal.timeout(2_000));}
    catch{denied=true;error='source_gate_outcome_unconfirmed';}
   }else if(releasing){denied=true;error='source_gate_outcome_unconfirmed';}
   if(denied)snapshot=null;
  }finally{clearTimeout(timer);requestSignal.removeEventListener('abort',abort);controller.abort();}
 }
 function retainedRequest<T>(run:(ready:()=>boolean,track:<Value>(operation:Promise<Value>)=>Promise<Value>)=>Promise<T>):Promise<T>{
  let retained=options.isolatedForTests===true&&!options.waitUntil;
  const operations:Promise<unknown>[]=[];
  const track=<T>(operation:Promise<T>)=>{operations.push(operation);return operation;};
  const work=Promise.resolve().then(()=>run(()=>retained,track));
  const lifetime=work.finally(async()=>{await Promise.allSettled(operations);});
  try{if(options.waitUntil){options.waitUntil(lifetime);retained=true;}}catch{retained=false;}
  return work;
 }
 function reply():PolymarketReply{
  const at=now(),age=snapshot?at-Date.parse(snapshot.fetched_at):null;
  const permissionUnknown=['source_busy','source_gate_unavailable','source_gate_outcome_unconfirmed','source_stale_lease'].includes(error??'');
  const valid=!permissionUnknown&&age!==null&&age>=0&&age<=MAX_CACHE_AGE_MS;
  return {snapshot:!denied&&valid?snapshot:null,status:{state:denied?'denied':!valid?'unavailable':error||age!>REFRESH_MS?'stale':'available',error_code:error,last_attempt_at:lastAttempt===null?null:new Date(lastAttempt).toISOString(),fetched_at:snapshot?.fetched_at??null,cache_age_ms:age,refresh_ms:REFRESH_MS,max_cache_age_ms:MAX_CACHE_AGE_MS,next_retry_at:denied||retryAt===0||retryAt>8.64e15?null:new Date(retryAt).toISOString()}};
 }
 return async(request:Request):Promise<Response>=>{
  const url=new URL(request.url),mode=url.pathname.split('/').at(-1);
  if(request.method!=='GET')return Response.json({error:'method_not_allowed'},{status:405,headers:{Allow:'GET'}});
  if(!['snapshot','status'].includes(mode??'')||url.search)return Response.json({error:'invalid_request'},{status:400});
  const run=async(ready:()=>boolean,track:<T>(operation:Promise<T>)=>Promise<T>)=>{
   let busy=false;
   try{
    const shared=await settleGate(options.gate.inspect(),AbortSignal.timeout(2_000));
    if(shared.state==='blocked'){denied=true;snapshot=null;error='source_denied';}
    else if(!denied){
     busy=shared.state==='busy';retryAt=Math.max(retryAt,shared.retryAt);
     // Busy/unknown permission state cannot serve warm or persisted evidence.
     if(busy){const status={...reply().status,state:'unavailable' as const,error_code:'source_busy'};return Response.json(mode==='status'?status:{status,snapshot:null},{status:mode==='status'?200:503,headers:{'Cache-Control':'no-store'}});}
     if(shared.snapshot&&(!snapshot||Date.parse(shared.snapshot.fetched_at)>=Date.parse(snapshot.fetched_at))){snapshot=shared.snapshot;error=shared.errorCode;}
     if(shared.checkedAt>0)lastAttempt=Math.max(lastAttempt??0,shared.checkedAt);
     if(!snapshot&&now()<retryAt)error=shared.errorCode??'source_cooldown';
    }
   }catch{error='source_gate_unavailable';const status={...reply().status,state:'unavailable' as const};return Response.json(mode==='status'?status:{status,snapshot:null},{status:503,headers:{'Cache-Control':'no-store'}});}
   if(mode==='snapshot'&&!denied&&!busy&&now()>=retryAt){pending??=refresh(request.signal,ready,track).finally(()=>{pending=undefined;});await pending;}
   const result=reply();return Response.json(mode==='status'?result.status:result,{status:mode==='status'||result.snapshot?200:503,headers:{'Cache-Control':'no-store','X-Data-Status':result.status.state}});
  };
  // Register synchronously, before even asynchronous permission inspection.
  return mode==='snapshot'?retainedRequest(run):run(()=>false,operation=>operation);
 };
}
