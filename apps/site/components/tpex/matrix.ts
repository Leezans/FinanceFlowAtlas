import type {MatrixGroup} from '@/lib/matrix/model';
import {intensity,type Participant,type TpexSnapshot,type Trading} from '@/lib/tpex/model';
import {industryLabel} from '@/lib/tpex/industries';
export {industryLabel} from '@/lib/tpex/industries';
export const signed=(value:number)=>`${value>0?'+':''}${value.toLocaleString('zh-CN')}`;
export function industries(snapshot:TpexSnapshot,participant:Participant){
 return [...new Set(snapshot.rows.map(r=>r.industry_code))].sort().map(code=>{
  const rows=snapshot.rows.filter(r=>r.industry_code===code),known=rows.filter(r=>r.flow!==null);
  const totals=known.length?known.reduce<Trading>((sum,r)=>({buy:sum.buy+r.flow![participant].buy,sell:sum.sell+r.flow![participant].sell,net:sum.net+r.flow![participant].net}),{buy:0,sell:0,net:0}):null;
  return {code,label:industryLabel(code),rows,known:known.length,missing:rows.length-known.length,totals};
 });
}
export function tpexMatrixGroups(snapshot:TpexSnapshot,participant:Participant,industry:string|null):MatrixGroup[]{
 const groups=industries(snapshot,participant);
 if(industry===null)return [{id:'industries',label:'TPEx 官方产业分类',items:groups.map(g=>({id:g.code,label:g.label,displayValue:g.totals?`${signed(g.totals.net)} 股`:'缺失',detail:`已报告 ${g.known}/${g.rows.length} 家${g.missing?' · 部分覆盖':''}`,colorValue:intensity(g.totals),weight:1}))}];
 const g=groups.find(g=>g.code===industry);if(!g)return [];
 return [{id:g.code,label:g.label,items:g.rows.map(r=>({id:r.code,label:r.name,displayValue:r.flow?`${signed(r.flow[participant].net)} 股`:'缺失',detail:`${r.code} · ${snapshot.report_date}`,colorValue:intensity(r.flow?.[participant]??null),weight:1}))}];
}
