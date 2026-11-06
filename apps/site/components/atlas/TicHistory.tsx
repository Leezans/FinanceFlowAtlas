"use client";
import React from 'react';
import {historySchema, type TicHistory as History} from '../../lib/tic/history';
import {signedMillions} from '@/lib/tic/model';
import {timestamp} from './model';
import {useTicResource} from './useTicResource';
const parseHistory=(value:unknown):History=>historySchema.parse(value);

export default function TicHistory() {
 const {data,error,stale,loading,stopped,refresh}=useTicResource('/api/v1/flows/tic/history',parseHistory);
 const maximum = Math.max(1, ...data?.observations.map(r => Math.abs(r.net_foreign_purchases_usd ?? 0)) || []);
 return <section className="tic-history" aria-label="美国股权境外净交易历史">
  <div className="history-heading"><div><span className="eyebrow">美国 · US ISSUER OVERVIEW</span>
   <h3>境外居民净买卖美国股权</h3><p>{data ? `${data.start_period} 至 ${data.end_period}` : '等待来源核验最近 12 个月'} · 含基金份额 · 月度，非实时</p></div>
   <button disabled={loading||stopped} onClick={() => void refresh()} aria-label="刷新美国历史数据">刷新历史 ↻</button></div>
  <p className="history-scope">原表 Grand Total，独立于国家矩阵筛选。不是美国全市场资金流，也不代表个股资金流。</p>
  {stale && <p className="notice warning" role="status">历史来源检查失败或逾期，显示最后核验快照。</p>}
  {error && <p className="notice warning" role="status">{error} 缺失不按零处理。</p>}
  {!data && !error && <p role="status">{loading ? '正在读取官方历史净交易…' : '暂无核验历史数据。'}</p>}
  {data && <><div className="history-chart-scroll"><svg className="history-chart" viewBox="0 0 840 270" role="img" aria-label="境外居民对美国股权的月度净交易，单位百万美元">
   <title>美国股权境外净交易：正值净买入，负值净卖出；缺失月份不按零绘制。</title>
   <text x="8" y="16" className="history-axis-label">USD millions</text>
   <text x="8" y="42" className="history-axis-label">{signedMillions(maximum)}</text>
   <text x="8" y="139" className="history-axis-label">0</text>
   <text x="8" y="235" className="history-axis-label">{signedMillions(-maximum)}</text>
   <line x1="82" y1="135" x2="832" y2="135" className="history-baseline" />
   {data.observations.map((row, i) => {
    const value = row.net_foreign_purchases_usd; const x = 90 + i * 62; const height = value === null ? 0 : Math.abs(value) / maximum * 92;
    return <g key={row.period} data-period={row.period} data-state={row.state}>
     <title>{`${row.period} · ${value === null ? '未报告' : signedMillions(value) + ' USD millions'}`}</title>
     {value === null ? <text x={x + 22} y="125" textAnchor="middle" className="history-missing">缺失</text> : value === 0 ?
      <line x1={x} x2={x + 44} y1="135" y2="135" className="history-zero" /> :
      <rect x={x} y={value > 0 ? 135 - height : 135} width="44" height={height} className={value > 0 ? 'history-positive' : 'history-negative'} data-sign={value > 0 ? 'positive' : 'negative'} />}
     <text x={x + 22} y="257" textAnchor="middle" className="history-month">{row.period}</text>
    </g>;
   })}
  </svg></div><p className="history-legend"><span className="history-buy-key" /> 正值：境外净买入 <span className="history-sell-key" /> 负值：境外净卖出 · 零值单独标记，缺失保留空档</p>
  <details className="history-details"><summary>历史数值与来源证据</summary>
   <div className="table-scroll"><table aria-label="美国股权境外净交易历史数值"><thead><tr><th>观测月份</th><th>原表 Grand Total · USD millions</th><th>状态</th></tr></thead>
    <tbody>{data.observations.map(row => <tr key={row.period}><td>{row.period}</td><td>{signedMillions(row.net_foreign_purchases_usd)}</td><td>{row.state === 'reported' ? '已报告' : '未报告，不是零'}</td></tr>)}</tbody></table></div>
   <p>全部月份来自同一次获取的来源版本，历史值可能修订。与逐国快照单独缓存，不用于相减或拼接。未计算区间累计，未从国家行相加构造总计。</p>
   <p>这不是各月份首次公布时的版本；历史逐月首次发布日期未核验。窗口自动截止于本次来源表中最新通过核验的月份 {data.end_period}；获取时间不是发布日期。</p>
   <p><a href={data.source_url} target="_blank" rel="noreferrer">U.S. Treasury TIC · SLT Table 1 ↗</a> · 字段 {data.source_field}</p>
   <p>获取时间：{timestamp(data.retrieved_at)}<br/>来源 SHA-256：<span className="history-hash">{data.raw_sha256}</span></p>
  </details></>}
 </section>;
}
