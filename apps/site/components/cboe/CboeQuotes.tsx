'use client';
import React,{useMemo,useState} from 'react';
import MatrixHeatmap from '@/components/matrix/MatrixHeatmap';
import {cboeMatrixGroups} from '@/lib/cboe/matrix';
import {useCboeSnapshot} from './useCboeSnapshot';
import s from './cboe.module.css';
const when=(value:string|null|undefined)=>value?`${value.replace('T',' ').replace('Z','')} UTC`:'未提供';
export default function CboeQuotes(){
 const {reply,snapshot,state,busy,error,offline,permissionLost,now,nextDeadline,stale,refresh,canRefresh}=useCboeSnapshot();
 const [currency,setCurrency]=useState(''),[query,setQuery]=useState('');
 const emptyCheck=snapshot?reply?.latest_empty_check:null;
 const rows=useMemo(()=>snapshot?.rows.filter(row=>(!currency||row.currency===currency)&&(!query.trim()||row.isin.includes(query.trim().toUpperCase())))??[],[snapshot,currency,query]);
 const groups=useMemo(()=>cboeMatrixGroups(rows),[rows]);
 const currencies=[...new Set(snapshot?.rows.map(row=>row.currency)??[])].sort();
 const next=nextDeadline>0?(Number.isFinite(nextDeadline)&&nextDeadline<=8.64e15?when(new Date(nextDeadline).toISOString()):'来源要求暂停，恢复时间超出可显示范围'):'未提供';
 const age=snapshot?.latestPublicationTime?Math.max(0,Math.floor((now-Date.parse(snapshot.latestPublicationTime))/60_000)):null;
 return <main className={s.root}>
  <header className={s.header}><p className={s.eyebrow}>EUROPE · DELAYED TRADE PRICES</p><h1>欧洲延迟成交价矩阵</h1><p>股票及 ETF · Cboe BXE 的部分交易 · 至少延迟 15 分钟</p></header>
  <section className={s.notice} aria-label="欧洲价格数据口径"><strong>这是成交价格，不是资金净流入</strong><p>只检查来源最近公布的 5 个分钟文件。页面打开且可见时，至少间隔一分钟检查，并遵守来源要求的更长暂停；没有后台持续采集。按币种分组，使用 ISIN 识别证券；不推断发行人国家、上市国家或行业。没有全欧洲或全国市场覆盖声明。</p><p>只保留 BATE、BATD、BATP 场内符合条件的成交，过滤非价格形成、延后报告及有撤销或更正疑点的证券。没有可靠日收盘基准，不计算日涨跌，也不把价格作为金额面积。</p></section>
  <section className={s.controls} aria-label="欧洲报价筛选">
   <label>币种<select value={currency} onChange={e=>setCurrency(e.target.value)}><option value="">全部币种</option>{currency&&!currencies.includes(currency)&&<option value={currency}>{currency} · 当前无观测</option>}{currencies.map(value=><option key={value}>{value}</option>)}</select></label>
   <label>证券 ISIN<input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="输入 ISIN"/></label>
   <button type="button" disabled={!canRefresh} onClick={()=>void refresh()}>{busy?'正在检查…':'检查更新'}</button>
  </section>
  <section className={s.status} aria-live="polite" aria-label="欧洲来源时点与状态">
   <strong>{permissionLost?'展示权限已失效':offline?(snapshot?'连接中断，显示上次核验快照':'连接中断，暂无有效快照'):error?'回复核验失败':busy?'正在检查来源':state==='denied'?'来源拒绝访问，已停止请求':emptyCheck?'本次窗口无合格成交，保留上次核验价格':stale?'保留上次快照，尚未成功更新':snapshot?'来源检查成功':'暂无可核验快照'}</strong>
   {permissionLost&&<p role="alert">已清空数据并停止检查，请恢复访问权限。</p>}
   {error&&<p role="alert">{error}</p>}
   {reply?.status.error_code&&<p>状态代码：{reply.status.error_code}</p>}
   <dl><div><dt>抓取完成</dt><dd>{when(snapshot?.fetchedAt)}</dd></div><div><dt>价格快照源端发布</dt><dd>{when(snapshot?.latestPublicationTime)}{age!==null?` · ${age} 分钟前`:''}</dd></div><div><dt>下次可检查</dt><dd>{permissionLost||state==='denied'?'已停止':next}</dd></div></dl>
   {emptyCheck&&<p>最近来源检查完成：{when(emptyCheck.fetchedAt)}；本次检查 {emptyCheck.sampledFiles.length} 个文件、{emptyCheck.coverage.rawRows.toLocaleString()} 条记录，0 个可显示价格。以下矩阵仍是原时点的历史快照，不是当前报价；空窗口本身不能确认市场已休市。</p>}
   {emptyCheck&&<details><summary>查看最近空窗口的来源时点与文件</summary><p>发布窗口 {when(emptyCheck.windowStart)} 至 {when(emptyCheck.windowEnd)}；最近发布 {when(emptyCheck.latestPublicationTime)}。</p><ul>{emptyCheck.sampledFiles.map(file=><li key={file}>{file}</li>)}</ul></details>}
   {snapshot&&<><p>价格快照最迟于 {when(new Date(Date.parse(snapshot.fetchedAt)+reply!.status.max_cache_age_ms).toISOString())} 到期；后续空窗口或连接故障不会延长此期限。</p><p>价格快照采样 {snapshot.sampledFiles.length} 个文件，发布窗口 {when(snapshot.windowStart)} 至 {when(snapshot.windowEnd)}（结束时刻不含）。有间隔的文件不会补成连续覆盖。</p><p>{snapshot.coverage.rawRows.toLocaleString()} 条源记录，{snapshot.coverage.rejectedRows.toLocaleString()} 条不满足显示条件，{snapshot.rows.length.toLocaleString()} 个证券 / 币种价格；筛选后显示 {rows.length.toLocaleString()} 项。抓取成功不代表刚刚成交。</p><details><summary>查看本次来源文件</summary><ul>{snapshot.sampledFiles.map(file=><li key={file}>{file}</li>)}</ul></details></>}
  </section>
  <MatrixHeatmap groups={groups} title="Cboe BXE · 延迟成交价" description="所示价格快照窗口内，每个 ISIN / 币种最近一笔符合条件的成交。不是交易所当前最优报价。" colorMode="neutral" colorMeaning="中性显示；不推断涨跌或资金方向。" areaMeaning="等宽信息卡；价格不代表金额面积。" emptyTitle={snapshot?'当前文件窗口没有可显示的价格':'延迟价格暂不可用'} emptyMessage={snapshot?'可能是已收市后的非价格形成报告，或当前筛选无结果。不会把这类报告、零价格或旧文件伪装成实时行情。':'等待通过核验的独立来源；不填入模拟价格。'} emptyNote="免费、无需账户；源端至少延迟 15 分钟，网络与缓存可能增加延迟。" scopeKey={`${snapshot?.windowStart??'none'}/${currency}/${query}`}/>
  <footer className={s.footer}><p>© Cboe。仅供所有者私人、内部信息研究使用，不提供公开数据分发，不构成投资建议。</p><a href="https://www.cboe.com/markets/eu/equities/transparency-data/" target="_blank" rel="noreferrer">官方延迟数据与免责声明</a><a href="https://cdn.cboe.com/resources/participant_resources/Cboe_Europe_Data_Policy_August_2026.pdf" target="_blank" rel="noreferrer">Cboe 数据使用政策</a><a href="/markets">返回各国资金流入口</a></footer>
 </main>;
}
