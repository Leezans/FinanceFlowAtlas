'use client';
import React from 'react';
import {polymarketExportFilename,type OrganizedPolymarketReport} from '@/lib/evidence/polymarket-projection';
import BlobEvidenceDownload from './BlobEvidenceDownload';
import s from './evidence.module.css';
export const POLYMARKET_PREVIEW_LIMIT=120;
export default function OrganizedPolymarketEvidence({report,onDownload}:{report:OrganizedPolymarketReport;onDownload?:React.MouseEventHandler<HTMLAnchorElement>}){
 const preview=report.rows.slice(0,POLYMARKET_PREVIEW_LIMIT),legacy=report.native_schema==='polymarket-gamma/1';
 return <details className={s.panel}>
  <summary>整理后的当前证据 · 统一字段与原值追溯</summary>
  <p>仅整理当前页面仍允许展示的 Gamma 快照，不再次获取来源。{report.presentation.stale?'当前保留的报告已标记陈旧。':'此处可导出不代表实时数据。'} 当前{report.coverage.view==='hot'?'热门':'较新'}模式内全部保留市场的所有结果价格与 24 小时成交量，不随搜索、分组下钻或热图指标裁剪；不包含其他模式。</p>
  <dl>
   <div><dt>来源 / 原生结构</dt><dd>Polymarket Gamma · {report.native_schema}</dd></div>
   <div><dt>样本覆盖 / 排序</dt><dd>来源返回 {report.coverage.source_market_count} 条，保留 {report.coverage.retained_market_count} 个市场，排除 {report.coverage.excluded_market_count} 条；上限 {report.coverage.sample_limit} 条。{report.coverage.ordering==='source_id_descending'?'按来源市场 ID 倒序，ID 不是创建时间':'按来源 24 小时成交量倒序'}；全站总数未知，不是完整市场。</dd></div>
   <div><dt>分页 / 停止原因</dt><dd>{legacy?'旧版未保留分页、游标及分组规则字段，不补造':`${report.coverage.pagination} · ${report.coverage.source_page_count} 页（${report.coverage.source_page_sizes?.join(' / ')} 条）· ${report.coverage.stop_reason} · has_more: ${String(report.coverage.has_more)}`}；短页或无后续游标不保证全站完整覆盖。</dd></div>
   <div><dt>采集开始 / 成功获取</dt><dd>{report.clocks.acquisition_started_at} / {report.clocks.fetched_at}</dd></div>
   <div><dt>价格时点 / 成交量窗口</dt><dd>价格观测时间未知；成交量为来源 24 小时字段，起止时点未知。采集时间与来源记录更新时间均不替代价格观测时间或成交量窗口端点。</dd></div>
   <div><dt>市场 / 条件 / 事件身份</dt><dd>保留 Gamma market ID 与实际保留的 condition ID；事件 ID 未保留，不从问题、分类或标签推断，不把市场与条件 ID 当作事件 ID。</dd></div>
  </dl>
  <BlobEvidenceDownload report={report} filename={polymarketExportFilename(report)} onDownload={onDownload}/>
  <p>下载仅保存到你的设备，不上传或分享。切换模式、权限失效、过期、替换或离开页面会撤下旧入口并释放本地 Blob，已下载文件不能自动撤回。预览最多 120 条，JSON 保留当前模式全部字段。</p>
  <p>结果价格原值是 0–1 的小数字符串，不转换为百分比或金额，也不等于客观真实概率。24 小时成交量原值是数值，单位仅为 source_reported，未核实为 USD 或 USDC。null 与来源已报告的零分别保留。</p>
  <p>本次整理不包含独立持仓金额模式的 OI；Gamma 快照没有保留 liquidity 或事件字段。不计算分类合计，不跨市场、结果、指标、时间窗口或来源加总、平均或换算，不代表资金净流入。</p>
  <p>来源分类、标签与接受订单状态仍保留在原生记录中；展示分组不是官方主分类或行业映射。来源精确发布时间及延迟未知，不推断市场或标的所属国家。</p>
  <p><a href={report.source.urls[0]} target="_blank" rel="noreferrer">Polymarket 官方市场字段说明</a> · <a href={report.source.terms_url} target="_blank" rel="noreferrer">Polymarket 使用条款</a>；仅供个人信息参考，不声明再分发许可。</p>
  <div className={s.scroll}><table><caption>当前证据字段 · {report.rows.length} 条（预览前 {preview.length} 条，JSON 包含当前模式全部字段；不求和）</caption>
   <thead><tr><th>市场问题 / 市场 ID</th><th>条件 ID / 展示分组</th><th>结果 / 指标</th><th>原值</th><th>本行单位</th><th>观察窗口 / 记录更新</th><th>原字段路径</th></tr></thead>
   <tbody>{preview.map(row=><tr key={row.id}>
    <td>{row.dimension.label}<small className={s.identity}>{row.dimension.namespace}:{row.dimension.id}</small></td>
    <td>{row.identity.condition_state==='reported'?row.identity.condition_id:row.identity.condition_state==='not_retained'?'条件字段未保留':'条件 ID 为 null'}<small className={s.identity}>{row.grouping.label} · {row.grouping.basis}</small></td>
    <td>{row.outcome?.name??'市场级成交量'}<small className={s.identity}>{row.metric_label}</small></td>
    <td>{row.state==='reported'?String(row.value):'来源保留 null'}</td><td>{row.unit.code}</td>
    <td>{row.observation.window==='rolling_24h'?'来源 24 小时，起止未知':'价格观测时点未知'}<small className={s.identity}>记录更新：{row.observation.source_record_updated_at??'未提供'}</small></td><td>{row.native_locator}</td>
   </tr>)}</tbody>
  </table></div>
 </details>;
}
