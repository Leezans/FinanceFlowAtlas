import type {OptionRow,OptionsSnapshot} from '@/lib/options/model';
import type {MatrixGroup} from '@/lib/matrix/model';
export const numberText=(n:number|null)=>n===null?'未提供':n.toLocaleString('zh-CN',{maximumFractionDigits:8});
export const expiryText=(n:number)=>new Date(n).toISOString().slice(0,10);
export const changeText=(n:number|null)=>n===null?'无成交或涨跌未提供':`${n>0?'+':''}${numberText(n)}%`;
export function optionRows(snapshot:OptionsSnapshot|null,query='',expiry='',type='',underlying=''):OptionRow[]{
 return (snapshot?.rows??[]).filter(row=>row.instrument.toUpperCase().includes(query.trim().toUpperCase())&&(!expiry||String(row.expiration_timestamp)===expiry)&&(!type||row.option_type===type)&&(!underlying||row.underlying_currency===underlying));
}
export function optionsMatrixGroups(snapshot:OptionsSnapshot|null,query='',expiry='',type='',underlying=''):MatrixGroup[]{
 if(!snapshot)return [];
 const groups=new Map<string,MatrixGroup>();
 // Both currencies use the same source-declared USD metric, 24h window and snapshot.
 // Never convert their BTC/ETH volumes, quotes or OI into money.
 const comparisonKey=`deribit/${snapshot.currencies.join('+')}/volume_usd/rolling24h/${snapshot.source_as_of}/${snapshot.acquisition_started_at}`;
 for(const row of optionRows(snapshot,query,expiry,type,underlying)){
  const key=`${row.underlying_currency}/${row.expiration_timestamp}`;
  const group=groups.get(key)??{id:key,label:`${row.underlying_currency} · ${expiryText(row.expiration_timestamp)} 到期（UTC）`,items:[]};
  group.items.push({id:row.instrument,label:row.instrument,displayValue:`${numberText(row.volume_usd)} USD`,detail:`${row.underlying_currency} · ${row.option_type==='call'?'看涨 Call':'看跌 Put'} · 来源24h价格变化 ${changeText(row.volume===0?null:row.price_change)}`,colorValue:row.volume===0?null:row.price_change,amount:{value:row.volume_usd,currency:'USD',comparisonKey}});
  groups.set(key,group);
 }
 return [...groups.entries()].sort(([a],[b])=>{const [ac,at]=a.split('/'),[bc,bt]=b.split('/');return ac.localeCompare(bc)||Number(at)-Number(bt);}).map(([,group])=>group);
}
