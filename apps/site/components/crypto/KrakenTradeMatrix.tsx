'use client';
import React from 'react';
import MatrixHeatmap from '@/components/matrix/MatrixHeatmap';
import {KRAKEN_TRADES_DOCS,KRAKEN_TAKER_DOCS,TRADE_PAIRS,type KrakenTradeSnapshot} from '@/lib/crypto/trades';
import {formatCryptoNumber} from './matrix';
import {tradeMatrixGroups,tradeTimestamp} from './trade-matrix';
import s from './crypto.module.css';
import {DEFAULT_TRADE_TIMEFRAME,type TradeTimeframe} from '@/lib/crypto/selection';

type Props={snapshot:KrakenTradeSnapshot|null;selected?:readonly string[];timeframe?:TradeTimeframe};
export default function KrakenTradeMatrix({snapshot,selected=TRADE_PAIRS,timeframe=DEFAULT_TRADE_TIMEFRAME}:Props){
 const minutes=(snapshot?.window_ms??(timeframe==='1m'?60_000:300_000))/60_000;
 return <section className={s.tradeSection} aria-label="来源买卖标记成交额差矩阵工作区">
  <MatrixHeatmap layout="treemap" stretchSmallGroups groups={tradeMatrixGroups(snapshot)} title={`${minutes} 分钟来源买卖标记成交额差 · USD`} description={`仅 Kraken 的 ${selected.join("、")}；按 REST b/s 买卖标记统计已执行 USD 成交额之差（b − s）。`} areaMeaning={`面积按同一 ${minutes} 分钟区间买卖标记成交额差的绝对值（USD）；覆盖不完整不参与面积`} colorMeaning="（买标记成交额 − 卖标记成交额）÷ 两者之和；固定 −100% 至 +100%，红=买标记成交额更多，绿=卖标记成交额更多；缺失或覆盖不完整不着色" colorMode="signed" colorMaxAbs={100} emptyTitle="逐笔成交证据暂不可用" emptyMessage="仅展示通过校验且未过期的成交快照；缺失、过期或覆盖不完整不填成零。" emptyNote="这是指定历史区间的返回成交，不保证覆盖完整市场或当前时刻。"/>
  <p className={s.matrixNote}>每笔成交始终同时存在买方和卖方。REST b/s 的成交发起方约定未在本页所引 REST 文档中明确，不把它称为主动买卖资金流。这个差额不是全球资金净流入、交易所充值提现或跨境资金流；不跨币种合计，也不把重叠快照累加。</p>
  {snapshot&&<>
   <p className={s.matrixNote}>共同统计区间（{minutes} 分钟）：{tradeTimestamp(snapshot.window_started_at)}（含）至 {tradeTimestamp(snapshot.window_ended_at)}（不含）。快照获取：{tradeTimestamp(snapshot.fetched_at)}。这是固定区间证据，不随页面时钟滚动；上方陈旧状态同样适用于本矩阵。</p>
   {snapshot.missing_pairs.length>0&&<p className={s.matrixNote} role="status">官方在线 USD 现货目录未纳入：{snapshot.missing_pairs.join('、')}。未请求、不显示金额，也不替代为其他交易对。</p>}
   <details className={s.tradeDetails}><summary>逐交易对成交额、时间与覆盖明细</summary>
    {snapshot.rows.map(row=><section key={row.pair} aria-label={`${row.pair} 成交证据`}><h3>{row.pair}</h3>
     <p>{row.coverage==='capped_response'?'最后一页触及返回条数上限，区间覆盖未知（可能不完整）；买标记成交额、卖标记成交额、差额和颜色均不展示。':'末页返回条数未触及上限：仅统计来源返回的成交，末页为短页；不代表已核验全市场完整性。'}</p>
     {row.coverage==='uncapped_response'&&<dl><dt>买标记成交额</dt><dd>{formatCryptoNumber(row.buy_notional_usd!)} USD</dd><dt>卖标记成交额</dt><dd>{formatCryptoNumber(row.sell_notional_usd!)} USD</dd><dt>买标记成交额 − 卖标记成交额</dt><dd>{formatCryptoNumber(row.imbalance_usd!)} USD</dd></dl>}
     <p>已获取 {row.page_count??1} 页{snapshot.page_limit?` / 最多 ${snapshot.page_limit} 页`:null}；累计返回 {row.returned_count} 笔；每页上限 {snapshot.trade_limit} 笔；末页返回 {row.last_page_count??row.returned_count} 笔；区间内 {row.trade_count} 笔；区间结束及之后排除 {row.excluded_after_window_count} 笔。</p>
     <p>区间内首笔：{tradeTimestamp(row.first_trade_at)}<br/>区间内末笔：{tradeTimestamp(row.last_trade_at)}<br/>本交易对获取：{tradeTimestamp(row.fetched_at)}</p>
    </section>)}
   </details>
  </>}
  <p className={s.tradeLinks}><a href={KRAKEN_TRADES_DOCS} target="_blank" rel="noreferrer">Kraken 官方逐笔成交说明 ↗</a><a href={KRAKEN_TAKER_DOCS} target="_blank" rel="noreferrer">对照 WebSocket 字段（非本页采集） ↗</a></p>
 </section>;
}
