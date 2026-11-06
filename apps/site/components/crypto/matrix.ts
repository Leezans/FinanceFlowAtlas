import type {KrakenRow,KrakenSnapshot} from '@/lib/crypto/kraken';
import type {MatrixGroup} from '@/lib/matrix/model';

export type CryptoMetric='last_price_usd'|'vwap_usd_24h'|'volume_base_24h'|'trades_24h';
export const cryptoMetrics:ReadonlyArray<{id:CryptoMetric;label:string}>=[
 {id:'last_price_usd',label:'最近成交价格'},
 {id:'vwap_usd_24h',label:'24h 成交均价'},
 {id:'volume_base_24h',label:'24h 成交量'},
 {id:'trades_24h',label:'24h 成交笔数'},
];
/** Decimal text is not parsed and re-rounded for presentation. */
export function formatCryptoNumber(value:string|number):string{
 const [whole,fraction='']=String(value).split('.'),tail=fraction.replace(/0+$/,'');
 return whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')+(tail?'.'+tail:'');
}
/** Keep the source's 12 decimal places until after subtraction. Converting two
 * nearby prices to Number first can round both to the same value and erase a
 * known direction. Only the final presentation ratio uses floating point.
 */
function quoteInteger(value:string):bigint|null{
 if(!/^(?:0|[1-9]\d{0,14})(?:\.\d{1,12})?$/.test(value))return null;
 const [whole,fraction='']=value.split('.');
 const integer=BigInt(whole)*BigInt(10)**BigInt(12)+BigInt(fraction.padEnd(12,'0'));
 return integer>BigInt(0)?integer:null;
}
/** A calculated price/VWAP comparison, never a return, volume flow or valuation. */
export function priceVwapDeviation(row:KrakenRow):number|null{
 const price=quoteInteger(row.last_price_usd),vwap=quoteInteger(row.vwap_usd_24h);
 if(price===null||vwap===null)return null;
 const value=Number(price-vwap)/Number(vwap)*100;
 return Number.isFinite(value)?value:null;
}
export function formatDeviation(value:number|null):string{
 if(value===null)return '未能计算';
 if(value!==0&&Math.abs(value)<0.0001)return `${value>0?'+':'−'}<0.0001%`;
 return `${value>0?'+':value<0?'−':''}${Math.abs(value).toLocaleString('zh-CN',{maximumFractionDigits:4})}%`;
}
export function cryptoColorMaximum(snapshot:KrakenSnapshot|null):number{
 return Math.max(0,...(snapshot?.rows.map(row=>Math.abs(priceVwapDeviation(row)??0))??[]));
}
export function cryptoMatrixGroups(snapshot:KrakenSnapshot|null,metric:CryptoMetric,query=''):MatrixGroup[]{
 if(!snapshot)return [];
 const term=query.trim().toUpperCase(),rows=snapshot.rows.filter(row=>row.pair.includes(term));
 if(!rows.length)return [];
 return [{id:'kraken-spot',label:`Kraken · ${rows.length} 组已核验 USD 现货交易对`,items:rows.map(row=>{
  const unit=metric==='volume_base_24h'?row.base:metric==='trades_24h'?'笔':'USD';
  const detail=metric==='last_price_usd'?`相对 24h 成交均价 ${formatDeviation(priceVwapDeviation(row))} · 均价 ${formatCryptoNumber(row.vwap_usd_24h)} USD`
   :metric==='volume_base_24h'?`滚动 24 小时 · ${row.base} 数量，不是 USD 金额；不同币种不能相加`
   :metric==='trades_24h'?'滚动 24 小时成交笔数；不是买卖净额或资金流'
   :'滚动 24 小时成交量加权均价；不是收益率或可成交报价';
  return {id:row.pair,label:row.pair,displayValue:`${formatCryptoNumber(row[metric])} ${unit}`,detail,
   colorValue:metric==='last_price_usd'?priceVwapDeviation(row):null};
 })}];
}
