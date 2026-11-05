import {CboeError,fetchCboeSnapshot} from './source';
import {REFRESH_MS,MAX_CACHE_AGE_MS,type CboeReply} from './service-model';
import {MAX_SNAPSHOT_CHARS,type CboeSnapshot} from './model';
// Absolute budgets start at request entry, not after inspection/admission.
// Abort acquisition at 18s, leaving 2s for ordinary terminal D1 cleanup and
// 10s of additional margin before the host's observed30s retained-work ceiling.
export const CBOE_ACQUISITION_MS=18_000,CBOE_DEADLINE_MS=20_000;
export type CboeOutcome={kind:'success'|'temporary_failure'|'denied';retryAfterMs?:number;snapshot?:CboeSnapshot};
export type CboeGateState={state:'idle'|'busy'|'blocked';retryAt:number;snapshot:CboeSnapshot|null};
export interface CboeGate {inspect():Promise<CboeGateState>;acquire(signal?:AbortSignal):Promise<{token:string}>;release(token:string,outcome:CboeOutcome):Promise<void>}
function fail(code:string):never{throw new CboeError(code);}
const gateErrors=new Set(['source_denied','source_busy','source_cooldown','source_gate_unavailable','source_stale_lease','source_aborted']);
function settleGate<T>(operation:Promise<T>,signal:AbortSignal):Promise<T>{
 let cancel=()=>{};
 const deadline=new Promise<never>((_resolve,reject)=>{cancel=()=>reject(new CboeError('source_gate_outcome_unconfirmed',true));signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();});
 // A late/uncertain DB operation remains retained, never taken over or retried.
 return Promise.race([operation,deadline]).finally(()=>signal.removeEventListener('abort',cancel));
}
type Lifetime={source:AbortController;completion:AbortController;track:<T>(operation:Promise<T>)=>Promise<T>};
export function createCboeHandler(options:{gate:CboeGate;fetcher?:typeof fetch;now?:()=>number;waitUntil?:(promise:Promise<unknown>)=>void;isolatedForTests?:boolean}){
 const now=options.now??Date.now,fetcher=options.fetcher??fetch;
 let snapshot:CboeSnapshot|null=null,pending:Promise<void>|undefined,error:string|null=null,denied=false,lastAttempt:number|null=null,retryAt=0,failures=0;
 async function refresh(request:Request,started:number,lifetime:Lifetime){
  const {source,completion,track}=lifetime;let token:string|undefined,releasing=false;
  lastAttempt=started;
  try{
   if(source.signal.aborted)fail(request.signal.aborted?'source_aborted':'timeout');
   // Request abort cannot abandon a pending D1 admission. acquire() releases
   // its own late successful lease after observing the already-aborted signal.
   const lease=await settleGate(track(options.gate.acquire(source.signal)),completion.signal);token=lease.token;
   if(!token)fail('source_gate_unavailable');if(source.signal.aborted)fail(request.signal.aborted?'source_aborted':'timeout');
   // Do not race collection against a timer and then unlock an unknown request.
   // Normal fetch/body reads observe source.abort; only their settled outcome
   // permits terminal release. A non-cooperative fetch stays durably busy.
   const candidate=await fetchCboeSnapshot(fetcher,started,now,source.signal);
   if(JSON.stringify(candidate).length>MAX_SNAPSHOT_CHARS)fail('snapshot_budget');
   if(snapshot&&Date.parse(candidate.windowEnd)<Date.parse(snapshot.windowEnd))fail('source_window_regression');
   if(source.signal.aborted)fail(request.signal.aborted?'source_aborted':'timeout');
   releasing=true;await settleGate(track(options.gate.release(token,{kind:'success',snapshot:candidate})),completion.signal);token=undefined;
   snapshot=candidate;error=null;failures=0;retryAt=now()+REFRESH_MS;
  }catch(caught){
   const code=caught instanceof CboeError?caught.code:typeof (caught as {code?:unknown})?.code==='string'&&gateErrors.has((caught as {code:string}).code)?(caught as {code:string}).code:request.signal.aborted?'source_aborted':source.signal.aborted?'timeout':'source_unavailable';
   denied=denied||(caught instanceof CboeError&&caught.denied)||code==='source_denied';error=code;
   const coordinating=code==='source_busy'||code==='source_cooldown';
   if(!coordinating)failures++;
   const pause=coordinating?60_000:Math.max(Math.min(REFRESH_MS*2**Math.min(failures-1,4),MAX_CACHE_AGE_MS),caught instanceof CboeError?caught.retryAfterMs:0);
   retryAt=now()+pause;
   if(token&&!releasing){
    try{await settleGate(track(options.gate.release(token,{kind:denied?'denied':'temporary_failure',retryAfterMs:pause})),completion.signal);}
    catch{denied=true;error='source_gate_outcome_unconfirmed';}
   }else if(releasing){denied=true;error='source_gate_outcome_unconfirmed';}
   if(denied||['source_busy','source_gate_unavailable','source_stale_lease','source_gate_outcome_unconfirmed'].includes(code))snapshot=null;
  }
 }
 function reply():CboeReply{
  const at=now(),age=snapshot?at-Date.parse(snapshot.fetchedAt):null;
  const valid=age!==null&&age>=0&&age<=MAX_CACHE_AGE_MS;
  return {snapshot:!denied&&valid?snapshot:null,status:{state:denied?'denied':!valid?'unavailable':error||age!>REFRESH_MS?'stale':'available',error_code:error,last_attempt_at:lastAttempt===null?null:new Date(lastAttempt).toISOString(),fetched_at:snapshot?.fetchedAt??null,cache_age_ms:age,refresh_ms:REFRESH_MS,max_cache_age_ms:MAX_CACHE_AGE_MS,next_retry_at:denied||retryAt===0||retryAt>8.64e15?null:new Date(retryAt).toISOString()}};
 }
 function unavailable(mode:string,code:string){
  const status={...reply().status,state:'unavailable' as const,error_code:code};
  return Response.json(mode==='status'?status:{status,snapshot:null},{status:503,headers:{'Cache-Control':'no-store'}});
 }
 async function handle(request:Request,mode:string,started:number,lifetime:Lifetime,ready:()=>boolean):Promise<Response>{
  if(!ready())return unavailable(mode,'runtime_lifetime_unverified');
  let busy=false;
  try{
   const shared=await settleGate(lifetime.track(options.gate.inspect()),AbortSignal.timeout(2_000));
   if(shared.state==='blocked'){denied=true;snapshot=null;error='source_denied';}
   else if(!denied){
    busy=shared.state==='busy';if(busy){snapshot=null;error='source_busy';}retryAt=Math.max(retryAt,shared.retryAt);
    if(!busy&&shared.snapshot&&(!snapshot||Date.parse(shared.snapshot.fetchedAt)>Date.parse(snapshot.fetchedAt))){snapshot=shared.snapshot;error=null;}
    if(!snapshot&&(busy||now()<retryAt))error=busy?'source_busy':'source_cooldown';
   }
  }catch{return unavailable(mode,'source_gate_unavailable');}
  if(mode==='snapshot'&&!denied&&!busy&&now()>=retryAt){pending??=refresh(request,started,lifetime).finally(()=>{pending=undefined;});await pending;}
  const hideForRace=['source_busy','source_gate_unavailable','source_stale_lease','source_gate_outcome_unconfirmed'].includes(error??'');
  if(mode==='snapshot'){
   // Source completion is not authority to serve data: another isolate may
   // have blocked/admitted the source or invalidated the store meanwhile.
   try{
    const final=await settleGate(lifetime.track(options.gate.inspect()),AbortSignal.timeout(2_000));
    retryAt=Math.max(retryAt,final.retryAt);
    if(final.state==='blocked'){denied=true;snapshot=null;error='source_denied';}
    else if(final.state==='busy'){snapshot=null;error='source_busy';}
    else if(!denied&&!hideForRace)snapshot=final.snapshot;
    else snapshot=null;
   }catch{return unavailable(mode,'source_gate_unavailable');}
  }
  const result=reply();return Response.json(mode==='status'?result.status:result,{status:mode==='status'||result.snapshot?200:503,headers:{'Cache-Control':'no-store','X-Data-Status':result.status.state}});
 }
 return (request:Request):Promise<Response>=>{
  const started=now(),url=new URL(request.url),mode=url.pathname.split('/').at(-1);
  if(request.method!=='GET')return Promise.resolve(Response.json({error:'method_not_allowed'},{status:405,headers:{Allow:'GET'}}));
  if(!['snapshot','status'].includes(mode??'')||url.search)return Promise.resolve(Response.json({error:'invalid_request'},{status:400}));
  const source=new AbortController(),completion=new AbortController(),operations:Promise<unknown>[]=[];
  const abort=()=>source.abort();request.signal.addEventListener('abort',abort,{once:true});if(request.signal.aborted)abort();
  const sourceTimer=setTimeout(abort,CBOE_ACQUISITION_MS);
  let hardTimer:ReturnType<typeof setTimeout>;
  const hardResponse=new Promise<Response>(resolve=>{hardTimer=setTimeout(()=>{completion.abort();source.abort();resolve(unavailable(mode!,'runtime_deadline'));},CBOE_DEADLINE_MS);});
  const lifetime:Lifetime={source,completion,track:<T,>(operation:Promise<T>)=>{operations.push(operation);return operation;}};
  let retained=options.isolatedForTests===true&&!options.waitUntil;
  // Register the complete lifetime synchronously, before even inspect() begins.
  const work=Promise.resolve().then(()=>handle(request,mode!,started,lifetime,()=>retained)).finally(()=>{
   clearTimeout(sourceTimer);clearTimeout(hardTimer);request.signal.removeEventListener('abort',abort);source.abort();
  });
  const retainedWork=work.then(()=>{},()=>{}).then(()=>Promise.allSettled(operations)).then(()=>{});
  try{if(options.waitUntil){options.waitUntil(retainedWork);retained=true;}}catch{retained=false;}
  // Only the HTTP reply races the hard ceiling. The retained source task is not
  // abandoned, and an unknown outstanding request never causes gate release.
  return Promise.race([work,hardResponse]);
 };
}
