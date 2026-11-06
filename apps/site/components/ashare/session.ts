import {BrowserTimeoutError,createEvidenceClient,retryAt,type WireReply} from './client';
import {isSourceStopped} from '@/lib/ashare/recovery';
// A browser-to-application wait limit, separate from the server's 20s source
// budget. It never settles a source lease, changes backoff, or proves an outcome.
export const BROWSER_REQUEST_TIMEOUT_MS=35_000;
export function createEvidenceSession(){
 let active:AbortController|null=null;
 const client=createEvidenceClient(async({scope,ifNoneMatch})=>{
  active?.abort();const controller=new AbortController();active=controller;
  let retryNotBefore:number|undefined;
  let timer:ReturnType<typeof setTimeout>|undefined,stop:()=>void=()=>{};
  const interrupted=new Promise<never>((_resolve,reject)=>{
   stop=()=>reject(controller.signal.reason);
   controller.signal.addEventListener('abort',stop,{once:true});
   timer=setTimeout(()=>controller.abort(new BrowserTimeoutError(retryNotBefore)),BROWSER_REQUEST_TIMEOUT_MS);
  });
  const read=async():Promise<WireReply>=>{
   const key=scope.kind==='industry_rank'?'level1':scope.fs.slice(2);
   const response=await fetch(`/api/v1/ashare/snapshot?scope=${encodeURIComponent(key)}`,{signal:controller.signal,cache:'no-store',headers:ifNoneMatch?{'If-None-Match':ifNoneMatch}:{}});
   if(controller.signal.aborted)throw controller.signal.reason;
   const reply:WireReply={refreshAfter:response.headers.get('x-ashare-refresh-after')||undefined,errorCode:response.headers.get('x-ashare-error-code')||undefined,recoveryMode:response.headers.get('x-ashare-recovery')||undefined,retryAfter:response.headers.get('retry-after')||undefined,status:response.status,etag:response.headers.get('etag')||undefined};
   if(reply.retryAfter)retryNotBefore=retryAt(reply.retryAfter,Date.now());
   // Known authorization/stop headers are sufficient to clear evidence. Do not
   // hide them behind a slow body, or turn them into a retryable browser timeout.
   if(response.status===304||response.status===401||response.status===403||reply.recoveryMode==='stopped'||isSourceStopped(reply.errorCode??'')){
    void response.body?.cancel().catch(()=>{});
    return reply;
   }
   return {...reply,payload:await response.json().catch(()=>undefined)};
  };
  try{return await Promise.race([read(),interrupted]);}
  finally{
   if(timer!==undefined)clearTimeout(timer);
   controller.signal.removeEventListener('abort',stop);
   if(active===controller)active=null;
  }
 });
 return {client,cancel:()=>active?.abort()};
}
