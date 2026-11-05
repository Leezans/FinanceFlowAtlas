import {fetchEcb,FxSourceError} from './ecb';
import {CHECK_INTERVAL_MS,RETRY_INTERVAL_MS,type FxPayload,type FxSnapshot,type FxErrorCode} from './model';
import {SourceGateError} from '../ashare/source-gate';
import type {FxGate} from './source-gate';

// A timed-out DB write may still commit. Never release or reacquire its unknown lease.
async function settle<T>(operation:Promise<T>):Promise<T>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([operation,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new SourceGateError('source_gate_unavailable')),2_000)})])}
 finally{clearTimeout(timer)}
}
/** Rate snapshots are ephemeral; all production acquisition requires a shared gate. */
export function createFxService(fetcher:typeof fetch=fetch,now:()=>number=Date.now,gate:FxGate){
 let snapshot:FxSnapshot|null=null,checkedAt:string|null=null,nextCheck=0,errorCode:FxErrorCode|null=null,stopped=false,pending:Promise<void>|null=null;
 const payload=():FxPayload=>({snapshot,source_state:stopped?'stopped':errorCode?(snapshot?'stale':'unavailable'):'available',checked_at:checkedAt,next_check_at:stopped?null:new Date(nextCheck).toISOString(),error_code:errorCode});
 function gateFailure(error:unknown){
  const code=error instanceof SourceGateError?error.code:'source_gate_unavailable';
  errorCode=code==='source_denied'?'source_stopped':code==='source_busy'?'source_busy':code==='source_cooldown'?'source_cooldown':'source_gate_unavailable';
  // Unknown or busy gate state cannot vouch for a cached snapshot's continued use.
  snapshot=null;stopped=errorCode==='source_stopped'||errorCode==='source_gate_unavailable';nextCheck=now()+RETRY_INTERVAL_MS;
 }
 async function refresh(){
  let token:string;
  try{token=(await settle(gate.acquire())).token}catch(error){gateFailure(error);return}
  let next:FxSnapshot|null=null,sourceError:FxErrorCode|null=null;
  try{
   next=await fetchEcb(fetcher,now);
   if(snapshot&&next.reference_date<snapshot.reference_date)throw new FxSourceError('source_older');
  }catch(error){sourceError=error instanceof FxSourceError?error.code:'network_error'}
  finally{checkedAt=new Date(now()).toISOString()}
  // Persist denial atomically with release. Never follow a failed release with another.
  try{await settle(gate.release(token,{kind:sourceError==='source_stopped'?'denied':sourceError?'temporary_failure':'success'}))}
  catch(error){gateFailure(error);return}
  if(sourceError){errorCode=sourceError;stopped=sourceError==='source_stopped';if(stopped)snapshot=null;nextCheck=now()+RETRY_INTERVAL_MS}
  else{snapshot=next;errorCode=null;nextCheck=now()+CHECK_INTERVAL_MS}
 }
 async function readOnce(){
  if(stopped)return;
  try{
   const state=await settle(gate.inspect());
   if(state!=='idle'){gateFailure(new SourceGateError(state==='blocked'?'source_denied':'source_busy'));return}
  }catch(error){gateFailure(error);return}
  if(now()>=nextCheck)await refresh();
 }
 return {async read():Promise<FxPayload>{
  if(pending)await pending;
  else{pending=readOnce();try{await pending}finally{pending=null}}
  return payload();
 }};
}
