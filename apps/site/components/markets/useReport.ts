'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {untilAborted,timerDelay,retryAfterDeadline,absoluteRetryDeadline} from '@/lib/browser-request';
const BROWSER_RETRY_MS=60_000;
/** Browser lifecycle shared by independently validated official report views.
 * Browser recovery checks never reset or shorten the server's source gate. */
export function useReport<T extends {status:{state:string;next_retry_at?:string|null}}>(url:string, parse:(value:unknown)=>T, refreshMs:number) {
  const [reply,setReply]=useState<T|null>(null),[loading,setLoading]=useState(false),[failure,setFailure]=useState<'network'|'permission'|'invalid'|null>(null),[now,setNow]=useState(0),[nextDeadline,setNextDeadline]=useState(0);
  const controller=useRef<AbortController|null>(null),mounted=useRef(false),blocked=useRef(false),retryAt=useRef(0);
  const poll=useRef<ReturnType<typeof setTimeout>|null>(null),refreshRef=useRef<()=>Promise<void>>(async()=>{});
  const refresh=useCallback(async()=>{
    if(!mounted.current||controller.current||blocked.current||document.visibilityState!=='visible')return;
    if(poll.current)clearTimeout(poll.current);poll.current=null;
    if(Date.now()<retryAt.current){poll.current=setTimeout(()=>void refreshRef.current(),timerDelay(retryAt.current));return;}
    const active=new AbortController();controller.current=active;setLoading(true);
    const timer=setTimeout(()=>active.abort(),30_000);
    const current=()=>mounted.current&&controller.current===active;
    let delay=BROWSER_RETRY_MS;
    try {
      const response=await untilAborted(fetch(url,{signal:active.signal,cache:'no-store',credentials:'same-origin',redirect:'manual'}),active.signal);
      if(!current())return;
      retryAt.current=Math.max(retryAt.current,retryAfterDeadline(response.headers.get('retry-after')));
      if([401,403,407,451].includes(response.status)||response.type==='opaqueredirect'||response.redirected||response.status>=300&&response.status<400){
        blocked.current=true;setReply(null);setFailure('permission');void response.body?.cancel().catch(()=>{});return;
      }
      let parsed:T;
      try { parsed=parse(await untilAborted(response.json(),active.signal)); if(![200,503].includes(response.status))throw new Error('invalid_response'); }
      catch(error){if(active.signal.aborted||response.status>=500&&response.status<=599)throw error;if(current()){setReply(null);setFailure('invalid');}return;}
      if(current()){
        blocked.current=parsed.status.state==='denied';
        retryAt.current=Math.max(retryAt.current,absoluteRetryDeadline(parsed.status.next_retry_at));
        // A coordinating server may explicitly allow a near-term check. Only a
        // successful reply without a deadline uses the source's normal cadence.
        if(!parsed.status.next_retry_at&&['available','stale'].includes(parsed.status.state))delay=refreshMs;
        setReply(parsed);setFailure(null);
      }
    }catch {if(current())setFailure('network');}
    finally{
      clearTimeout(timer);
      if(current()){
        controller.current=null;retryAt.current=Math.max(retryAt.current,Date.now()+delay);setNextDeadline(retryAt.current);setNow(Date.now());setLoading(false);
        if(!blocked.current&&document.visibilityState==='visible')poll.current=setTimeout(()=>void refreshRef.current(),timerDelay(retryAt.current));
      }
    }
  },[url,parse,refreshMs]);
  useEffect(()=>{
    mounted.current=true;refreshRef.current=refresh;
    const start=setTimeout(()=>{setNow(Date.now());void refresh();},0);
    const tick=setInterval(()=>setNow(Date.now()),30_000);
    const visible=()=>{setNow(Date.now());if(poll.current)clearTimeout(poll.current);poll.current=null;if(document.visibilityState==='visible')void refresh();};
    document.addEventListener('visibilitychange',visible);
    return()=>{mounted.current=false;clearTimeout(start);clearInterval(tick);if(poll.current)clearTimeout(poll.current);poll.current=null;document.removeEventListener('visibilitychange',visible);controller.current?.abort();controller.current=null;};
  },[refresh]);
  return {reply,loading,failure,now,refresh,nextDeadline,coolingDown:now<nextDeadline};
}
