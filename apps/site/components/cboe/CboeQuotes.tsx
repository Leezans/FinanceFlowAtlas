'use client';
import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import MatrixHeatmap from '@/components/matrix/MatrixHeatmap';
import {cboeMatrixGroups} from '@/lib/cboe/matrix';
import {REFRESH_MS,replySchema,visibleSnapshot,type CboeReply} from '@/lib/cboe/service-model';
import s from './cboe.module.css';
const endpoint='/api/v1/europe/cboe/snapshot';
const when=(value:string|null|undefined)=>value?`${value.replace('T',' ').replace('Z','')} UTC`:'未提供';
export default function CboeQuotes(){
 const [reply,setReply]=useState<CboeReply|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[now,setNow]=useState(0);
 const [currency,setCurrency]=useState(''),[query,setQuery]=useState('');
 const active=useRef<AbortController|null>(null),mounted=useRef(false),stopped=useRef(false);
 const refresh=useCallback(async()=>{
  if(active.current||stopped.current)return;
  const controller=new AbortController();active.current=controller;setBusy(true);setError(null);
  const timeout=setTimeout(()=>controller.abort(),50_000);
  try{
   const response=await fetch(endpoint,{cache:'no-store',signal:controller.signal});
   const parsed=replySchema.safeParse(await response.json());
   if(!parsed.success||![200,503].includes(response.status))throw new Error('invalid_response');
   if(mounted.current&&active.current===controller){stopped.current=parsed.data.status.state==='denied';setReply(parsed.data);setNow(Date.now());}
  }catch{
   if(mounted.current&&active.current===controller){setReply(null);setError('无法核验本次回复。旧数值已隐藏，请稍后重试。');}
  }finally{clearTimeout(timeout);if(active.current===controller){active.current=null;if(mounted.current)setBusy(false);}}
 },[]);
 useEffect(()=>{
  mounted.current=true;queueMicrotask(()=>{if(mounted.current){setNow(Date.now());void refresh();}});
  const timer=setInterval(()=>{setNow(Date.now());if(document.visibilityState==='visible')void refresh();},REFRESH_MS);
  const tick=setInterval(()=>setNow(Date.now()),1000);
  const visibility=()=>{if(document.visibilityState==='visible'){setNow(Date.now());void refresh();}else active.current?.abort();};
  document.addEventListener('visibilitychange',visibility);
  return()=>{mounted.current=false;active.current?.abort();active.current=null;clearInterval(timer);clearInterval(tick);document.removeEventListener('visibilitychange',visibility);};
 },[refresh]);
 const snapshot=visibleSnapshot(reply,now),state=reply?.status.state;
 const rows=useMemo(()=>snapshot?.rows.filter(row=>(!currency||row.currency===currency)&&(!query.trim()||row.isin.includes(query.trim().toUpperCase())))??[],[snapshot,currency,query]);
 const groups=useMemo(()=>cboeMatrixGroups(rows),[rows]);
 const currencies=[...new Set(snapshot?.rows.map(row=>row.currency)??[])].sort();
 const next=reply?.status.next_retry_at?Date.parse(reply.status.next_retry_at):0;
 const canRefresh=!busy&&state!=='denied'&&(!next||now>=next);
 const age=snapshot?.latestPublicationTime?Math.max(0,Math.floor((now-Date.parse(snapshot.latestPublicationTime))/60_000)):null;
 return <main className={s.root}>
  <header className={s.header}><p className={s.eyebrow}>EUROPE · DELAYED TRADE PRICES</p><h1>欧洲延迟成交价矩阵</h1><p>股票及 ETF · Cboe BXE 的部分交易 · 至少延迟 15 分钟</p></header>
  <section className={s.notice} aria-label="欧洲价格数据口径"><strong>这是成交价格，不是资金净流入</strong><p>只检查来源最近公布的 5 个分钟文件，每分钟尝试更新。按币种分组，使用 ISIN 识别证券；不推断发行人国家、上市国家或行业。没有全欧洲或全国市场覆盖声明。</p><p>只保留 BATE、BATD、BATP 场内符合条件的成交，过滤非价格形成、延后报告及有撤销或更正疑点的证券。没有可靠日收盘基准，不计算日涨跌，也不把价格作为金额面积。</p></section>
  <section className={s.controls} aria-label="欧洲报价筛选">
   <label>币种<select value={currency} onChange={e=>setCurrency(e.target.value)}><option value="">全部币种</option>{currency&&!currencies.includes(currency)&&<option value={currency}>{currency} · 当前无观测</option>}{currencies.map(value=><option key={value}>{value}</option>)}</select></label>
   <label>证券 ISIN<input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="输入 ISIN"/></label>
   <button type="button" disabled={!canRefresh} onClick={()=>void refresh()}>{busy?'正在检查…':'检查更新'}</button>
  </section>
  <section className={s.status} aria-live="polite" aria-label="欧洲来源时点与状态">
   <strong>{error?'回复核验失败':busy?'正在检查来源':state==='denied'?'来源拒绝访问，已停止请求':state==='stale'?'保留上次快照，尚未成功更新':snapshot?'来源检查成功':'暂无可核验快照'}</strong>
   {error&&<p role="alert">{error}</p>}
   {reply?.status.error_code&&<p>状态代码：{reply.status.error_code}</p>}
   <dl><div><dt>抓取完成</dt><dd>{when(snapshot?.fetchedAt)}</dd></div><div><dt>最近源端发布</dt><dd>{when(snapshot?.latestPublicationTime)}{age!==null?` · ${age} 分钟前`:''}</dd></div><div><dt>下次可检查</dt><dd>{state==='denied'?'已停止':when(reply?.status.next_retry_at)}</dd></div></dl>
   {snapshot&&<><p>已检查 {snapshot.sampledFiles.length} 个文件，发布窗口 {when(snapshot.windowStart)} 至 {when(snapshot.windowEnd)}（结束时刻不含）。有间隔的文件不会补成连续覆盖。</p><p>{snapshot.coverage.rawRows.toLocaleString()} 条源记录，{snapshot.coverage.rejectedRows.toLocaleString()} 条不满足显示条件，{snapshot.rows.length.toLocaleString()} 个证券 / 币种价格；筛选后显示 {rows.length.toLocaleString()} 项。抓取成功不代表刚刚成交。</p><details><summary>查看本次来源文件</summary><ul>{snapshot.sampledFiles.map(file=><li key={file}>{file}</li>)}</ul></details></>}
  </section>
  <MatrixHeatmap groups={groups} title="Cboe BXE · 延迟成交价" description="最近已下载窗口内，每个 ISIN / 币种最近一笔符合条件的成交。不是交易所当前最优报价。" colorMode="neutral" colorMeaning="中性显示；不推断涨跌或资金方向。" areaMeaning="等宽信息卡；价格不代表金额面积。" emptyTitle={snapshot?'当前文件窗口没有可显示的价格':'延迟价格暂不可用'} emptyMessage={snapshot?'可能是已收市后的非价格形成报告，或当前筛选无结果。不会把这类报告、零价格或旧文件伪装成实时行情。':'等待通过核验的独立来源；不填入模拟价格。'} emptyNote="免费、无需账户；源端至少延迟 15 分钟，网络与缓存可能增加延迟。" scopeKey={`${snapshot?.windowStart??'none'}/${currency}/${query}`}/>
  <footer className={s.footer}><p>© Cboe。仅供所有者私人、内部信息研究使用，不提供公开数据分发，不构成投资建议。</p><a href="https://www.cboe.com/markets/eu/equities/transparency-data/" target="_blank" rel="noreferrer">官方延迟数据与免责声明</a><a href="https://cdn.cboe.com/resources/participant_resources/Cboe_Europe_Data_Policy_August_2026.pdf" target="_blank" rel="noreferrer">Cboe 数据使用政策</a><a href="/markets">返回各国资金流入口</a></footer>
 </main>;
}
