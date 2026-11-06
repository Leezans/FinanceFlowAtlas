'use client';
import React,{useState} from 'react';
import MatrixHeatmap from '@/components/matrix/MatrixHeatmap';
import {HOT_MARKETS,INTEREST_MARKETS,INTEREST_BATCH_SIZE,INTEREST_SOURCE_DOCS,SOURCE_TERMS,type PolymarketInterestSnapshot} from '@/lib/polymarket/model';
import {filterMarkets,formatSourceVolume,interestMatrix} from './matrix';
import s from './polymarket.module.css';
const time=(value:string)=>value.replace('T',' ').replace('Z',' UTC');
export default function OpenInterest({snapshot}:{snapshot:PolymarketInterestSnapshot|null}){
 const [query,setQuery]=useState('');
 const rows=filterMarkets(snapshot?.rows??[],query),values=new Map(snapshot?.values.map(row=>[row.condition_id,row.value])??[]);
 const zero=rows.filter(row=>values.get(row.condition_id!)===0).length,missing=rows.filter(row=>!values.has(row.condition_id!)).length;
 const candidates=snapshot?.discovery.rows??[],conditioned=candidates.filter(row=>row.condition_id),distinct=new Set(conditioned.map(row=>row.condition_id)).size;
 const legacy=snapshot?.schema==='polymarket-open-interest/1',sampleLimit=snapshot?.sample_limit??INTEREST_MARKETS;
 const batches=snapshot?.schema==='polymarket-open-interest/2'?snapshot.batches:null;
 return <>
  <section className={s.sources} aria-label="持仓金额样本覆盖范围">
   <h2>未平仓持仓金额（USDC）</h2>
   <p>面积表示来源按价格计值的总未平仓持仓。它是存量估值，不是 24 小时成交额、现金流或净流入。</p>
   <p>先读取来源按 24 小时成交量倒序返回的一页热门 Gamma 样本（最多 {HOT_MARKETS} 条），冻结本次候选范围，再选其中前 {sampleLimit} 个具有不同标准条件 ID 的市场。不是全站 OI 排名，也不覆盖较新模式的 500 个市场；全站市场总数未知。</p>
   <p>{legacy?`当前显示旧版最多 ${sampleLimit} 个市场的单批快照，仍按旧版范围和原始时间展示。`:`最多 ${INTEREST_MARKETS} 个市场，分为最多 ${Math.ceil(INTEREST_MARKETS/INTEREST_BATCH_SIZE)} 个顺序批次，每批最多 ${INTEREST_BATCH_SIZE} 个条件；全部计划批次完成后才展示新快照。`}</p>
   {snapshot&&<>
    <p>Gamma 返回 {snapshot.discovery.source_market_count} 条，排除 {snapshot.discovery.excluded_market_count} 条无效或非活跃记录，候选 {candidates.length} 个；条件 ID 缺失或不支持 {candidates.length-conditioned.length} 个，重复条件 {conditioned.length-distinct} 个，受 {sampleLimit} 个上限影响未选 {distinct-snapshot.rows.length} 个。</p>
    <p>本次已完成 {batches?.length??1} 批请求：请求 {snapshot.rows.length} 个不同条件，返回金额 {snapshot.values.length} 个，未返回 {snapshot.rows.length-snapshot.values.length} 个。未返回表示来源未解析为可服务市场，不等于零；仅明确报告的 0 视为零。</p>
    <p>完整采集区间：{time(snapshot.acquisition_started_at)} 至 {time(snapshot.fetched_at)}。Gamma 样本采集区间：{time(snapshot.discovery.acquisition_started_at)} 至 {time(snapshot.discovery.fetched_at)}。</p>
    <p>OI 采集区间：{time(snapshot.oi_request_started_at)} 至 {time(snapshot.fetched_at)}（首批请求开始至末批响应接收）。</p>
    <ul aria-label="持仓金额批次采集明细">{batches?batches.map((batch,index)=><li key={index}>第 {index+1} 批：请求 {batch.condition_ids.length} 个条件，返回金额 {batch.returned_condition_ids.length} 个，未返回 {batch.condition_ids.length-batch.returned_condition_ids.length} 个；请求始于 {time(batch.requested_at)}，响应接收于 {time(batch.fetched_at)}。</li>):<li>旧版第 1 批：请求 {snapshot.rows.length} 个条件，返回金额 {snapshot.values.length} 个，未返回 {snapshot.rows.length-snapshot.values.length} 个；请求始于 {time(snapshot.oi_request_started_at)}，响应接收于 {time(snapshot.fetched_at)}。</li>}</ul>
    <p>Gamma 与 OI、不同 OI 批次之间都不是同一时点的原子快照。来源未提供逐市场估值时间，也不保证同批估值同步；请求与响应时间不能证明估值实时。</p>
    <p>{legacy?'旧版快照年龄从原始响应接收时间起算。':'快照年龄从首批 OI 请求开始时间起算，不因后续批次完成而重置。'} 超过 5 分钟标记陈旧，超过 10 分钟隐藏；这只是采集年龄，不是持仓估值年龄。</p>
   </>}
  </section>
  <div className={s.controls}><label>搜索持仓金额样本<input value={query} onChange={event=>setQuery(event.target.value)} placeholder="完整问题、分类或结果"/></label></div>
  {snapshot&&<p className={s.availability} aria-label="当前持仓金额字段可用性">当前筛选 {rows.length} 个市场：持仓金额正值 {rows.length-zero-missing} 个、零 {zero} 个、缺失 {missing} 个。只有正值占面积；零值与缺失保留在数值明细中。</p>}
  <MatrixHeatmap groups={interestMatrix(rows,values)} title="样本持仓金额矩阵" description="按 USDC 金额分配面积，可用鼠标滚轮放大、拖动查看；完整问题和精确数值见明细。" colorMode="sequential" colorMeaning="当前可见样本的持仓金额相对大小，不表示资金流向" areaMeaning="本次已完成采集样本的未平仓持仓金额（USDC），不是全站占比，也不代表同一估值时点" scopeKey="polymarket-open-interest" emptyTitle="暂无可核验的持仓金额" emptyMessage={snapshot?'当前搜索没有匹配市场。':'等待完整取得热门样本与持仓金额；不拿成交量替代。'} emptyNote="缺失不是零，不使用示例数据。"/>
  {snapshot&&<details className={s.sources}><summary>持仓金额与条件 ID</summary>{rows.map(row=><section key={row.id}><h3>{row.question}</h3><p>持仓金额：{values.has(row.condition_id!)?`${formatSourceVolume(values.get(row.condition_id!)!)} USDC`:'来源未返回'}</p><p>条件 ID：{row.condition_id}</p></section>)}</details>}
  <section className={s.sources}><h2>来源与使用边界</h2><ul><li>金额来自 Polymarket Data API v2 的 priced gross open interest，官方定义单位为 USDC。不把 USDC 换算成法币美元，不将它解释为抵押品净存入。</li><li>持仓金额检查至少间隔 5 分钟，普通模式仍按 30 秒检查；来源拒绝会停止所有模式。超过 5 分钟标记陈旧，超过 10 分钟隐藏。页面隐藏时停止检查。</li><li>仅供个人信息参考，保持现有私人访问边界。公开接口和代码开源不代表取得商业使用或数据再分发许可。来源拒绝时停止，不绕过访问限制。</li></ul><p><a href={INTEREST_SOURCE_DOCS} target="_blank" rel="noreferrer">官方 OI 单位与说明 ↗</a> · <a href={SOURCE_TERMS} target="_blank" rel="noreferrer">Polymarket 使用条款 ↗</a></p></section>
 </>;
}
