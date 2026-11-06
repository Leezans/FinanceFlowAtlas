'use client';
/** One lifecycle for both consumers of the same gated Kraken endpoint. */
import {useCallback,useEffect,useRef,useState} from 'react';
import {REFRESH_MS,MAX_CACHE_AGE_MS,type KrakenReply} from '@/lib/crypto/kraken';
import {DEFAULT_TRADE_PAIRS as TRADE_PAIRS,tradeSelectionKey as selectionKey,DEFAULT_TRADE_TIMEFRAME,tradeWindowMilliseconds,type TradeTimeframe} from '@/lib/crypto/selection';
import {validateKrakenReply,visibleSnapshot} from './client';

export function useKrakenEvidence(initialPairs:readonly string[]=TRADE_PAIRS){
 const [data,setData]=useState<KrakenReply|null>(null),[loading,setLoading]=useState(false),[networkError,setNetworkError]=useState(false),[permissionLost,setPermissionLost]=useState(false),[invalidResponse,setInvalidResponse]=useState(false),[now,setNow]=useState(0);
 const [selected,setSelected]=useState<string[]>([...initialPairs]),[catalog,setCatalog]=useState<{pairs:string[];fetched:number}|null>(null);
 const [timeframe,setTimeframe]=useState<TradeTimeframe>(DEFAULT_TRADE_TIMEFRAME);
 const scope=useRef<{pairs:string[];timeframe:TradeTimeframe;version:number}>({pairs:[...initialPairs] as string[],timeframe:DEFAULT_TRADE_TIMEFRAME,version:0});
 const poll=useRef<ReturnType<typeof setTimeout>|null>(null),refresher=useRef<()=>Promise<void>>(async()=>{});
 const active=useRef<AbortController|null>(null),mounted=useRef(false),blocked=useRef(false);
 const refresh=useCallback(async()=>{
  // Check at invocation too: initial mounting and an already queued timer can
  // happen while hidden, before a visibilitychange event cancels the timer.
  // This does not cancel admitted work or alter shared source admission.
  if(active.current||blocked.current||document.visibilityState!=='visible')return;
  if(poll.current)clearTimeout(poll.current);poll.current=null;
  const requested={pairs:[...scope.current.pairs],timeframe:scope.current.timeframe,version:scope.current.version};
  const current=()=>mounted.current&&active.current===controller&&scope.current.version===requested.version;
  const controller=new AbortController();active.current=controller;setLoading(true);
  const timeout=setTimeout(()=>controller.abort(),20_000);
  try{
   const query:string[]=[];
   if(selectionKey(requested.pairs)!==selectionKey(TRADE_PAIRS))query.push('pairs='+encodeURIComponent(selectionKey(requested.pairs)));
   if(requested.timeframe!==DEFAULT_TRADE_TIMEFRAME)query.push('window='+requested.timeframe);
   const response=await fetch('/api/v1/crypto/kraken/snapshot'+(query.length?'?'+query.join('&'):''),{credentials:'same-origin',cache:'no-store',signal:controller.signal});
   if(response.status===401||response.status===403){
    if(mounted.current&&active.current===controller){blocked.current=true;setData(null);setCatalog(null);setPermissionLost(true);setNetworkError(false);setInvalidResponse(false);setNow(Date.now());}
    return;
   }
   let result:KrakenReply;
   try{result=validateKrakenReply(await response.json());if(response.redirected||response.status!==200&&response.status!==503)throw new Error('invalid_response');}
   catch(error){
    // Only a temporary HTTP failure may retain the already validated snapshot.
    if(response.status>=500&&response.status<=599)throw error;
    if(current()){setData(null);setCatalog(null);setInvalidResponse(true);setNetworkError(false);setNow(Date.now());}
    return;
   }
   const explicit=selectionKey(requested.pairs)!==selectionKey(TRADE_PAIRS);
   const wrongWindow=result.status.state!=='denied'&&((requested.timeframe!==DEFAULT_TRADE_TIMEFRAME&&result.requested_window!==requested.timeframe)||(result.requested_window!==undefined&&result.requested_window!==requested.timeframe)||(!!result.trade_snapshot&&result.trade_snapshot.window_ms!==tradeWindowMilliseconds(requested.timeframe)));
   if(wrongWindow){
    if(current()){setData(null);setCatalog(null);setInvalidResponse(true);setNetworkError(false);setNow(Date.now());}
    return;
   }
   if(result.snapshot&&(explicit&&!result.requested_pairs||result.requested_pairs&&selectionKey(result.requested_pairs)!==selectionKey(requested.pairs))){
    if(current()){setData(null);setCatalog(null);setInvalidResponse(true);setNetworkError(false);setNow(Date.now());}
    return;
   }
   if(mounted.current&&active.current===controller&&result.status.state==='denied'){blocked.current=true;setData(result);setCatalog(null);setNetworkError(false);setInvalidResponse(false);setNow(Date.now());}
   else if(current()){setData(result);if(result.snapshot)setCatalog({pairs:[...result.snapshot.rows,...result.snapshot.missing].map(row=>row.pair).sort(),fetched:Date.parse(result.snapshot.catalog_fetched_at)});setNetworkError(false);setInvalidResponse(false);setNow(Date.now());}
  }catch{if(current()){setNetworkError(true);setNow(Date.now());}}
  finally{clearTimeout(timeout);if(active.current===controller){active.current=null;if(mounted.current){setLoading(false);if(!blocked.current&&document.visibilityState==='visible')poll.current=setTimeout(()=>void refresher.current(),REFRESH_MS);}}}
 },[]);
 useEffect(()=>{
  mounted.current=true;refresher.current=refresh;
  const start=setTimeout(()=>{setNow(Date.now());void refresh();},0);
  const tick=setInterval(()=>setNow(Date.now()),10_000);
  const visible=()=>{setNow(Date.now());if(poll.current)clearTimeout(poll.current);poll.current=null;if(document.visibilityState==='visible')void refresh();};
  document.addEventListener('visibilitychange',visible);
  return()=>{mounted.current=false;clearTimeout(start);clearInterval(tick);if(poll.current)clearTimeout(poll.current);poll.current=null;document.removeEventListener('visibilitychange',visible);active.current?.abort();active.current=null;};
 },[refresh]);
 const applyScope=(pairs:string[],window:TradeTimeframe)=>{
  if(blocked.current||(selectionKey(pairs)===selectionKey(scope.current.pairs)&&window===scope.current.timeframe))return;
  scope.current={pairs,timeframe:window,version:scope.current.version+1};setSelected(pairs);setTimeframe(window);
  // Quote evidence covers the full venue catalog, independently of trade scope.
  // Preserve its original clock/status while removing all prior-scope trades.
  setData(previous=>{
   if(!previous?.snapshot)return null;
   const next={...previous,trade_snapshot:null};
   if(selectionKey(pairs)===selectionKey(TRADE_PAIRS))delete next.requested_pairs;
   else next.requested_pairs=[...pairs];
   if(window===DEFAULT_TRADE_TIMEFRAME)delete next.requested_window;
   else next.requested_window=window;
   return next;
  });
  setInvalidResponse(false);setNow(Date.now());
  if(document.visibilityState==='visible')void refresh();
 };
 const catalogPairs=catalog&&now>=catalog.fetched&&now-catalog.fetched<=MAX_CACHE_AGE_MS?catalog.pairs:[];
 const snapshot=visibleSnapshot(data,now),age=snapshot?Math.max(0,now-Date.parse(snapshot.fetched_at)):null;
 const stale=!!snapshot&&(networkError||data?.status.state==='stale'||age!>REFRESH_MS);
 const denied=data?.status.state==='denied';
 return {data,loading,networkError,permissionLost,invalidResponse,now,selected,timeframe,catalogPairs,snapshot,age,stale,denied,refresh,applyScope};
}
