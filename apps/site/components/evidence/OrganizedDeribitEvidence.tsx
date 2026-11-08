'use client';
import React from 'react';
import {deribitExportFilename,type OrganizedDeribitReport} from '@/lib/evidence/deribit-projection';
import BlobEvidenceDownload from './BlobEvidenceDownload';
import s from './evidence.module.css';
export const DERIBIT_PREVIEW_LIMIT=120;
/** Separate row units and clocks; the older monetary/position renderers stay intact. */
export default function OrganizedDeribitEvidence({report,onDownload}:{report:OrganizedDeribitReport;onDownload?:React.MouseEventHandler<HTMLAnchorElement>}){
 const preview=report.rows.slice(0,DERIBIT_PREVIEW_LIMIT);
 return <details className={s.panel}>
  <summary>整理后的当前证据 · 统一字段与原值追溯</summary>
  <p>仅整理当前页面仍允许展示的已校验快照，不再次获取来源。{report.presentation.stale?'当前保留的报告已标记陈旧。':'此处可导出不代表实时数据。'} 单一交易所期权行情，不代表全球覆盖或资金净流入。</p>
  <dl>
   <div><dt>来源 / 地域</dt><dd>Deribit · 交易场所，不推断 BTC / ETH 所属国家</dd></div>
   <div><dt>原快照范围 / 当前可见范围</dt><dd>{report.coverage.source_currencies.join(' / ')} · 原快照 {report.coverage.source_instrument_count??'未知'} 份合约；当前 {report.coverage.visible_currencies.join(' / ')} · {report.coverage.visible_instrument_count} 份未到期合约</dd></div>
   <div><dt>原始单位</dt><dd>按行列示：BTC / ETH 数量、USD 成交额或对应标的币种报价，不使用统一金额单位</dd></div>
   <div><dt>来源快照时间</dt><dd>{report.clocks.source_as_of}；各行 creation_timestamp 单独保留，过滤到期合约不改写来源时间</dd></div>
   <div><dt>采集开始 / 最近成功获取</dt><dd>{report.clocks.acquisition_started_at} / {report.clocks.fetched_at}</dd></div>
   <div><dt>合约元数据获取时间</dt><dd>{report.coverage.source_currencies.map(currency=>`${currency}: ${report.clocks.metadata_fetched_at[currency]}`).join(' / ')}</dd></div>
   <div><dt>来源精确发布时间 / 发布延迟</dt><dd>未提供，保留 null / source_delay_unconfirmed；不认定拟议延迟政策已生效，也不保证实时</dd></div>
   <div><dt>原生结构 / 输入结构</dt><dd>{report.native_schema} / {report.normalization.input_schema??'未保留'}{report.normalization.legacy_btc_normalized?'；旧版 BTC 输入由原读取器规范化，没有补造 ETH':''}；文件只保留当前可见行</dd></div>
  </dl>
  <BlobEvidenceDownload report={report} filename={deribitExportFilename(report)} onDownload={onDownload}/>
  <p>下载仅保存到你的设备，不上传或分享。下载包含全部当前未到期合约，不受标的、到期日、Call / Put、搜索或合约选择影响。失效后入口与本地 Blob 撤下，已下载文件不能自动撤回。</p>
  <p>volume_usd 是来源24小时成交额（USD），不是净流入或持仓估值。volume、OI、合约大小使用每行标的币种，不是整数合约张数。报价为 BTC / 标的 BTC 或 ETH / 标的 ETH。各指标、币种与合约不相加、不自行换算。</p>
  <p>24小时统计的精确起止时间、最近成交的实际发生时间未知，保留 null；行创建时间不是交易或发布时间。来源空值与报告零值分开保留。标记波动率与涨跌仍在原生可见行中，未扩展为整理指标。</p>
  <p><a href={report.source.urls[0]} target="_blank" rel="noreferrer">官方行情字段说明</a> · <a href={report.source.terms_url} target="_blank" rel="noreferrer">Deribit 使用条款</a>；不声明再分发许可。</p>
  <div className={s.scroll}><table><caption>当前证据字段 · {report.rows.length} 条（预览前 {preview.length} 条，JSON 包含全部当前可见合约；不求和）</caption>
   <thead><tr><th>期权合约 / 标的</th><th>到期 / 类型 / 行权价 / 大小</th><th>来源行时间</th><th>指标</th><th>原值</th><th>本行单位</th><th>原字段路径</th></tr></thead>
   <tbody>{preview.map(row=><tr key={row.id}>
    <td>{row.dimension.label}<small className={s.identity}>{row.dimension.namespace}:{row.dimension.id} · {row.instrument.underlying_currency}</small></td>
    <td>{new Date(row.instrument.expiration_timestamp).toISOString()}<small className={s.identity}>{row.instrument.option_type} · {row.instrument.strike} USD · {row.instrument.contract_size} {row.instrument.contract_size_unit}</small></td>
    <td>{new Date(row.observation.creation_timestamp).toISOString()}<small className={s.identity}>{row.observation.native_locator}</small></td>
    <td>{row.metric_label}<small className={s.identity}>{row.observation.window==='rolling_24_hours'?'24小时统计':row.observation.window==='last_trade_time_unknown'?'成交时间未知':'来源快照字段'} · 发布延迟未确认</small></td>
    <td>{row.state==='reported'?String(row.value):'来源空值 · null'}</td><td>{row.unit.code}</td><td>{row.native_locator}</td>
   </tr>)}</tbody>
  </table></div>
 </details>;
}
