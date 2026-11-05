'use client';
import React,{useCallback,useEffect,useRef,useState} from 'react';
import {KRAKEN_DOCS,KRAKEN_PAIRS_DOCS,REFRESH_MS,type KrakenReply} from '@/lib/crypto/kraken';
import s from './crypto.module.css';
import KrakenMatrix from './KrakenMatrix';
import {validateKrakenReply,visibleSnapshot} from './client';
export {validateKrakenReply,visibleSnapshot} from './client';

function timestamp(value:string|null){return value?value.replace('T',' ').replace('Z',' UTC'):'未提供';}
export default function KrakenSpot(){
 const [data,setData]=useState<KrakenReply|null>(null),[loading,setLoading]=useState(false),[networkError,setNetworkError]=useState(false),[permissionLost,setPermissionLost]=useState(false),[invalidResponse,setInvalidResponse]=useState(false),[now,setNow]=useState(0);
 const poll=useRef<ReturnType<typeof setTimeout>|null>(null),refresher=useRef<()=>Promise<void>>(async()=>{});
 const active=useRef<AbortController|null>(null),mounted=useRef(false),blocked=useRef(false);
 const refresh=useCallback(async()=>{
  if(active.current||blocked.current)return;
  if(poll.current)clearTimeout(poll.current);poll.current=null;
  const controller=new AbortController();active.current=controller;setLoading(true);
  const timeout=setTimeout(()=>controller.abort(),20_000);
  try{
   const response=await fetch('/api/v1/crypto/kraken/snapshot',{credentials:'same-origin',cache:'no-store',signal:controller.signal});
   if(response.status===401||response.status===403){
    if(mounted.current&&active.current===controller){blocked.current=true;setData(null);setPermissionLost(true);setNetworkError(false);setInvalidResponse(false);setNow(Date.now());}
    return;
   }
   let result:KrakenReply;
   try{result=validateKrakenReply(await response.json());if(response.redirected||response.status!==200&&response.status!==503)throw new Error('invalid_response');}
   catch(error){
    // Only a temporary HTTP failure may retain the already validated snapshot.
    if(response.status>=500&&response.status<=599)throw error;
    if(mounted.current&&active.current===controller){setData(null);setInvalidResponse(true);setNetworkError(false);setNow(Date.now());}
    return;
   }
   if(mounted.current&&active.current===controller){blocked.current=result.status.state==='denied';setData(result);setNetworkError(false);setInvalidResponse(false);setNow(Date.now());}
  }catch{if(mounted.current&&active.current===controller){setNetworkError(true);setNow(Date.now());}}
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
 const snapshot=visibleSnapshot(data,now),age=snapshot?Math.max(0,now-Date.parse(snapshot.fetched_at)):null;
 const stale=!!snapshot&&(networkError||data?.status.state==='stale'||age!>REFRESH_MS);
 const denied=data?.status.state==='denied';
 return <main className={s.root}>
  <header className={s.header}><a href="/markets">◉ Finance Flow Atlas</a><nav aria-label="资产导航"><a href="/ashare">A 股优先入口</a><a href="/markets">全球市场</a></nav></header>
  <section className={s.intro}><p className={s.eyebrow}>CRYPTO / KRAKEN SPOT</p><h1>虚拟货币，先看清数据。</h1><p>Kraken · USD 报价现货交易对矩阵</p><p className={s.notice}>价格和成交量是交易活动，不是资金净流入。这里不是全球虚拟货币市场总量，也不接入账户或交易功能。</p></section>
  <section className={s.status} aria-live="polite" aria-label="行情获取状态"><div><strong>{permissionLost?'展示权限已失效':denied?'来源访问已停止':loading&&!snapshot?'正在获取公开行情':snapshot?stale?'上次有效快照 · 已陈旧':'已获取来源快照':'暂无可验证行情'}</strong><p>{permissionLost?'已清空浏览器行情并停止检查；请恢复登录或合法展示权限。':invalidResponse?'响应数据未通过校验，已清空浏览器行情。':denied?'来源拒绝访问后不会自动重试，也不更换访问路径。':networkError?'本次连接失败；只保留未超过 15 分钟的上次有效快照。':data?.status.error_code?'本次来源检查未成功；不填入零值或模拟数据。':'行情每 60 秒检查一次，交易对目录最多每 15 分钟检查。获取时间不等于成交时间或实时保证。'}</p>{data?.status.error_code&&<code>{data.status.error_code}</code>}</div><button onClick={()=>void refresh()} disabled={loading||denied||permissionLost}>{loading?'正在检查…':'检查更新'}</button></section>
  <div className={s.times}><span>最近成功获取 <b>{timestamp(snapshot?.fetched_at??data?.status.fetched_at??null)}</b></span><span>快照年龄 <b>{age===null?'无可展示快照':`${Math.floor(age/1000)} 秒`}</b></span><span>来源成交时间 <b>接口未提供 · 延迟未知</b></span></div>
  {snapshot&&<p className={s.matrixNote}>目录获取时间：{timestamp(snapshot.catalog_fetched_at)} · 目录中 {snapshot.universe_pair_count} 组在线 USD 现货交易对，已核验 {snapshot.rows.length} 组。只代表此交易所与此报价币种，不代表全市场覆盖。</p>}
  <KrakenMatrix snapshot={snapshot}/>
  <section className={s.sources}><details><summary>来源、指标与使用边界</summary><ul><li>价格以 USD 报价，成交量以各自基础币种的数量计量。不能把不同币种的数量直接相加。</li><li>24 小时字段使用来源的滚动窗口，不使用“今天 UTC 零点以来”字段。不推算跨境流向、交易所充值提现或买卖资金净额。</li><li>快照获取成功仅说明接口返回通过校验；接口没有提供这组行情的观测时间。超过 60 秒标记陈旧，超过 15 分钟停止展示。</li><li>公开接口不需要 Kraken 账户或 API 密钥。代码开源不等于行情数据获得再分发许可；本页保留现有个人访问边界。</li></ul></details><p><a href={KRAKEN_PAIRS_DOCS} target="_blank" rel="noreferrer">Kraken 官方交易对目录 ↗</a><a href={KRAKEN_DOCS} target="_blank" rel="noreferrer">Kraken 官方字段说明 ↗</a><a href="https://support.kraken.com/articles/360000919986-public-endpoint-examples-you-can-try-them-directly-in-a-web-browser-" target="_blank" rel="noreferrer">公开接口与账户要求 ↗</a><a href="https://docs-legacy.kraken.com/api/docs/guides/global-intro/" target="_blank" rel="noreferrer">API 使用条件 ↗</a></p></section>
 </main>;
}
