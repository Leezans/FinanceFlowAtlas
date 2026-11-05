import type {MatrixGroup} from '@/lib/matrix/model';
import {HOSTS,SECTORS} from '@/lib/asean/dimensions';
import type {FdiCell,FdiSnapshot} from '@/lib/asean/model';
export const valueText=(value:number)=>`${value>0?'+':''}${value!==0&&Math.abs(value)<0.01?value.toExponential(2):value.toLocaleString('en-US',{maximumFractionDigits:2})}`;
export function cellText(cell:FdiCell){return cell.state==='reported'?valueText(cell.value!):cell.state==='source_na'?'n.a':cell.state==='duplicate'?'重复 · 隔离':'缺失';}
export function cellExplanation(cell:FdiCell){return cell.state==='reported'?'来源报告的年度净流入':cell.state==='source_na'?'来源 n.a 可能表示保密、未提供、零或微量，不能直接视为零':cell.state==='duplicate'?'同一国家／行业／年份存在多条来源记录；不求和、不择一':'本次响应未返回该坐标，数值未知';}
export function colorKey(cell:FdiCell,maximum:number){if(cell.state!=='reported'||cell.value===null)return cell.state;if(cell.value===0)return 'zero';return `${cell.value>0?'positive':'negative'}-${Math.min(3,Math.max(1,Math.ceil(Math.abs(cell.value)/(maximum>0?maximum:1)*3)))}`;}
export function yearCells(snapshot:FdiSnapshot,year:number){return snapshot.cells.filter(c=>c.year===year);}
export function yearMaximum(cells:FdiCell[]){return Math.max(0,...cells.filter(c=>c.state==='reported').map(c=>Math.abs(c.value!)));}

/** One country's specific sectors only. Unspecified/mixed aggregates never share area. */
export function fdiMonetaryGroups(cells:FdiCell[],year:number,host:string):MatrixGroup[]{
 const country=HOSTS.find(country=>country.code===host);
 if(!country)return [];
 const selected=cells.filter(cell=>cell.year===year&&cell.host===host&&cell.sector!=='Z'&&!(host==='SG'&&cell.sector==='N'));
 const metric=host==='PH'?'net-equity-capital':'net-inward-fdi';
 return selected.length?[{id:host,label:country.label,items:selected.map(cell=>({
  id:cell.sector,label:SECTORS.find(sector=>sector.code===cell.sector)?.label??cell.sector,
  displayValue:`${cellText(cell)}${cell.state==='reported'?' 百万美元':''}`,
  detail:`${year} · ${country.label} · ${cell.sector} · ${cellExplanation(cell)}`,
  colorValue:cell.state==='reported'?cell.value:null,
  amount:{value:cell.state==='reported'&&cell.value!==null?cell.value*1_000_000:null,currency:'USD',comparisonKey:`asean:${metric}:${year}:${host}:specific-sectors`},
 }))}]:[];
}
