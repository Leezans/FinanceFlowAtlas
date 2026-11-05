import {MAX_CACHE_AGE_MS} from '@/lib/crypto/kraken';
import type {KrakenTradeSnapshot} from '@/lib/crypto/trades';
import type {MatrixGroup} from '@/lib/matrix/model';
import {formatCryptoNumber,formatDeviation} from './matrix';

export const tradeTimestamp=(value:string|null)=>value?value.replace('T',' ').replace('Z',' UTC'):'区间内无返回成交';
/** Presentation gate only: callers supply validated evidence, never raw provider data. */
export function visibleTradeSnapshot(snapshot:KrakenTradeSnapshot|null|undefined,quoteVisible:boolean,now:number):KrakenTradeSnapshot|null{
 if(!quoteVisible||!snapshot)return null;
 const acquisitions=[snapshot.fetched_at,...snapshot.rows.map(row=>row.fetched_at)];
 return acquisitions.every(time=>{const age=now-Date.parse(time);return Number.isFinite(age)&&age>=0&&age<=MAX_CACHE_AGE_MS;})?snapshot:null;
}
export function tradeMatrixGroups(snapshot:KrakenTradeSnapshot|null):MatrixGroup[]{
 if(!snapshot)return [];
 const items=snapshot.rows.map(row=>({id:row.pair,label:row.pair,
  amount:{value:row.coverage==='capped_response'||row.imbalance_usd===null?null:Number(row.imbalance_usd),currency:'USD',comparisonKey:`kraken:trade-imbalance:${snapshot.window_started_at}:${snapshot.window_ended_at}:usd-spot`},
  displayValue:row.coverage==='capped_response'?'覆盖不完整 · 金额不展示':`${formatCryptoNumber(row.imbalance_usd!)} USD`,
  colorValue:row.coverage==='capped_response'?null:row.imbalance_pct,
  detail:row.coverage==='capped_response'?`已获取 ${row.page_count??1} 页，累计返回 ${row.returned_count} 笔；末页 ${row.last_page_count??row.returned_count} / ${snapshot.trade_limit} 笔，触及上限，覆盖未知；不是零`:
   `买标记成交额 − 卖标记成交额 · 买卖差额比 ${row.imbalance_pct===null?'无可计算成交额':formatDeviation(row.imbalance_pct)} · 区间内 ${row.trade_count} 笔`,
 }));
 return items.length?[{id:'kraken-trade-imbalance',label:'Kraken · 所选 USD 现货交易对 · 不推断行业',items}]:[];
}
