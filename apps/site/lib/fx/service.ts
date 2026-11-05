import {fetchEcb,FxSourceError} from './ecb';
import {CHECK_INTERVAL_MS,RETRY_INTERVAL_MS,type FxPayload,type FxSnapshot,type FxErrorCode} from './model';

/** Ephemeral per-isolate cache. No keys, account data, database or disk snapshots. */
export function createFxService(fetcher:typeof fetch=fetch,now:()=>number=Date.now){
 let snapshot:FxSnapshot|null=null,checkedAt:string|null=null,nextCheck=0,errorCode:FxErrorCode|null=null,stopped=false,pending:Promise<void>|null=null;
 const payload=():FxPayload=>({snapshot,source_state:stopped?'stopped':errorCode?(snapshot?'stale':'unavailable'):'available',checked_at:checkedAt,next_check_at:stopped?null:new Date(nextCheck).toISOString(),error_code:errorCode});
 async function refresh(){
  try{
   const next=await fetchEcb(fetcher,now);
   if(snapshot&&next.reference_date<snapshot.reference_date)throw new FxSourceError('source_older');
   snapshot=next;errorCode=null;nextCheck=now()+CHECK_INTERVAL_MS;
  }catch(error){
   errorCode=error instanceof FxSourceError?error.code:'network_error';
   stopped=errorCode==='source_stopped';
   if(stopped)snapshot=null;
   nextCheck=now()+RETRY_INTERVAL_MS;
  }finally{checkedAt=new Date(now()).toISOString()}
 }
 return {async read():Promise<FxPayload>{
  if(stopped)return payload();
  if(pending)await pending;
  else if(now()>=nextCheck){pending=refresh();try{await pending}finally{pending=null}}
  return payload();
 }};
}
export const fxService=createFxService();
