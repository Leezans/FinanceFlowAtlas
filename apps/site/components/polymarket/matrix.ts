import type {PolymarketMarket} from '@/lib/polymarket/model';
import type {MatrixGroup,MatrixItem} from '@/lib/matrix/model';
export type Metric='probability'|'volume';
/** Shift validated source decimal text by two places, without rounding a
 * positive price to 0% or a price below one to 100%. */
export function formatProbability(price:string|null):string{
 if(price===null)return '来源未提供';
 const [whole,fraction='']=price.split('.');
 const integer=(whole+fraction.padEnd(2,'0').slice(0,2)).replace(/^0+(?=\d)/,'');
 const tail=fraction.slice(2).replace(/0+$/,'');
 return `${integer}${tail?'.'+tail:''}%`;
}
/** Volume is a source JSON number with an unverified unit, not money. Keep its
 * represented precision; scientific notation avoids hundreds of leading zeros. */
export function formatSourceVolume(value:number):string{
 return value>0&&value<1e-20?String(value):value.toLocaleString('zh-CN',{maximumSignificantDigits:21});
}
export function namedOutcome(row:PolymarketMarket){
 const binary=row.outcomes.length===2&&row.outcomes.some(o=>o.name.toLowerCase()==='yes')&&row.outcomes.some(o=>o.name.toLowerCase()==='no');
 return binary?row.outcomes.find(o=>o.name.toLowerCase()==='yes')!:row.outcomes[0];
}
export function marketItem(row:PolymarketMarket,metric:Metric):MatrixItem{
 const outcome=namedOutcome(row),value=metric==='probability'?(outcome.price===null?null:Number(outcome.price)):row.volume_24h;
 return {id:row.id,label:row.question,weight:1,colorValue:value,
 displayValue:value===null?'来源未提供':metric==='probability'?formatProbability(outcome.price):`${formatSourceVolume(value)} · 来源单位`,
 detail:metric==='probability'?`结果：${outcome.name} · 价格隐含概率`:'平台报告的 24 小时成交量 · 单位待核实'};
}
export function categoryKey(row:PolymarketMarket){return `${row.category_basis}:${row.category}`;}
export function categoryLabel(row:PolymarketMarket){return `${row.category} · ${row.category_basis==='source_category'?'来源分类':row.category_basis==='source_tag'?'来源标签':'来源未分类'}`;}
export function filterMarkets(rows:PolymarketMarket[],query:string){const q=query.trim().toLocaleLowerCase();return rows.filter(r=>!q||`${r.question} ${r.category} ${r.tags.map(t=>`${t.label} ${t.slug}`).join(' ')} ${r.outcomes.map(o=>o.name).join(' ')}`.toLocaleLowerCase().includes(q));}
export function categoryMatrix(rows:PolymarketMarket[]):MatrixGroup[]{
 const categories=new Map<string,{row:PolymarketMarket;count:number}>();
 for(const row of rows){const key=categoryKey(row),old=categories.get(key);categories.set(key,{row,count:(old?.count??0)+1});}
 return [{id:'categories',label:'来源分类与标签',items:[...categories].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([id,{row,count}])=>({id,label:categoryLabel(row),displayValue:`${count} 个市场`,detail:'点击查看完整市场问题',colorValue:count,weight:1}))}];
}
export function marketMatrix(rows:PolymarketMarket[],category:string,metric:Metric):MatrixGroup[]{const selected=rows.filter(r=>categoryKey(r)===category);return selected.length?[{id:category,label:categoryLabel(selected[0]),items:selected.map(r=>marketItem(r,metric))}]:[];}

/** Only verified USDC open-interest values declare monetary comparability. */
export function interestMatrix(rows:PolymarketMarket[],values:ReadonlyMap<string,number>):MatrixGroup[]{
 return rows.length?[{id:'open-interest',label:'热门样本中的未平仓持仓',items:rows.map(row=>{
  const value=row.condition_id?values.get(row.condition_id)??null:null;
  return {id:row.id,label:row.question,displayValue:value===null?'来源未返回':`${formatSourceVolume(value)} USDC`,colorValue:value,amount:{value,currency:'USDC',comparisonKey:'polymarket-priced-gross-open-interest'},detail:'当前样本的持仓估值 · 非成交额、非净流入'};
 })}]:[];
}
