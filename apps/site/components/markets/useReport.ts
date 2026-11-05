'use client';
import {useCallback,useEffect,useRef,useState} from 'react';

/** Browser lifecycle shared by independently validated official report views. */
export function useReport<T extends {status:{state:string}}>(url:string, parse:(value:unknown)=>T, refreshMs:number) {
  const [reply,setReply]=useState<T|null>(null),[loading,setLoading]=useState(false),[failure,setFailure]=useState<'network'|'permission'|'invalid'|null>(null),[now,setNow]=useState(0);
  const controller=useRef<AbortController|null>(null),mounted=useRef(false),blocked=useRef(false);
  const refresh=useCallback(async()=>{
    if(controller.current||blocked.current)return;
    const active=new AbortController();controller.current=active;setLoading(true);
    const timer=setTimeout(()=>active.abort(),30_000);
    const current=()=>mounted.current&&controller.current===active;
    try {
      const response=await fetch(url,{signal:active.signal,cache:'no-store',credentials:'same-origin',redirect:'manual'});
      if([401,403].includes(response.status)||response.type==='opaqueredirect'||response.redirected||response.status>=300&&response.status<400){
        if(current()){blocked.current=true;setReply(null);setFailure('permission');}return;
      }
      let parsed:T;
      try { parsed=parse(await response.json()); if(![200,503].includes(response.status))throw new Error('invalid_response'); }
      catch(error){if(response.status>=500&&response.status<=599)throw error;if(current()){setReply(null);setFailure('invalid');}return;}
      if(current()){blocked.current=parsed.status.state==='denied';setReply(parsed);setFailure(null);setNow(Date.now());}
    }catch {if(current()){setFailure('network');setNow(Date.now());}}
    finally{clearTimeout(timer);if(controller.current===active){controller.current=null;if(mounted.current)setLoading(false);}}
  },[url,parse]);
  useEffect(()=>{
    mounted.current=true;blocked.current=false;
    const start=setTimeout(()=>{setNow(Date.now());void refresh();},0);
    const tick=setInterval(()=>setNow(Date.now()),30_000);
    const poll=setInterval(()=>{if(document.visibilityState==='visible')void refresh();},refreshMs);
    const visible=()=>{setNow(Date.now());if(document.visibilityState==='visible')void refresh();};
    document.addEventListener('visibilitychange',visible);
    return()=>{mounted.current=false;clearTimeout(start);clearInterval(tick);clearInterval(poll);document.removeEventListener('visibilitychange',visible);controller.current?.abort();controller.current=null;};
  },[refresh,refreshMs]);
  return {reply,loading,failure,now,refresh};
}
