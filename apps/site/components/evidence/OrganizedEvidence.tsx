'use client';
import React from 'react';
import type {EvidenceRow,OrganizedReport} from '@/lib/evidence/report-projection';
import {ashareExportFilename,type OrganizedAshareReport} from '@/lib/evidence/ashare-projection';
import type {OrganizedTpexShareReport,OrganizedTpexShareRow} from '@/lib/evidence/tpex-share-projection';
import BlobEvidenceDownload from './BlobEvidenceDownload';
import s from './evidence.module.css';
export type OrganizedEvidenceReport=OrganizedReport|OrganizedAshareReport|OrganizedTpexShareReport;
export const TPEX_SHARE_PREVIEW_LIMIT=120;
function isTpexShareRow(row:EvidenceRow):row is OrganizedTpexShareRow{return 'industry' in row&&'participant' in row&&'value_origin' in row;}
/** Existing authenticated page data only. No request, public endpoint, persistence or credential. */
export default function OrganizedEvidence({report,onDownload}:{report:OrganizedEvidenceReport|null;onDownload?:React.MouseEventHandler<HTMLAnchorElement>}) {
 if(!report) return null;
 const ashare=report.source_id==='eastmoney-ashare'?report:null;
 const shares=report.source_id==='tpex-shares'?report:null;
 const filename=ashare?ashareExportFilename(ashare):`${report.source_id}-${report.period.end}-organized.json`;
 const preview=shares?shares.rows.slice(0,TPEX_SHARE_PREVIEW_LIMIT):report.rows;
 return <details className={s.panel}>
  <summary>整理后的当前证据 · 统一字段与原值追溯</summary>
  <p>仅整理当前页面仍允许展示的已校验快照，不再次获取来源。{report.presentation.stale?'当前保留的报告已标记陈旧。':'此处可导出不代表实时数据。'}{ashare?'仅整理主力净额 f62，东财大单与超大单口径估算，不是全市场资金净流入。行业层级、行业与成分股、不同范围之间均不求和。':shares?'每家公司保留全部法人类别的买进、卖出与净股数。法人合计与分项重叠，不能一并求和；股数不是金额，不换算币种，也不代表全市场资金净流入。':'合计与组成项重叠，不能一并求和；不同指标、时期与币种不混加。'}</p>
  <dl><div><dt>来源 / 国家角色</dt><dd>{report.source.name} · {report.geography.iso3} · {report.geography.role==='issuer_market'?'证券发行人市场':'本地市场'}</dd></div>
   <div><dt>观察期间 / 原始单位</dt><dd>{ashare?'观察期间与交易日期未知（null）':`${report.period.start} 至 ${report.period.end} · ${report.period.frequency==='weekly'?'周度':'日度'}`} · {report.unit.code}</dd></div>
   <div><dt>原生结构</dt><dd>{report.native_schema}</dd></div>
   <div><dt>来源精确发布时间</dt><dd>未提供，保留 null</dd></div>
   {ashare&&<><div><dt>东财分类范围</dt><dd>{ashare.scope.fs} · {ashare.scope.classification_level}；分类成员互斥性未建立</dd></div>
    <div><dt>最近完整采集 / 保留期限</dt><dd>{ashare.clocks.fetched_at}；按最早采集时间保留不足 24 小时，不是行情有效期</dd></div></>}
   {shares&&<><div><dt>官方行业分类日期 / 命名空间</dt><dd>{shares.classification.industry.date} · {shares.classification.industry.namespace}</dd></div>
    <div><dt>公司覆盖 / 未匹配证券</dt><dd>{shares.coverage.matched_company_count} / {shares.coverage.company_count} 家有报告；{shares.coverage.missing_company_count} 家缺少法人记录；{shares.coverage.excluded_security_count} / {shares.coverage.source_security_count} 条来源证券未匹配公司名册</dd></div>
    <div><dt>采集开始 / 最近成功获取</dt><dd>{shares.clocks.acquisition_started_at} / {shares.clocks.fetched_at}</dd></div></>}
  </dl>
  {shares?<BlobEvidenceDownload report={shares} filename={filename} onDownload={onDownload}/>:<a className={s.download} href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(report,null,2))}`} download={filename} onClick={onDownload}>下载整理后的 JSON</a>}
  <p>下载仅保存到你的设备，不上传或分享。快照失效后本页入口会撤下，已下载文件不会自动撤回。{ashare?'包含当前来源范围的全部行，不受矩阵搜索或方向筛选影响。缺失标记与已报告零值分开保留；原生行仅保留已知字段，额外字段不导出。':shares?'下载包含全部公司与全部法人类别，不受行业下钻或法人选择影响。缺少法人记录保留 null，与已报告零值分开；缺失行路径指向实际为 null 的 flow。':'缺失不是 0；下表缺失表示当前保存结构未包含该字段，不推断原始来源也没有。'}</p>
  {ashare&&<p>来源资金观测时点、交易日期与延迟均未知；采集时间不代替这些信息。保留的其他原字段不自动解释为 CNY 或纳入统一指标；再分发许可未确认。</p>}
  {shares&&<p>合计买进、卖出沿用原适配器对三类法人的加总，合计净股数来自官方字段，不重新计算。外资不含外资自营商，后者已包含在自营商。未提供行业汇总或跨来源行业映射。</p>}
  <div className={s.scroll}><table><caption>当前证据字段 · {report.rows.length} 条{ashare?'（当前来源范围，无推算合计）':shares?`（预览前 ${preview.length} 条，JSON 包含全部；法人合计与分项重叠）`:'（含单列合计，非额外金额）'}</caption><thead><tr><th>{shares?'公司':'维度'}</th>{shares&&<><th>官方行业</th><th>法人类别</th></>}<th>行类型</th><th>指标</th><th>原值 / {report.unit.code}</th><th>原字段路径</th>{shares&&<th>值的来源</th>}</tr></thead>
   <tbody>{preview.map(row=><tr key={row.id}><td>{row.dimension.label}<small className={s.identity}>{row.dimension.namespace}:{row.dimension.id}</small></td>{isTpexShareRow(row)&&<><td>{row.industry.label}<small className={s.identity}>{row.industry.namespace}:{row.industry.id} · {row.industry.classification_date}</small></td><td>{row.participant.label}<small className={s.identity}>{row.participant.namespace}:{row.participant.id}</small></td></>}<td>{row.role==='reported_total'?'来源合计（重叠）':row.role==='participant_total'?'法人合计（重叠）':row.role==='provider_scope_member'?'来源范围成员（不求和）':'组成项'}</td><td>{row.metric_label}</td><td>{row.state==='reported'?String(row.value):row.state==='source_missing_marker'?'来源缺失标记 · null':row.state==='source_record_missing'?'法人记录缺失 · null':'未保留 · null'}</td><td>{row.native_locator??'无对应字段'}</td>{isTpexShareRow(row)&&<td>{row.value_origin==='adapter_sum_of_participants'?'原适配器加总':row.value_origin==='source_reported'?'来源已报告':'来源记录缺失'}</td>}</tr>)}</tbody></table></div>
 </details>;
}
