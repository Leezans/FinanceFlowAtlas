'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {absoluteRetryDeadline,retryAfterDeadline,timerDelay,untilAborted} from '@/lib/browser-request';
import type {TicStatus} from '@/lib/tic/model';
import {POLL_MS} from './model';

class TicFailure extends Error {
 constructor(message:string,readonly clear=false,readonly terminal=false){super(message);}
}
const terminalSource=(value:string|null|undefined)=>value==='denied'||value==='uncertain'||value==='coordination_unavailable';
/** One visible browser lifecycle. Source refusal permits this cached read only;
 * application refusal never permits another endpoint to be acquired. */
export function useTicResource<T>(url:string,parse:(value:unknown)=>T,withStatus=false){
 const [data,setData]=useState<T|null>(null),[status,setStatus]=useState<TicStatus|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[stale,setStale]=useState(false),[stopped,setStopped]=useState(false);
 const state=useRef({mounted:false,id:0,active:null as AbortController|null,data:null as T|null,etag:null as string|null,deferred:null as {status:TicStatus;sourceStopped:boolean}|null,blocked:false,retryAt:0,poll:null as ReturnType<typeof setTimeout>|null});
 const refreshRef=useRef<()=>Promise<void>>(async()=>{});
 const refresh=useCallback(async()=>{
  const s=state.current;
  if(!s.mounted||s.active||s.blocked||document.visibilityState!=='visible')return;
  if(s.poll)clearTimeout(s.poll);s.poll=null;
  if(!s.deferred&&Date.now()<s.retryAt){s.poll=setTimeout(()=>void refreshRef.current(),timerDelay(s.retryAt));return;}
  const controller=new AbortController(),id=++s.id;s.active=controller;setLoading(true);
  const current=()=>s.mounted&&s.id===id&&s.active===controller;
  let timedOut=false,sourceStopped=false;
  const timeout=setTimeout(()=>{timedOut=true;controller.abort();},20_000);
  const read=async(path:string,headers:Record<string,string>={})=>{
   const response=await untilAborted(fetch(path,{signal:controller.signal,cache:'no-store',credentials:'same-origin',redirect:'manual',headers}),controller.signal);
   if(!current()||controller.signal.aborted)throw new Error('Cancelled');
   s.retryAt=Math.max(s.retryAt,retryAfterDeadline(response.headers.get('Retry-After')),absoluteRetryDeadline(response.headers.get('X-Next-Retry-At')));
   if([401,403,407,429,451].includes(response.status)||response.redirected||response.type==='opaqueredirect'||response.status>=300&&response.status<400&&response.status!==304){
    void response.body?.cancel().catch(()=>{});throw new TicFailure(`TIC 访问已停止（HTTP ${response.status}）。`,true,true);
   }
   sourceStopped ||= terminalSource(response.headers.get('X-Source-Status'));
   return response;
  };
  try{
   let nextStatus:TicStatus|null=s.deferred?.status||null;
   sourceStopped=s.deferred?.sourceStopped||false;s.deferred=null;
   if(withStatus&&!nextStatus){
    const response=await read(`${url}/status`);
    if(!response.ok)throw new TicFailure(`TIC status HTTP ${response.status}`);
    nextStatus=await untilAborted(response.json(),controller.signal) as TicStatus;
    if(!current())return;
    if(!nextStatus||!['available','stale','unavailable'].includes(nextStatus.state))throw new TicFailure('TIC 状态未通过核验。',true);
    sourceStopped ||= terminalSource(nextStatus.source_status);
    s.retryAt=Math.max(s.retryAt,absoluteRetryDeadline(nextStatus.next_retry_at));setStatus(nextStatus);
    if(nextStatus.state==='unavailable')throw new TicFailure(nextStatus.error||'TIC 尚无已验证快照。');
   }
   // A completed status is reusable: hiding must not start a second endpoint
   // or repeat a potentially source-triggering status request on return.
   if(nextStatus&&document.visibilityState!=='visible'){s.deferred={status:nextStatus,sourceStopped};return;}
   const response=await read(url,s.data&&s.etag?{'If-None-Match':s.etag}:{});
   let next:T;
   if(response.status===304){if(!s.data)throw new TicFailure('没有可复用的 TIC 快照。',true);next=s.data;}
   else{
    if(!response.ok)throw new TicFailure(`TIC 来源暂不可用（HTTP ${response.status}）。`);
    const body=await untilAborted(response.json(),controller.signal);
    try{next=parse(body);}catch{throw new TicFailure(withStatus?'TIC 快照未通过核验，未显示数值。':'历史快照未通过核验，未显示数值。',true);}
   }
   if(!current()||controller.signal.aborted)return;
   s.data=next;if(response.status!==304)s.etag=response.headers.get('ETag');
   const dataState=response.headers.get('X-Data-Status');
   if(nextStatus&&(dataState==='stale'||dataState==='available'))setStatus({...nextStatus,state:dataState});
   setData(next);setStale(dataState==='stale'||nextStatus?.state==='stale');
   setError(sourceStopped?'TIC 来源访问已停止，显示最后核验快照。':'');
  }catch(e){
   if(current()){
    if(e instanceof TicFailure&&e.clear){s.data=null;s.etag=null;setData(null);setStale(false);}
    // A rejected transport/body has an unknown outcome, unlike a received
    // temporary HTTP response. Never automatically repeat that acquisition.
    if(timedOut||!(e instanceof TicFailure)||e.terminal)s.blocked=true;
    if(!controller.signal.aborted||timedOut){setError(timedOut?'TIC 请求超时，已停止自动重试。':e instanceof Error?e.message:'TIC 请求失败。');if(!(e instanceof TicFailure&&e.clear))s.retryAt=Math.max(s.retryAt,Date.now()+POLL_MS);}
   }
  }finally{
   clearTimeout(timeout);
   if(current()){
    s.blocked ||= sourceStopped&&!s.deferred;s.active=null;setStopped(s.blocked);setLoading(false);
    if(!s.blocked&&document.visibilityState==='visible')s.poll=setTimeout(()=>void refreshRef.current(),timerDelay(Math.max(s.retryAt,Date.now()+POLL_MS)));
   }
  }
 },[url,parse,withStatus]);
 useEffect(()=>{
  const s=state.current;s.mounted=true;refreshRef.current=refresh;
  const start=setTimeout(()=>void refresh(),0);
  const visible=()=>{if(s.poll)clearTimeout(s.poll);s.poll=null;if(document.visibilityState==='visible')void refresh();};
  document.addEventListener('visibilitychange',visible);
  return()=>{s.mounted=false;s.id++;clearTimeout(start);if(s.poll)clearTimeout(s.poll);s.poll=null;document.removeEventListener('visibilitychange',visible);s.active?.abort();s.active=null;};
 },[refresh]);
 return {data,status,error,loading,stale,stopped,refresh};
}
