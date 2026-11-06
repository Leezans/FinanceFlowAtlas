/** Bounded continuation of ONE access-driven collection, not a scheduler.
 * No source access, credentials, gate writes or automatic outer retries live here.
 */
export const COLLECTION_WINDOW_MS=180_000;
export const COLLECTION_MAX_REQUESTS=20; // A slow invocation may validate only one page.
export const COLLECTION_REQUEST_BUDGET_MS=20_000;
export const COLLECTION_TRANSPORT_TIMEOUT_MS=35_000;
const BUFFER_MS=100;
type ContinuationReply={status:number;errorCode?:string;recoveryMode?:string;retryAfter?:string;payload?:unknown};

/** Separate from ordinary recovery's fallback. Missing/ambiguous hints never
 * authorize another batch request. Call only after validating 200/304 evidence.
 */
export function collectionContinuationAt(reply:ContinuationReply,now:number):number|undefined {
 if(![200,304,503].includes(reply.status)||!Number.isSafeInteger(now)||now<0)return;
 const body=reply.payload&&typeof reply.payload==='object'&&'error_code'in reply.payload?reply.payload.error_code:undefined;
 if(reply.errorCode!==undefined&&reply.errorCode!=='collection_in_progress'||body!==undefined&&body!=='collection_in_progress')return;
 if(reply.errorCode!=='collection_in_progress'&&body!=='collection_in_progress')return;
 if(reply.recoveryMode!==undefined&&reply.recoveryMode!=='retry')return;
 const value=reply.retryAfter;
 if(!value)return;
 let at:number;
 if(/^\d+$/.test(value)){
  const seconds=Number(value);if(!Number.isSafeInteger(seconds))return;
  at=now+Math.max(1000,seconds*1000);
 }else {
  // Accept only canonical HTTP-date, not Date.parse's permissive numeric forms.
  const parsed=Date.parse(value);
  if(!Number.isFinite(parsed)||new Date(parsed).toUTCString()!==value)return;
  at=Math.max(now+1000,parsed);
 }
 return Number.isSafeInteger(at)?at:undefined;
}

/** Shared by the page's cancellable timer and a future supported job adapter.
 * A local window is an extra bound; an existing durable stage may be older.
 * Server admission, expiry and complete publication remain authoritative.
 */
export function createCollectionBatch(startedAt:number){
 let requests=0,notBefore=startedAt,ended=false,lastClock=startedAt;
 const deadline=startedAt+COLLECTION_WINDOW_MS;
 const clockValid=(now:number)=>Number.isSafeInteger(startedAt)&&startedAt>=0&&Number.isSafeInteger(now)&&now>=lastClock&&Number.isSafeInteger(deadline);
 return {
  get requests(){return requests;},
  get readyAt(){return notBefore;},
  deadline,
  start(now:number):boolean {
   if(ended||!clockValid(now)||now<notBefore||requests>=COLLECTION_MAX_REQUESTS||now+COLLECTION_REQUEST_BUDGET_MS>=deadline){ended=true;return false;}
   requests++;lastClock=now;return true;
  },
  next(continuationAt:number|undefined,now:number):number|undefined {
   if(ended||requests===0||!clockValid(now)||!Number.isSafeInteger(continuationAt)||requests>=COLLECTION_MAX_REQUESTS){ended=true;return;}
   const at=Math.max(now+1000,continuationAt!+BUFFER_MS);
   if(!Number.isSafeInteger(at)||at+COLLECTION_REQUEST_BUDGET_MS>=deadline){ended=true;return;}
   lastClock=now;notBefore=at;return at;
  },
 };
}

function wait(ms:number,signal:AbortSignal):Promise<void>{
 return new Promise((resolve,reject)=>{
  if(signal.aborted){reject(signal.reason);return;}
  const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);};
  const abort=()=>{done();reject(signal.reason);};
  const timer=setTimeout(()=>{done();resolve();},ms);signal.addEventListener('abort',abort,{once:true});
 });
}

/** One finite job, with no recurring schedule or endpoint selection. The caller
 * supplies an already-authorized ordinary snapshot request and validated result.
 * Only its strict continuationAt may advance the job. Never pass a generic
 * recovery retryAt: that can represent a failure or a guessed fallback delay.
 */
export async function runCollectionBatch<T extends {continuationAt?:number}>(options:{
 request:(signal:AbortSignal)=>Promise<T>;signal?:AbortSignal;now?:()=>number;
}):Promise<{value?:T;requests:number;reason:'response'|'limit'|'cancelled'|'unconfirmed'}>{
 const now=options.now??Date.now,startedAt=now(),cycle=createCollectionBatch(startedAt),controller=new AbortController();
 const abort=()=>controller.abort(options.signal?.reason);options.signal?.addEventListener('abort',abort,{once:true});
 if(options.signal?.aborted)abort();
 const budgetTimer=setTimeout(()=>controller.abort(new Error('collection_window_exhausted')),COLLECTION_WINDOW_MS);
 let value:T|undefined;
 try{
  while(!controller.signal.aborted){
   if(!cycle.start(now()))return {value,requests:cycle.requests,reason:'limit'};
   let timer:ReturnType<typeof setTimeout>|undefined,stop:()=>void=()=>{};
   try{
    const interrupted=new Promise<never>((_resolve,reject)=>{
     stop=()=>reject(controller.signal.reason);controller.signal.addEventListener('abort',stop,{once:true});
     timer=setTimeout(()=>controller.abort(new Error('application_response_unconfirmed')),Math.min(COLLECTION_TRANSPORT_TIMEOUT_MS,startedAt+COLLECTION_WINDOW_MS-now()));
    });
    value=await Promise.race([options.request(controller.signal),interrupted]);
   }catch{return {value,requests:cycle.requests,reason:options.signal?.aborted?'cancelled':'unconfirmed'};}
   finally{if(timer!==undefined)clearTimeout(timer);controller.signal.removeEventListener('abort',stop);}
   if(controller.signal.aborted)return {value,requests:cycle.requests,reason:'cancelled'};
   const next=cycle.next(value.continuationAt,now());
   if(next===undefined)return {value,requests:cycle.requests,reason:value.continuationAt===undefined?'response':'limit'};
   // Runtime timers can wake a millisecond early. Recheck the absolute deadline
   // instead of treating an early wake as permission or a completed batch.
   try{while(now()<next)await wait(next-now(),controller.signal);}catch{return {value,requests:cycle.requests,reason:options.signal?.aborted?'cancelled':'limit'};}
  }
  return {value,requests:cycle.requests,reason:'cancelled'};
 }finally{clearTimeout(budgetTimer);options.signal?.removeEventListener('abort',abort);controller.abort();}
}
