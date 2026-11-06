import {acquireOpenInterest} from './interest';
import {PolymarketError,parsePolymarket,parseHotPolymarket} from './adapter';
import {fetchPolymarket,fetchHotPolymarket} from './transport';
import {REFRESH_MS,MAX_CACHE_BYTES,refreshInterval,maximumCacheAge,selectSnapshot,updateStoredCache,latestCacheTime,snapshotCacheTime,INTEREST_COLLECTION_BUDGET_MS,type PolymarketStoredCache,type PolymarketView,type PolymarketReply} from './model';
export const DEADLINE_MS=INTEREST_COLLECTION_BUDGET_MS;
export type PolymarketOutcome={kind:'success'|'temporary_failure'|'denied';retryAfterMs?:number;interestRetryAfterMs?:number;snapshot?:PolymarketStoredCache;errorCode?:string};
export type PolymarketGateState={state:'idle'|'busy'|'blocked';retryAt:number;sharedRetryAt?:number;snapshot:PolymarketStoredCache|null;errorCode:string|null;checkedAt:number};
export interface PolymarketGate {
 inspect(view?:PolymarketView):Promise<PolymarketGateState>;
 acquire(signal?:AbortSignal,view?:PolymarketView):Promise<{token:string}>;
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
 let snapshot:PolymarketStoredCache|null=null,pending:Promise<void>|undefined,denied=false,sourceRetryAt=0;
 const states:Record<PolymarketView,{error:string|null;lastAttempt:number|null;failures:number}>={hot:{error:null,lastAttempt:null,failures:0},newest:{error:null,lastAttempt:null,failures:0},interest:{error:null,lastAttempt:null,failures:0}};
 const retryAts:Record<PolymarketView,number>={hot:0,newest:0,interest:0};
 async function refresh(view:PolymarketView,requestSignal:AbortSignal,lifetimeReady:()=>boolean,track:<T>(operation:Promise<T>)=>Promise<T>){
  const state=states[view];
  const controller=new AbortController(),deadline=new AbortController();
  const abort=()=>controller.abort();requestSignal.addEventListener('abort',abort,{once:true});if(requestSignal.aborted)abort();
  const timer=setTimeout(()=>{deadline.abort();controller.abort();},DEADLINE_MS);
  let token:string|undefined,releasing=false;
  const started=now();state.lastAttempt=started;
  try{
   if(!lifetimeReady())throw new PolymarketError('runtime_lifetime_unverified');
   if(controller.signal.aborted)throw new PolymarketError('source_aborted');
   // Request cancellation never abandons a pending admission write. The exact
   // owner releases late admission within its retained request lifetime.
   const lease=await settleGate(track(options.gate.acquire(controller.signal,view)),deadline.signal);token=lease.token;
   if(!token)throw new PolymarketError('source_gate_unavailable');
   if(controller.signal.aborted)throw new PolymarketError(requestSignal.aborted?'source_aborted':'timeout');
   const acquired=await (async()=>{
    if(view==='interest')return acquireOpenInterest(fetcher,controller.signal,now,started);
    if(view==='hot'){
     const rows=await fetchHotPolymarket(fetcher,controller.signal,now);
     return parseHotPolymarket(rows,new Date(started).toISOString(),new Date(now()).toISOString());
    }
    const acquisition=await fetchPolymarket(fetcher,controller.signal,now);
    return parsePolymarket(acquisition.rows,new Date(started).toISOString(),new Date(now()).toISOString(),acquisition.coverage);
   })();
   if(controller.signal.aborted)throw new PolymarketError(requestSignal.aborted?'source_aborted':'timeout');
   // Atomic publication retains the other independently-timestamped mode.
   const candidate=updateStoredCache(snapshot,acquired);
   // Metadata update clocks are not price observation clocks. Never synthesize
   // the latter from acquisition time or a market's record-level updatedAt.
   // Reject oversize evidence before entering uncertain publication state, so
   // the exact owner can release its lease as an ordinary failed acquisition.
   if(new TextEncoder().encode(JSON.stringify(candidate)).byteLength>MAX_CACHE_BYTES)throw new PolymarketError('snapshot_byte_budget');
   releasing=true;
   await settleGate(track(options.gate.release(token,{kind:'success',snapshot:candidate,retryAfterMs:REFRESH_MS,interestRetryAfterMs:refreshInterval(view)})),AbortSignal.timeout(2_000));
   token=undefined;snapshot=candidate;state.error=null;state.failures=0;sourceRetryAt=now()+REFRESH_MS;retryAts[view]=now()+refreshInterval(view);
  }catch(caught){
   const code=caught instanceof PolymarketError?(requestSignal.aborted&&!caught.denied&&caught.code==='timeout'?'source_aborted':caught.code):typeof (caught as {code?:unknown})?.code==='string'&&gateErrors.has((caught as {code:string}).code)?(caught as {code:string}).code:requestSignal.aborted?'source_aborted':controller.signal.aborted?'timeout':'source_unavailable';
   denied=denied||(caught instanceof PolymarketError&&caught.denied)||code==='source_denied';state.error=code;
   const coordinating=code==='source_busy'||code==='source_cooldown';
   if(!coordinating)state.failures++;
   const pause=coordinating?REFRESH_MS:Math.max(Math.min(refreshInterval(view)*2**Math.min(state.failures-1,4),maximumCacheAge(view)),caught instanceof PolymarketError?caught.retryAfterMs:0);
   retryAts[view]=now()+pause;
   if(token)sourceRetryAt=now()+(view==='interest'?Math.max(REFRESH_MS,caught instanceof PolymarketError?caught.retryAfterMs:0):pause);
   if(token&&!releasing){
    try{await settleGate(track(options.gate.release(token,{kind:denied?'denied':'temporary_failure',retryAfterMs:view==='interest'?Math.max(REFRESH_MS,caught instanceof PolymarketError?caught.retryAfterMs:0):pause,interestRetryAfterMs:pause,errorCode:code})),AbortSignal.timeout(2_000));}
    catch{denied=true;state.error='source_gate_outcome_unconfirmed';}
   }else if(releasing){denied=true;state.error='source_gate_outcome_unconfirmed';}
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
 function reply(view:PolymarketView):PolymarketReply{
  const {error,lastAttempt}=states[view];
  const selected=selectSnapshot(snapshot,view),at=now(),age=selected?at-snapshotCacheTime(selected):null;
  const permissionUnknown=['source_busy','source_gate_unavailable','source_gate_outcome_unconfirmed','source_stale_lease'].includes(error??'');
  const valid=!permissionUnknown&&age!==null&&age>=0&&at>=Date.parse(selected!.fetched_at)&&age<=maximumCacheAge(view);
  return {snapshot:!denied&&valid?selected:null,status:{state:denied?'denied':!valid?'unavailable':error||age!>refreshInterval(view)?'stale':'available',error_code:error,last_attempt_at:lastAttempt===null?null:new Date(lastAttempt).toISOString(),fetched_at:selected?.fetched_at??null,cache_age_ms:age,refresh_ms:refreshInterval(view),max_cache_age_ms:maximumCacheAge(view),source_next_retry_at:denied||sourceRetryAt===0||sourceRetryAt>8.64e15?null:new Date(sourceRetryAt).toISOString(),next_retry_at:denied||retryAts[view]===0||retryAts[view]>8.64e15?null:new Date(retryAts[view]).toISOString()}};
 }
 return async(request:Request):Promise<Response>=>{
  const url=new URL(request.url),mode=url.pathname.split('/').at(-1);
  if(request.method!=='GET')return Response.json({error:'method_not_allowed'},{status:405,headers:{Allow:'GET'}});
  const views=url.searchParams.getAll('view');
  if(!['snapshot','status'].includes(mode??'')||[...url.searchParams.keys()].some(key=>key!=='view')||views.length>1||views.length===1&&!['hot','newest','interest'].includes(views[0]))return Response.json({error:'invalid_request'},{status:400});
  const view:PolymarketView=views[0]==='interest'?'interest':views[0]==='hot'?'hot':'newest';
  const run=async(ready:()=>boolean,track:<T>(operation:Promise<T>)=>Promise<T>)=>{
   const state=states[view];
   let busy=false;
   try{
    const shared=await settleGate(options.gate.inspect(view),AbortSignal.timeout(2_000));
    if(shared.state==='blocked'){denied=true;snapshot=null;state.error='source_denied';}
    else if(!denied){
     busy=shared.state==='busy';sourceRetryAt=Math.max(sourceRetryAt,shared.sharedRetryAt??shared.retryAt);retryAts[view]=Math.max(retryAts[view],shared.retryAt);
     // Busy/unknown permission state cannot serve warm or persisted evidence.
     if(busy){const status={...reply(view).status,state:'unavailable' as const,error_code:'source_busy'};return Response.json(mode==='status'?status:{status,snapshot:null},{status:mode==='status'?200:503,headers:{'Cache-Control':'no-store'}});}
     if(shared.snapshot&&(!snapshot||latestCacheTime(shared.snapshot)>=latestCacheTime(snapshot)))snapshot=shared.snapshot;
     state.error=shared.errorCode;
     if(shared.checkedAt>0)state.lastAttempt=Math.max(state.lastAttempt??0,shared.checkedAt);
     if(!selectSnapshot(snapshot,view)&&now()<retryAts[view])state.error=shared.errorCode??'source_cooldown';
    }
   }catch{state.error='source_gate_unavailable';const status={...reply(view).status,state:'unavailable' as const};return Response.json(mode==='status'?status:{status,snapshot:null},{status:503,headers:{'Cache-Control':'no-store'}});}
   if(mode==='snapshot'&&!denied&&!busy&&now()>=retryAts[view]){pending??=refresh(view,request.signal,ready,track).finally(()=>{pending=undefined;});await pending;}
   const result=reply(view);return Response.json(mode==='status'?result.status:result,{status:mode==='status'||result.snapshot?200:503,headers:{'Cache-Control':'no-store','X-Data-Status':result.status.state}});
  };
  // Register synchronously, before even asynchronous permission inspection.
  return mode==='snapshot'?retainedRequest(run):run(()=>false,operation=>operation);
 };
}
