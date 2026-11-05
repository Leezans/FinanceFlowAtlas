import type {FxVenueSnapshot} from '@/lib/fx/venue';
import type {MatrixGroup} from '@/lib/matrix/model';
import {formatCryptoNumber,formatDeviation} from '@/components/crypto/matrix';
import {currencyNames} from './matrix';

export type FxVenueMetric = 'rate' | 'vwap_24h' | 'volume_base_24h' | 'trades_24h';
export const fxVenueMetrics: readonly {id: FxVenueMetric; label: string}[] = [
  {id:'rate',label:'最近成交汇率'}, {id:'vwap_24h',label:'24h 成交均价'},
  {id:'volume_base_24h',label:'24h 基础币成交量'}, {id:'trades_24h',label:'24h 成交笔数'},
];
export function fxVenueGroups(snapshot: FxVenueSnapshot | null, metric: FxVenueMetric): MatrixGroup[] {
  if (!snapshot?.rows.length) return [];
  return [{id:'kraken-fiat',label:'Kraken · 法币现货 · USD 报价',items:snapshot.rows.map(row=>({
    id:row.pair,label:`${row.pair} · ${currencyNames[row.base]}`,
    displayValue:`${formatCryptoNumber(row[metric])} ${metric==='volume_base_24h'?row.base:metric==='trades_24h'?'笔':'USD'}`,
    detail:metric==='rate'?`1 ${row.base} = ${row.rate} USD · 相对 24h 成交均价 ${formatDeviation(row.price_vwap_deviation_pct)}，不是日涨跌；汇率观测时间未知`
      :metric==='volume_base_24h'?`滚动 24 小时 · ${row.base} 数量，不能与其他基础币相加，不是净资金流`
      :metric==='trades_24h'?'滚动 24 小时成交笔数，不是买卖净额'
      :`滚动 24 小时成交量加权汇率 · USD / ${row.base}`,
    colorValue:metric==='rate'?row.price_vwap_deviation_pct:null,
  }))}];
}
