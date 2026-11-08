'use client';
import React from 'react';
import {polymarketInterestExportFilename,type OrganizedPolymarketInterestReport} from '@/lib/evidence/polymarket-interest-projection';
import BlobEvidenceDownload from './BlobEvidenceDownload';
import s from './evidence.module.css';
export const POLYMARKET_INTEREST_PREVIEW_LIMIT=120;
export default function OrganizedPolymarketInterestEvidence({report,onDownload}:{report:OrganizedPolymarketInterestReport;onDownload?:React.MouseEventHandler<HTMLAnchorElement>}){
 const preview=report.rows.slice(0,POLYMARKET_INTEREST_PREVIEW_LIMIT),discovery=report.coverage.discovery;
 return <details className={s.panel}>
  <summary>整理后的当前持仓证据 · USDC 原值与批次追溯</summary>
  <p>仅整理当前页面仍允许展示的已校验持仓金额快照，不再次获取来源。{report.presentation.stale?'当前保留的报告已标记陈旧。':'此处可导出不代表实时估值。'} 包含本次选中全部条件，不受搜索影响；独立于 Gamma 价格与成交量整理。</p>
  <dl>
   <div><dt>来源 / 原生结构</dt><dd>Polymarket Data API v2 · {report.native_schema}</dd></div>
   <div><dt>指标 / 单位</dt><dd>priced_gross_open_interest · USDC；来源按价格计值的总未平仓持仓，是存量估值，不是美元、成交额或资金净流入。</dd></div>
   <div><dt>候选 / 选择范围</dt><dd>Gamma 按 24 小时成交量倒序的单页热门样本，上限 {discovery.sample_limit} 条；返回 {discovery.source_market_count} 条，排除 {discovery.excluded_market_count} 条，保留候选 {discovery.retained_market_count} 个。条件缺失或不支持 {discovery.missing_or_unsupported_condition_count} 个，重复条件 {discovery.duplicate_condition_count} 个，受上限影响未选 {discovery.not_selected_due_to_limit} 个。</dd></div>
   <div><dt>持仓覆盖 / 原生上限</dt><dd>{report.native_schema==='polymarket-open-interest/1'?'旧版单批最多 20 个条件，不升级为 40 个':'当前最多 40 个条件，每批最多 20 个'}；实际选中 {report.coverage.selected_market_count} 个，返回金额 {report.coverage.returned_condition_count} 个，未返回 {report.coverage.missing_condition_count} 个。不提供全站持仓排名，全站总数未知；短页不证明完整覆盖。</dd></div>
   <div><dt>完整采集区间</dt><dd>{report.clocks.acquisition_started_at} 至 {report.clocks.fetched_at}</dd></div>
   <div><dt>Gamma 候选采集区间</dt><dd>{report.clocks.discovery_acquisition_started_at} 至 {report.clocks.discovery_fetched_at}</dd></div>
   <div><dt>OI 请求至接收区间</dt><dd>{report.clocks.oi_request_started_at} 至 {report.clocks.fetched_at}；批次不同步，也不保证同批条件在同一时点估值。</dd></div>
   <div><dt>估值 / 保留时钟</dt><dd>来源估值时间与发布延迟未知。{report.retention.age_basis==='oldest_oi_request'?'按首批 OI 请求时间':'按旧版响应接收时间'} {report.retention.age_anchor} 起算：超过 5 分钟标记陈旧，超过 10 分钟隐藏。候选采集、记录更新、请求与接收时间均不替代估值时间。</dd></div>
  </dl>
  <ul aria-label="整理证据批次与原字段">{report.batches.map(batch=><li key={batch.index}>第 {batch.index+1} 批{batch.kind==='legacy_single_request'?'（旧版单次请求，未补造 batches 字段）':''}：请求 {batch.condition_ids.length} 个条件，返回 {batch.returned_condition_ids.length} 个；{batch.requested_at} 至 {batch.fetched_at}。原时间字段：{batch.requested_native_locator} / {batch.fetched_native_locator}。</li>)}</ul>
  <BlobEvidenceDownload report={report} filename={polymarketInterestExportFilename(report)} onDownload={onDownload}/>
  <p>下载仅保存到你的设备，不上传或分享。切换模式、权限失效、过期、替换或离开页面会撤下旧入口并释放本地 Blob，已下载文件不能自动撤回。预览最多 120 条，JSON 保留本次全部条件和原生快照。</p>
  <p>原生 discovery 和候选市场记录中的价格、成交量只用于追溯选样，不纳入此处统一指标，不与 OI 拼成同步报价。分类与标签不是官方主分类或行业映射；市场 ID、条件 ID 与事件 ID 不互换，事件身份未保留，不补造。</p>
  <p>未返回条件的整理值为 null，原值路径为 null，保留 values 集合及所请求条件以供核对；明确返回的 0 单独保留。不同条件、批次、指标和来源不求和，不换算法币或推断净存入。</p>
  <p><a href={report.source.urls[0]} target="_blank" rel="noreferrer">Polymarket 官方 OI 定义</a> · <a href={report.source.urls[1]} target="_blank" rel="noreferrer">Gamma 候选字段说明</a> · <a href={report.source.terms_url} target="_blank" rel="noreferrer">使用条款</a>；保持私人访问边界，仅供个人信息参考，不声明再分发许可。</p>
  <div className={s.scroll}><table><caption>当前持仓证据字段 · {report.rows.length} 条（预览前 {preview.length} 条，JSON 包含全部条件；不求和）</caption>
   <thead><tr><th>市场问题 / 市场 ID</th><th>条件 ID / 展示分组</th><th>原值 / USDC</th><th>估值时点 / 请求批次</th><th>原字段路径</th></tr></thead>
   <tbody>{preview.map(row=><tr key={row.id}>
    <td>{row.dimension.label}<small className={s.identity}>{row.dimension.namespace}:{row.dimension.id}</small></td>
    <td>{row.identity.condition_id}<small className={s.identity}>{row.grouping.label} · {row.grouping.basis}</small></td>
    <td>{row.state==='reported'?String(row.value):'条件未返回 · null'}</td>
    <td>估值时间未知 · 第 {row.observation.batch_index+1} 批<small className={s.identity}>请求：{row.observation.requested_at}；接收：{row.observation.fetched_at}</small></td>
    <td>{row.native_locator??'无返回值路径 · null'}<small className={s.identity}>所请求条件：{row.identity.condition_native_locator}；返回集合：{row.source_values_native_locator}</small></td>
   </tr>)}</tbody>
  </table></div>
 </details>;
}
