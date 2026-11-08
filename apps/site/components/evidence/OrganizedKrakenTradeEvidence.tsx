'use client';
import React from 'react';
import {krakenTradeExportFilename,type OrganizedKrakenTradeReport} from '@/lib/evidence/kraken-trade-projection';
import BlobEvidenceDownload from './BlobEvidenceDownload';
import s from './evidence.module.css';
export const KRAKEN_TRADE_PREVIEW_LIMIT=120;
export default function OrganizedKrakenTradeEvidence({report,onDownload}:{report:OrganizedKrakenTradeReport;onDownload?:React.MouseEventHandler<HTMLAnchorElement>}){
 const preview=report.rows.slice(0,KRAKEN_TRADE_PREVIEW_LIMIT);
 return <details className={s.panel}>
  <summary>整理后的当前证据 · 统一字段与原值追溯</summary>
  <p>仅整理当前页面仍允许展示的已校验成交快照，不再次获取来源。{report.presentation.stale?'当前保留的报告已标记陈旧。':'此处可导出不代表实时数据。'} 单一交易所、所选 USD 交易对，不代表全球覆盖或资金净流入。</p>
  <dl>
   <div><dt>来源 / 地域</dt><dd>Kraken · 交易场所，不推断基础币种所属国家</dd></div>
   <div><dt>当前成交选择 / 原生结构</dt><dd>{report.coverage.selected_pairs.join(' / ')} · {report.native_schema}{report.coverage.selection_origin==='schema_1_default_pairs'?'（schema-1 默认选择，未补写原生字段）':''}</dd></div>
   <div><dt>固定统计区间</dt><dd>{report.period.start}（含）至 {report.period.end}（不含）· {report.period.window_ms/60000} 分钟，不随页面时钟滚动</dd></div>
   <div><dt>最近成功获取 / 采集锚点</dt><dd>{report.clocks.fetched_at}；共同区间结束对应完整响应的采集开始，成交原生结构没有单独的 acquisition_started_at 字段，保留 null</dd></div>
   <div><dt>覆盖 / 返回预算</dt><dd>{report.coverage.present_pair_count} 组有证据；每页上限 {report.coverage.trade_limit} 笔；页数上限 {report.coverage.page_limit??'原结构未保留（按单页解读）'}。末页为短页也不证明区间或全市场完整覆盖</dd></div>
   <div><dt>来源精确发布时间 / 发布延迟</dt><dd>未提供，保留 null / not_provided；获取时间不是成交时间，不保证实时</dd></div>
  </dl>
  {report.coverage.missing_pairs.length>0&&<p>目录未纳入、未请求的交易对：{report.coverage.missing_pairs.join('、')}。只保留缺失名称，不补造交易对元数据或零值。</p>}
  <BlobEvidenceDownload report={report} filename={krakenTradeExportFilename(report)} onDownload={onDownload}/>
  <p>下载仅保存到你的设备，不上传或分享。文件包含当前已应用交易对与区间的全部证据，不受未应用的待选项或搜索影响。更改已应用选择或区间会撤下旧证据；权限失效、过期、替换或离开页面会撤下入口并释放本地 Blob，已下载文件不能自动撤回。</p>
  <p>每笔成交始终同时存在买方和卖方。REST b/s 的成交发起方约定未在所引 REST 文档中明确，不把买卖标记差额称为主动买卖资金流；即使主动方向已确认，也不等于净资本流入、交易所充值提现或跨境资金流。</p>
  <p>买标记、卖标记成交额及其差额沿用原适配器的 USD 十进制字符串，原值不舍入；差比是原适配器截断到 0.0001% 的数值，不能当作 USD。差额与差比不重新计算，不跨交易对、币种、指标、单位、重叠区间或来源求和或换算。</p>
  <p>覆盖受限的 null、无区间内成交时的 null 差比、已报告的零值分别保留。原记录未保留的分页字段保持缺失，按原读取器解释为单页。首末成交时间与获取时间单独保留；cursor 是继续查询令牌，不是最后成交时间。</p>
  <p><a href={report.source.urls[0]} target="_blank" rel="noreferrer">Kraken 官方逐笔成交说明</a> · <a href={report.source.terms_url} target="_blank" rel="noreferrer">API 使用条件</a>；不声明再分发许可。</p>
  <div className={s.scroll}><table><caption>当前证据字段 · {report.rows.length} 条（预览前 {preview.length} 条，JSON 包含当前选择全部字段；不求和）</caption>
   <thead><tr><th>交易对 / 基础与报价币种</th><th>返回覆盖与计数</th><th>区间内首末成交 / 获取</th><th>指标 / 值的来源</th><th>原值</th><th>本行单位</th><th>原字段路径</th></tr></thead>
   <tbody>{preview.map(row=><tr key={row.id}>
    <td>{row.dimension.label}<small className={s.identity}>{row.dimension.namespace}:{row.dimension.id} · {row.pair.base} / {row.pair.quote}</small></td>
    <td>{row.response.coverage==='capped_response'?'末页触及上限 · 覆盖未知':'末页短页 · 完整性未核验'}<small className={s.identity}>返回 {row.response.returned_count} · 区间内 {row.response.trade_count} · 排除 {row.response.excluded_after_window_count}</small><small className={s.identity}>{row.response.page_count??'原记录单'} 页 · 末页 {row.response.last_page_count??row.response.returned_count} 笔</small></td>
    <td>{row.observation.first_trade_at??'区间内无返回成交'}<small className={s.identity}>{row.observation.last_trade_at??'区间内无返回成交'} · 获取 {row.observation.fetched_at}</small></td>
    <td>{row.metric_label}<small className={s.identity}>{row.value_origin}</small></td>
    <td>{row.state==='reported'?String(row.value):row.state==='coverage_unavailable'?'覆盖未知 · null':'无区间内成交 · 差比 null'}</td><td>{row.unit.code}</td><td>{row.native_locator}</td>
   </tr>)}</tbody>
  </table></div>
 </details>;
}
