'use client';
import React,{useCallback,useEffect,useRef,useState} from 'react';
import {KRAKEN_DOCS,MAX_CACHE_AGE_MS,REFRESH_MS,type KrakenReply,type KrakenSnapshot} from '@/lib/crypto/kraken';
import s from './crypto.module.css';
export function visibleSnapshot(reply:KrakenReply|null,now:number):KrakenSnapshot|null{
 const snapshot=reply?.snapshot;if(!snapshot||reply.status.state==='denied'||reply.status.state==='unavailable')return null;
 const age=now-Date.parse(snapshot.fetched_at);return Number.isFinite(age)&&age>=0&&age<=MAX_CACHE_AGE_MS?snapshot:null;
}
const number=(value:string|number)=>{const [whole,fraction='']=String(value).split('.'),tail=fraction.replace(/0+$/,'');return whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')+(tail?'.'+tail:'');};
function timestamp(value:string|null){return value?value.replace('T',' ').replace('Z',' UTC'):'未提供';}
export default function KrakenSpot(){
 const [data,setData]=useState<KrakenReply|null>(null),[loading,setLoading]=useState(false),[networkError,setNetworkError]=useState(false),[now,setNow]=useState(0);
 const active=useRef<AbortController|null>(null),mounted=useRef(false),blocked=useRef(false);
 const refresh=useCallback(async()=>{
  if(active.current||blocked.current)return;
  const controller=new AbortController();active.current=controller;setLoading(true);
  const timeout=setTimeout(()=>controller.abort(),20_000);
  try{
   const response=await fetch('/api/v1/crypto/kraken/snapshot',{credentials:'same-origin',cache:'no-store',signal:controller.signal});
   const result=await response.json() as KrakenReply;
   if(!result.status||!['available','stale','unavailable','denied'].includes(result.status.state)||!Object.hasOwn(result,'snapshot'))throw new Error('invalid_response');
   if(mounted.current&&active.current===controller){blocked.current=result.status.state==='denied';setData(result);setNetworkError(false);setNow(Date.now());}
  }catch{if(mounted.current&&active.current===controller){setNetworkError(true);setNow(Date.now());}}
  finally{clearTimeout(timeout);if(active.current===controller){active.current=null;if(mounted.current)setLoading(false);}}
 },[]);
 useEffect(()=>{
  mounted.current=true;
  const start=setTimeout(()=>{setNow(Date.now());void refresh();},0);
  const tick=setInterval(()=>setNow(Date.now()),10_000);
  const poll=setInterval(()=>{if(document.visibilityState==='visible')void refresh();},REFRESH_MS);
  const visible=()=>{setNow(Date.now());if(document.visibilityState==='visible')void refresh();};
  document.addEventListener('visibilitychange',visible);
  return()=>{mounted.current=false;clearTimeout(start);clearInterval(tick);clearInterval(poll);document.removeEventListener('visibilitychange',visible);active.current?.abort();active.current=null;};
 },[refresh]);
 const snapshot=visibleSnapshot(data,now),age=snapshot?Math.max(0,now-Date.parse(snapshot.fetched_at)):null;
 const stale=!!snapshot&&(networkError||data?.status.state==='stale'||age!>REFRESH_MS);
 const denied=data?.status.state==='denied';
 return <main className={s.root}>
  <header className={s.header}><a href="/markets">◉ Finance Flow Atlas</a><nav aria-label="资产导航"><a href="/ashare">A 股优先入口</a><a href="/markets">全球市场</a></nav></header>
  <section className={s.intro}><p className={s.eyebrow}>CRYPTO / KRAKEN SPOT</p><h1>虚拟货币，先看清数据。</h1><p>BTC/USD 与 ETH/USD · Kraken 单一交易所现货行情</p><p className={s.notice}>价格和成交量是交易活动，不是资金净流入。这里不是全球虚拟货币市场总量，也不接入账户或交易功能。</p></section>
  <section className={s.status} aria-live="polite" aria-label="行情获取状态"><div><strong>{denied?'来源访问已停止':loading&&!snapshot?'正在获取公开行情':snapshot?stale?'上次有效快照 · 已陈旧':'已获取来源快照':'暂无可验证行情'}</strong><p>{denied?'来源拒绝访问后不会自动重试，也不更换访问路径。':networkError?'本次连接失败；只保留未超过 15 分钟的上次有效快照。':data?.status.error_code?'本次来源检查未成功；不填入零值或模拟数据。':'每 60 秒检查一次。获取时间不等于成交时间或实时保证。'}</p>{data?.status.error_code&&<code>{data.status.error_code}</code>}</div><button onClick={()=>void refresh()} disabled={loading||denied}>{loading?'正在检查…':'检查更新'}</button></section>
  <div className={s.times}><span>最近成功获取 <b>{timestamp(snapshot?.fetched_at??data?.status.fetched_at??null)}</b></span><span>快照年龄 <b>{age===null?'无可展示快照':`${Math.floor(age/1000)} 秒`}</b></span><span>来源成交时间 <b>接口未提供 · 延迟未知</b></span></div>
  {snapshot?<section className={s.grid} aria-label="Kraken 现货交易对">{snapshot.rows.map(row=><article className={s.card} key={row.pair}><div className={s.pair}><h2>{row.pair}</h2><span>Kraken · 现货</span></div><p className={s.label}>最近一笔成交价格 · USD</p><p className={s.price}>{number(row.last_price_usd)} <small>USD</small></p><dl><div><dt>滚动 24 小时成交量</dt><dd>{number(row.volume_base_24h)} <small>{row.base}</small></dd></div><div><dt>滚动 24 小时成交均价</dt><dd>{number(row.vwap_usd_24h)} <small>USD</small></dd></div><div><dt>滚动 24 小时成交笔数</dt><dd>{number(row.trades_24h)} <small>笔</small></dd></div><div><dt>资金净流入</dt><dd className={s.missing}>此来源不提供</dd></div><div><dt>未平仓量（OI）</dt><dd className={s.missing}>现货不适用</dd></div></dl></article>)}</section>:<section className={s.empty}><h2>没有数据时，就留空。</h2><p>只有两组交易对均通过校验才展示。无初始快照、过期、拒绝访问或格式异常都不会替换成示例行情。</p></section>}
  <section className={s.sources}><h2>这些数值，能说明什么？</h2><ul><li>价格以 USD 报价，成交量以各自的 BTC / ETH 数量计量。不能把不同币种的数量直接相加。</li><li>24 小时字段使用来源的滚动窗口，不使用“今天 UTC 零点以来”字段。不推算跨境流向、交易所充值提现或买卖资金净额。</li><li>快照获取成功仅说明接口返回通过校验；接口没有提供这组行情的观测时间。超过 60 秒标记陈旧，超过 15 分钟停止展示。</li><li>公开接口不需要 Kraken 账户或 API 密钥。代码开源不等于行情数据获得再分发许可；本页保留现有个人访问边界。</li></ul><p><a href={KRAKEN_DOCS} target="_blank" rel="noreferrer">Kraken 官方字段说明 ↗</a><a href="https://support.kraken.com/articles/360000919986-public-endpoint-examples-you-can-try-them-directly-in-a-web-browser-" target="_blank" rel="noreferrer">公开接口与账户要求 ↗</a><a href="https://docs-legacy.kraken.com/api/docs/guides/global-intro/" target="_blank" rel="noreferrer">API 使用条件 ↗</a></p></section>
 </main>;
}
