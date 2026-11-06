'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {untilAborted,timerDelay,retryAfterDeadline,absoluteRetryDeadline} from '@/lib/browser-request';
import {REFRESH_MS,replySchema,visibleSnapshot,type CboeReply} from '@/lib/cboe/service-model';
const endpoint='/api/v1/europe/cboe/snapshot';
/** Browser checks only: source ownership, denial and acquisition stay server-side. */
export function useCboeSnapshot(){
 const [reply,setReply]=useState<CboeReply|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[offline,setOffline]=useState(false),[permissionLost,setPermissionLost]=useState(false),[now,setNow]=useState(0),[nextDeadline,setNextDeadline]=useState(0);
 const active=useRef<AbortController|null>(null),mounted=useRef(false),stopped=useRef(false),retryAt=useRef(0);
 const poll=useRef<ReturnType<typeof setTimeout>|null>(null),refreshRef=useRef<()=>Promise<void>>(async()=>{});
 const refresh=useCallback(async()=>{
  if(!mounted.current||active.current||stopped.current||document.visibilityState!=='visible')return;
  if(poll.current)clearTimeout(poll.current);poll.current=null;
  if(Date.now()<retryAt.current){poll.current=setTimeout(()=>void refreshRef.current(),timerDelay(retryAt.current));return;}
  const controller=new AbortController();active.current=controller;setBusy(true);setError(null);setOffline(false);
  const current=()=>mounted.current&&active.current===controller;
  let responseReceived=false;
  const timeout=setTimeout(()=>controller.abort(),50_000);
  try{
   const response=await untilAborted(fetch(endpoint,{credentials:'same-origin',cache:'no-store',redirect:'manual',signal:controller.signal}),controller.signal);
   if(!current())return;
   responseReceived=true;retryAt.current=Math.max(retryAt.current,retryAfterDeadline(response.headers.get('retry-after')));
   // Access-stop headers are authoritative even when a response body stalls.
   if([401,403,407,451].includes(response.status)||response.type==='opaqueredirect'||response.redirected||response.status>=300&&response.status<400){
    stopped.current=true;setPermissionLost(true);setReply(null);void response.body?.cancel().catch(()=>{});return;
   }
   const parsed=replySchema.safeParse(await untilAborted(response.json(),controller.signal));
   if(!parsed.success||![200,503].includes(response.status))throw new Error('invalid_response');
   if(current()){
    stopped.current=parsed.data.status.state==='denied';
    retryAt.current=Math.max(retryAt.current,absoluteRetryDeadline(parsed.data.status.next_retry_at));
    setReply(parsed.data);
   }
  }catch{
   if(current()){
    if(!responseReceived){setOffline(true);setError('连接暂时中断，仅保留本页已核验的限时快照；无法确认来源是否已有更新。');}
    else {setReply(null);setError('无法核验本次回复。旧数值已隐藏，请稍后重试。');}
   }
  }finally{
   clearTimeout(timeout);
   if(current()){
    active.current=null;retryAt.current=Math.max(retryAt.current,Date.now()+REFRESH_MS);setNextDeadline(retryAt.current);setNow(Date.now());setBusy(false);
    if(!stopped.current&&document.visibilityState==='visible')poll.current=setTimeout(()=>void refreshRef.current(),timerDelay(retryAt.current));
   }
  }
 },[]);
 useEffect(()=>{
  mounted.current=true;refreshRef.current=refresh;
  const start=setTimeout(()=>{setNow(Date.now());void refresh();},0),tick=setInterval(()=>setNow(Date.now()),1000);
  // Let admitted work finish under its existing deadline, without starting
  // hidden successors or claiming that hiding cancels the provider acquisition.
  const visibility=()=>{setNow(Date.now());if(poll.current)clearTimeout(poll.current);poll.current=null;if(document.visibilityState==='visible')void refresh();};
  document.addEventListener('visibilitychange',visibility);
  return()=>{mounted.current=false;active.current?.abort();active.current=null;clearTimeout(start);clearInterval(tick);if(poll.current)clearTimeout(poll.current);poll.current=null;document.removeEventListener('visibilitychange',visibility);};
 },[refresh]);
 const snapshot=visibleSnapshot(reply,now),state=reply?.status.state;
 const stale=!!snapshot&&(offline||state==='stale'||now-Date.parse(snapshot.fetchedAt)>REFRESH_MS);
 return {reply,snapshot,state,busy,error,offline,permissionLost,now,nextDeadline,stale,refresh,canRefresh:!busy&&!permissionLost&&state!=='denied'&&now>=nextDeadline};
}
