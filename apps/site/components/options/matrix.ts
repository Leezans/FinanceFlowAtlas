import type {OptionRow,OptionsSnapshot} from '@/lib/options/model';
import type {MatrixGroup} from '@/lib/matrix/model';
export const numberText=(n:number|null)=>n===null?'未提供':n.toLocaleString('zh-CN',{maximumFractionDigits:8});
export const expiryText=(n:number)=>new Date(n).toISOString().slice(0,10);
export const changeText=(n:number|null)=>n===null?'无成交或涨跌未提供':`${n>0?'+':''}${numberText(n)}%`;
export function optionRows(snapshot:OptionsSnapshot|null,query='',expiry='',type=''):OptionRow[]{
 return (snapshot?.rows??[]).filter(row=>row.instrument.toUpperCase().includes(query.trim().toUpperCase())&&(!expiry||String(row.expiration_timestamp)===expiry)&&(!type||row.option_type===type));
}
export function optionsMatrixGroups(snapshot:OptionsSnapshot|null,query='',expiry='',type=''):MatrixGroup[]{
 if(!snapshot)return [];
 const groups=new Map<number,MatrixGroup>();
 for(const row of optionRows(snapshot,query,expiry,type)){
  const group=groups.get(row.expiration_timestamp)??{id:String(row.expiration_timestamp),label:`${expiryText(row.expiration_timestamp)} 到期（UTC）`,items:[]};
  group.items.push({id:row.instrument,label:row.instrument,displayValue:`${numberText(row.volume_usd)} USD`,detail:`${row.option_type==='call'?'看涨 Call':'看跌 Put'} · 来源24h价格变化 ${changeText(row.volume===0?null:row.price_change)}`,colorValue:row.volume===0?null:row.price_change,amount:{value:row.volume_usd,currency:'USD',comparisonKey:`deribit/BTC/volume_usd/rolling24h/${snapshot.source_as_of}/${snapshot.acquisition_started_at}`}});
  groups.set(row.expiration_timestamp,group);
 }
 return [...groups.entries()].sort(([a],[b])=>a-b).map(([,group])=>group);
}
