import {hierarchy,treemap,treemapSquarify,type HierarchyRectangularNode} from 'd3-hierarchy';
import type {TicFlow} from './ticModel';
import countries from './countries.json';
export type TreeDatum={name:string;region?:string;row?:TicFlow;children?:TreeDatum[]};
const regions=new Map(countries.map(c=>[c.iso3,c.region]));
export const regionName=(region:string)=>({Asia:'亚洲',Europe:'欧洲',Americas:'美洲',Africa:'非洲',Oceania:'大洋洲',Antarctic:'南极洲',Other:'其他'}[region]||region);
export const countryRegion=(iso:string)=>regions.get(iso)||'Other';
export function treemapLayout(rows:TicFlow[],region='',width=1100,height=570){
 const included=rows.filter(r=>!region||countryRegion(r.foreign_economy_iso3)===region);
 const nonzero=included.filter(r=>r.net_foreign_purchases_usd!==0);
 const groups=new Map<string,TicFlow[]>();for(const row of nonzero){const key=countryRegion(row.foreign_economy_iso3);groups.set(key,[...(groups.get(key)||[]),row])}
 const data:TreeDatum={name:'全部已报告国家',children:[...groups].map(([name,children])=>({name,region:name,children:children.map(row=>({name:row.foreign_economy_name,region:name,row}))}))};
 const root=hierarchy(data).sum(d=>d.row?Math.abs(d.row.net_foreign_purchases_usd):0).sort((a,b)=>(b.value||0)-(a.value||0)||a.data.name.localeCompare(b.data.name));
 const result=treemap<TreeDatum>().tile(treemapSquarify).size([width,height]).paddingOuter(2).paddingInner(2).paddingTop(n=>n.depth===1?24:0).round(true)(root);
 return {root:result,regions:result.children||[],tiles:nonzero.length?result.leaves():[] as HierarchyRectangularNode<TreeDatum>[],zeros:included.filter(r=>r.net_foreign_purchases_usd===0),denominator:nonzero.reduce((sum,r)=>sum+Math.abs(r.net_foreign_purchases_usd),0),included};
}
