import {fetchEcb,FxSourceError} from './ecb';
import {RETRY_INTERVAL_MS,type FxPayload,type FxSnapshot,type FxErrorCode} from './model';
import {SourceGateError} from '../ashare/source-gate';
import type {FxGate,FxGateState} from './source-gate';

// Timed-out DB writes may still commit. Never retry an unconfirmed mutation.
// An aborted acquire may later confirm and release only its own exact token.
async function settle<T>(operation:Promise<T>,onTimeout?:()=>void):Promise<T>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([operation,new Promise<never>((_,reject)=>{timer=setTimeout(()=>{onTimeout?.();reject(new SourceGateError('source_gate_unavailable'))},2_000)})])}
 finally{clearTimeout(timer)}
}
/** All reads use the primary shared gate/cache. Only concurrent calls are local. */
export function createFxService(fetcher:typeof fetch=fetch,now:()=>number=Date.now,gate:FxGate,retain?:((promise:Promise<unknown>)=>void)){
 let pending:Promise<FxPayload>|null=null;
 function gateFailure(error:unknown):FxPayload{
  const code=error instanceof SourceGateError?error.code:'source_gate_unavailable';
  const errorCode=code==='source_denied'?'source_stopped':code==='source_busy'?'source_busy':code==='source_cooldown'?'source_cooldown':'source_gate_unavailable';
  const stopped=errorCode==='source_stopped'||errorCode==='source_gate_unavailable';
  return {snapshot:null,source_state:stopped?'stopped':'unavailable',checked_at:null,next_check_at:stopped?null:new Date(now()+RETRY_INTERVAL_MS).toISOString(),error_code:errorCode};
 }
 function payload(state:FxGateState):FxPayload{
  if(state.state!=='idle')return gateFailure(new SourceGateError(state.state==='blocked'?'source_denied':'source_busy'));
  const snapshot=state.expired?null:state.snapshot,errorCode=state.expired?'cache_expired':state.errorCode??(snapshot?null:'source_cooldown');
  return {snapshot,source_state:snapshot?(errorCode?'stale':'available'):'unavailable',checked_at:state.checkedAt,next_check_at:new Date(state.retryAt).toISOString(),error_code:errorCode};
 }
 async function readOnce(track:<T>(operation:Promise<T>)=>Promise<T>):Promise<FxPayload>{
  try{
   const state=await settle(track(gate.inspect()));
   if(state.state!=='idle'||state.nowMs<state.retryAt)return payload(state);
   let token:string;const admission=new AbortController();
   try{token=(await settle(track(gate.acquire(admission.signal)),()=>admission.abort())).token}catch(error){
    // A competing worker may have just published the shared cache. Read it once,
    // without retrying acquisition or extending any source cooldown.
    if(error instanceof SourceGateError&&error.code==='source_cooldown')return payload(await settle(track(gate.inspect())));
    throw error;
   }
   let next:FxSnapshot|null=null,sourceError:FxErrorCode|null=null;
   try{
    next=await fetchEcb(fetcher,now);
    if(state.snapshot&&next.reference_date<state.snapshot.reference_date)throw new FxSourceError('source_older');
   }catch(error){sourceError=error instanceof FxSourceError?error.code:'network_error'}
   // One token-guarded database write publishes cache, check, cooldown and denial.
   // Never follow a failed/uncertain publication with another release.
   await settle(track(gate.release(token,sourceError==='source_stopped'?{kind:'denied'}:sourceError?{kind:'temporary_failure',error:sourceError}:{kind:'success',snapshot:next!})));
   return payload(await settle(track(gate.inspect())));
  }catch(error){return gateFailure(error)}
 }
 return {async read():Promise<FxPayload>{
  if(!pending){
   // Register request-lifetime retention before any DB lease or source access.
   // The provider timeout plus bounded DB operations fits Workers' cleanup window.
   const operations:Promise<unknown>[]=[];
   const track=<T,>(operation:Promise<T>):Promise<T>=>{operations.push(operation);return operation;};
   let retained=!retain;
   const work=Promise.resolve().then(()=>retained?readOnce(track):gateFailure(new SourceGateError('source_gate_unavailable')));
   // A response timeout does not end the lifetime of its already-started D1
   // operation, including acquire's eventual exact-token abort cleanup.
   const lifetime=work.then(()=>Promise.allSettled(operations)).then(()=>{});
   pending=work;
   try{if(retain){retain(lifetime);retained=true}}catch{/* Fail closed before acquiring. */}
  }
  const operation=pending;try{return await operation}finally{if(pending===operation)pending=null}
 }};
}
