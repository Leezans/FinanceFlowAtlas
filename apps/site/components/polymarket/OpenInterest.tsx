'use client';
import React,{useState} from 'react';
import MatrixHeatmap from '@/components/matrix/MatrixHeatmap';
import {INTEREST_MARKETS,INTEREST_SOURCE_DOCS,SOURCE_TERMS,type PolymarketInterestSnapshot} from '@/lib/polymarket/model';
import {filterMarkets,formatSourceVolume,interestMatrix} from './matrix';
import s from './polymarket.module.css';
const time=(value:string)=>value.replace('T',' ').replace('Z',' UTC');
export default function OpenInterest({snapshot}:{snapshot:PolymarketInterestSnapshot|null}){
 const [query,setQuery]=useState('');
 const rows=filterMarkets(snapshot?.rows??[],query),values=new Map(snapshot?.values.map(row=>[row.condition_id,row.value])??[]);
 const zero=rows.filter(row=>values.get(row.condition_id!)===0).length,missing=rows.filter(row=>!values.has(row.condition_id!)).length;
 const candidates=snapshot?.discovery.rows??[],conditioned=candidates.filter(row=>row.condition_id),distinct=new Set(conditioned.map(row=>row.condition_id)).size;
 return <>
  <section className={s.sources} aria-label="持仓金额样本覆盖范围"><h2>未平仓持仓金额（USDC）</h2><p>面积表示来源按价格计值的总未平仓持仓。它是某时点的存量估值，不是 24 小时成交额、现金流或净流入。</p><p>每次读取一页热门 Gamma 样本，再选其中前 {INTEREST_MARKETS} 个具有不同标准条件 ID 的市场，一次批量获取持仓金额。不是全站 OI 排名，也不覆盖较新模式的 500 个市场。</p>{snapshot&&<><p>Gamma 返回 {snapshot.discovery.source_market_count} 条，排除 {snapshot.discovery.excluded_market_count} 条无效或非活跃记录，候选 {candidates.length} 个；条件 ID 缺失或不支持 {candidates.length-conditioned.length} 个，重复条件 {conditioned.length-distinct} 个，受 20 个上限影响未选 {distinct-snapshot.rows.length} 个。</p><p>请求 {snapshot.rows.length} 个不同条件，返回金额 {snapshot.values.length} 个，未返回 {snapshot.rows.length-snapshot.values.length} 个。未返回表示来源未解析为可服务市场，不等于零；仅明确报告的 0 视为零。</p><p>热门样本获取于 {time(snapshot.discovery.fetched_at)}；持仓金额请求始于 {time(snapshot.oi_request_started_at)}，获取于 {time(snapshot.fetched_at)}。两来源不是同一时点快照。来源未提供逐市场估值时间，获取时间不能证明估值实时。</p></>}</section>
  <div className={s.controls}><label>搜索持仓金额样本<input value={query} onChange={event=>setQuery(event.target.value)} placeholder="完整问题、分类或结果"/></label></div>
  {snapshot&&<p className={s.availability} aria-label="当前持仓金额字段可用性">当前筛选 {rows.length} 个市场：持仓金额正值 {rows.length-zero-missing} 个、零 {zero} 个、缺失 {missing} 个。只有正值占面积；零值与缺失保留在数值明细中。</p>}
  <MatrixHeatmap groups={interestMatrix(rows,values)} title="样本持仓金额矩阵" description="按 USDC 金额分配面积，可用鼠标滚轮放大、拖动查看；完整问题和精确数值见明细。" colorMode="sequential" colorMeaning="当前可见样本的持仓金额相对大小，不表示资金流向" areaMeaning="同一次批量取得的未平仓持仓金额（USDC），不是全站占比" scopeKey="polymarket-open-interest" emptyTitle="暂无可核验的持仓金额" emptyMessage={snapshot?'当前搜索没有匹配市场。':'等待完整取得热门样本与持仓金额；不拿成交量替代。'} emptyNote="缺失不是零，不使用示例数据。"/>
  {snapshot&&<details className={s.sources}><summary>持仓金额与条件 ID</summary>{rows.map(row=><section key={row.id}><h3>{row.question}</h3><p>持仓金额：{values.has(row.condition_id!)?`${formatSourceVolume(values.get(row.condition_id!)!)} USDC`:'来源未返回'}</p><p>条件 ID：{row.condition_id}</p></section>)}</details>}
  <section className={s.sources}><h2>来源与使用边界</h2><ul><li>金额来自 Polymarket Data API v2 的 priced gross open interest，官方定义单位为 USDC。不把 USDC 换算成法币美元，不将它解释为抵押品净存入。</li><li>持仓金额检查至少间隔 5 分钟，普通模式仍按 30 秒检查；来源拒绝会停止所有模式。超过 5 分钟标记陈旧，超过 10 分钟隐藏。页面隐藏时停止检查。</li><li>仅供个人信息参考，保持现有私人访问边界。公开接口和代码开源不代表取得商业使用或数据再分发许可。来源拒绝时停止，不绕过访问限制。</li></ul><p><a href={INTEREST_SOURCE_DOCS} target="_blank" rel="noreferrer">官方 OI 单位与说明 ↗</a> · <a href={SOURCE_TERMS} target="_blank" rel="noreferrer">Polymarket 使用条款 ↗</a></p></section>
 </>;
}
