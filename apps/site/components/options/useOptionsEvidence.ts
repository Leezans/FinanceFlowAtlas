'use client';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {replySchema,visibleSnapshot,REFRESH_MS,type OptionsReply} from '@/lib/options/model';
import type {DeribitInputSchema} from '@/lib/evidence/deribit-projection';
export function useOptionsEvidence(){
 const [data,setData]=useState<OptionsReply|null>(null),[now,setNow]=useState(0),[loading,setLoading]=useState(false),[problem,setProblem]=useState(''),[stopped,setStopped]=useState(false);
 const [inputSchema,setInputSchema]=useState<DeribitInputSchema|null>(null);
 const active=useRef<AbortController|null>(null),mounted=useRef(false),blocked=useRef(false),poll=useRef<ReturnType<typeof setTimeout>|null>(null),run=useRef<()=>Promise<void>>(async()=>{});
 const refresh=useCallback(async()=>{
  if(active.current||blocked.current||document.visibilityState!=='visible')return;
  if(poll.current)clearTimeout(poll.current);
  const controller=new AbortController();active.current=controller;
  const current=()=>mounted.current&&active.current===controller;
  setLoading(true);const timeout=setTimeout(()=>controller.abort(),20_000);
  try{
   const response=await fetch('/api/v1/options/deribit/snapshot',{credentials:'same-origin',cache:'no-store',redirect:'manual',signal:controller.signal});
   if(!current())return;
   if(response.status===401||response.status===403||response.redirected||response.type==='opaqueredirect'||response.status>=300&&response.status<400){blocked.current=true;setStopped(true);setData(null);setProblem('展示权限已失效');return;}
   let result:OptionsReply,wireSchema:DeribitInputSchema|null;
   try{const payload:unknown=await response.json();result=replySchema.parse(payload);if(response.status!==200&&response.status!==503)throw new Error('status');
    // Capture the actual wire schema before the existing legacy reader normalizes it.
    wireSchema=(payload as {snapshot:{schema:DeribitInputSchema}|null}).snapshot?.schema??null;
   }
   catch(error){if(!current())return;if(response.status>=500)throw error;setData(null);setProblem('响应数据未通过校验，已清空浏览器行情。');return;}
   if(!current())return;
   if(result.status.state==='denied'){blocked.current=true;setStopped(true);setData(null);setProblem('来源访问已停止');}
   else{setData(result);setInputSchema(wireSchema);setProblem('');}
  }catch{if(current())setProblem('更新失败 · 上次有效快照已陈旧');}
  finally{clearTimeout(timeout);if(current()){setNow(Date.now());setLoading(false);active.current=null;if(!blocked.current&&document.visibilityState==='visible')poll.current=setTimeout(()=>void run.current(),REFRESH_MS);}}
 },[]);
 useEffect(()=>{
  mounted.current=true;run.current=refresh;
  const start=setTimeout(()=>{setNow(Date.now());void refresh();},0),tick=setInterval(()=>setNow(Date.now()),1000);
  const visibility=()=>{setNow(Date.now());if(poll.current)clearTimeout(poll.current);if(document.visibilityState==='visible')void refresh();};
  document.addEventListener('visibilitychange',visibility);
  return()=>{mounted.current=false;clearTimeout(start);clearInterval(tick);if(poll.current)clearTimeout(poll.current);document.removeEventListener('visibilitychange',visibility);active.current?.abort();active.current=null;};
 },[refresh]);
 // The selector still runs each tick. Only memoize the identical active row set,
 // so an unchanged one-second clock does not rebuild the complete local Blob.
 const visible=visibleSnapshot(data,now),activeInstruments=visible?.rows.map(row=>row.instrument).join('|')??'';
 const snapshot=useMemo(()=>{
  if(!data?.snapshot||!activeInstruments)return null;
  const names=new Set(activeInstruments.split('|'));
  return {...data.snapshot,rows:data.snapshot.rows.filter(row=>names.has(row.instrument))};
 },[data,activeInstruments]);
 const stale=!!snapshot&&(!!problem||data?.status.state==='stale'||now-Date.parse(snapshot.fetched_at)>REFRESH_MS||now-Date.parse(snapshot.source_as_of)>REFRESH_MS);
 const provenance=useMemo(()=>({input_schema:inputSchema,source_instrument_count:data?.snapshot?.rows.length??null}),[inputSchema,data]);
 const validateDownload=()=>{
  const current=Date.now(),eligible=visibleSnapshot(data,current);
  const currentStale=!!eligible&&(!!problem||data?.status.state==='stale'||current-Date.parse(eligible.fetched_at)>REFRESH_MS||current-Date.parse(eligible.source_as_of)>REFRESH_MS);
  // A suspended tab can miss a tick. Withdraw a file containing even one newly
  // expired instrument, not only a fully expired snapshot, before the browser saves it.
  const allowed=!blocked.current&&!!eligible&&eligible.rows.map(row=>row.instrument).join('|')===activeInstruments&&currentStale===stale;
  if(!allowed)setNow(current);
  return allowed;
 };
 return {snapshot,loading,problem,blocked:stopped,refresh,stale,provenance,validateDownload};
}
