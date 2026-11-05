'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {replySchema,REFRESH_MS,visibleSnapshot,type PolymarketReply,type PolymarketView} from '@/lib/polymarket/model';
type SnapshotError='network'|'invalid'|'permission'|'gate'|'cooldown'|null;
const emptyReplies=():Record<PolymarketView,PolymarketReply|null>=>({hot:null,newest:null});
/** One browser request/cooldown across modes; evidence and controls never cross modes. */
export function useSnapshot(view:PolymarketView='hot'){
 const [replies,setReplies]=useState(emptyReplies),[now,setNow]=useState(0),[loading,setLoading]=useState(false);
 const [errors,setErrors]=useState<Record<PolymarketView,SnapshotError>>({hot:null,newest:null}),[globalError,setGlobalError]=useState<SnapshotError>(null),[denied,setDenied]=useState(false);
 const selected=useRef(view);
 const retryAt=useRef(0),[retryDeadline,setRetryDeadline]=useState(0);
 const mounted=useRef(false),blocked=useRef(false),active=useRef<AbortController|null>(null),poll=useRef<ReturnType<typeof setTimeout>|null>(null),refreshRef=useRef<()=>Promise<void>>(async()=>{});
 const refresh=useCallback(async()=>{
  if(active.current||blocked.current||!mounted.current||document.visibilityState!=='visible')return;
  if(poll.current)clearTimeout(poll.current);poll.current=null;
  if(Date.now()<retryAt.current){poll.current=setTimeout(()=>void refreshRef.current(),retryAt.current-Date.now());return;}
  const requested=selected.current,controller=new AbortController();active.current=controller;setLoading(true);
  const current=()=>mounted.current&&active.current===controller;
  const clearAll=(error:SnapshotError)=>{setReplies(emptyReplies());setGlobalError(error);};
  const setError=(error:SnapshotError)=>setErrors(previous=>({...previous,[requested]:error}));
  const timeout=setTimeout(()=>controller.abort(),20_000);
  try{
   const response=await fetch(`/api/v1/polymarket/snapshot?view=${requested}`,{method:'GET',credentials:'same-origin',cache:'no-store',signal:controller.signal});
   if(!current())return;
   if(response.status===401||response.status===403){blocked.current=true;setDenied(true);clearAll('permission');return;}
   let result:PolymarketReply;
   try{result=replySchema.parse(await response.json());if(response.redirected||(response.status!==200&&response.status!==503))throw new Error('invalid');}
   catch(e){if(response.status>=500&&response.status<=599)throw e;if(current()){setReplies(previous=>({...previous,[requested]:null}));setError('invalid');}return;}
   if(!current())return;
   blocked.current=result.status.state==='denied'||result.status.error_code==='source_denied';setDenied(blocked.current);
   retryAt.current=Math.max(retryAt.current,result.status.next_retry_at?Date.parse(result.status.next_retry_at):0);
   const gateUnknown=['source_busy','source_gate_unavailable','source_gate_outcome_unconfirmed','source_stale_lease','source_denied'].includes(result.status.error_code??'');
   if(blocked.current||gateUnknown){clearAll('gate');}
   else if(result.snapshot&&(requested==='hot')!==(result.snapshot.schema==='polymarket-gamma/hot/1')){setReplies(previous=>({...previous,[requested]:null}));setError('invalid');}
   else if(result.status.error_code==='source_cooldown'){setError('cooldown');setGlobalError(null);}
   else if(response.status>=500&&result.status.state==='unavailable'){setError('network');}
   else{setReplies(previous=>({...previous,[requested]:result}));setError(null);setGlobalError(null);}
  }catch{if(current())setError('network');}
  finally{clearTimeout(timeout);if(current()){active.current=null;retryAt.current=Math.max(retryAt.current,Date.now()+REFRESH_MS);setRetryDeadline(retryAt.current);setNow(Date.now());setLoading(false);if(!blocked.current&&document.visibilityState==='visible')poll.current=setTimeout(()=>void refreshRef.current(),retryAt.current-Date.now());}}
 },[]);
 useEffect(()=>{
  mounted.current=true;refreshRef.current=refresh;
  const start=setTimeout(()=>{setNow(Date.now());void refresh();},0);
  const tick=setInterval(()=>setNow(Date.now()),1000);
  const visible=()=>{setNow(Date.now());if(poll.current)clearTimeout(poll.current);poll.current=null;if(document.visibilityState==='visible')void refresh();};
  document.addEventListener('visibilitychange',visible);
  return()=>{mounted.current=false;clearTimeout(start);clearInterval(tick);if(poll.current)clearTimeout(poll.current);document.removeEventListener('visibilitychange',visible);active.current?.abort();active.current=null;};
 },[refresh]);
 useEffect(()=>{selected.current=view;const start=setTimeout(()=>void refresh(),0);return()=>clearTimeout(start);},[view,refresh]);
 const reply=replies[view],error=globalError??errors[view],snapshot=visibleSnapshot(reply,now),age=snapshot?now-Date.parse(snapshot.fetched_at):null;
 return {reply,snapshot,age,loading,error,refresh,coolingDown:now<retryDeadline,denied,stale:!!snapshot&&(error==='network'||reply?.status.state==='stale'||age!>REFRESH_MS)};
}
