import {describe,expect,it} from 'vitest';
import {matrixAreaModel, monetaryTreemap} from '../lib/matrix/layout';
import type {MatrixGroup, MatrixItem} from '../lib/matrix/model';
const amount = (id:string,value:number|null,currency='USD',comparisonKey='metric:2026'):MatrixItem => ({id,label:id,displayValue:String(value),colorValue:value,amount:{value,currency,comparisonKey}});
const group = (...items:MatrixItem[]):MatrixGroup => ({id:'a',label:'Group A',items});
describe('honest monetary area allocation',()=>{
 it('preserves 100:10:1 ratios and signed magnitudes without padding or rounding',()=>{
  const groups=[group(amount('large',100),amount('negative',-10),amount('small',1))];
  const layout=monetaryTreemap(groups,1100,520);
  const areas=Object.fromEntries(layout.leaves.map(r=>[r.entry.item.id,r.width*r.height]));
  expect(areas.large/areas.negative).toBeCloseTo(10,10);expect(areas.negative/areas.small).toBeCloseTo(10,10);
  expect(Object.values(areas).reduce((a,b)=>a+b,0)).toBeCloseTo(1100*520,8);
 });
 it('keeps group rectangles additive with no sign cancellation',()=>{
  const groups=[group(amount('buy',100),amount('sell',-100)),{id:'b',label:'Group B',items:[amount('small',10)]}];
  const result=monetaryTreemap(groups,375,440);
  for(const g of result.groups){const leaves=result.leaves.filter(r=>r.entry.group.id===g.id);expect(leaves.reduce((sum,r)=>sum+r.width*r.height,0)).toBeCloseTo(g.width*g.height,8);}
  const [a,b]=result.groups;expect(a.width*a.height/(b.width*b.height)).toBeCloseTo(20,10);
 });
 it('never assigns fake area to missing, zero, invalid values or legacy weights',()=>{
  const groups=[group(amount('known',1),amount('zero',0),amount('null',null),amount('nan',NaN),amount('infinity',Infinity))];
  const model=matrixAreaModel(groups);expect(model.weighted.map(e=>e.item.id)).toEqual(['known']);expect(monetaryTreemap(groups,100,100).leaves).toHaveLength(1);
  expect(monetaryTreemap([group({id:'fake',label:'12 USD',displayValue:'12 USD',weight:100,colorValue:500})],100,100).leaves).toHaveLength(0);
  expect(matrixAreaModel([group(amount('zero',0),amount('missing',null))]).compatible).toBe(true);
 });
 it('fails closed across currencies, periods, metrics, missing declarations and unknown units',()=>{
  for(const items of [[amount('usd',1),amount('eur',2,'EUR')],[amount('2026',1),amount('2025',2,'USD','metric:2025')],[amount('price',1,'','')],[amount('usd',1),{id:'no',label:'no',displayValue:'?'}]]){
   expect(matrixAreaModel([group(...items)]).compatible).toBe(false);expect(monetaryTreemap([group(...items)],100,100).leaves).toEqual([]);
  }
 });
 it('normalizes large finite values without overflow and retains tiny nonzero rows',()=>{
  const groups=[group(amount('huge',1e308),amount('same',-1e308),amount('small',1e302))];
  const model=matrixAreaModel(groups);for(const entry of model.weighted)expect(Number.isFinite(model.share(entry))).toBe(true);
  const leaves=monetaryTreemap(groups,1000,1000).leaves;expect(leaves).toHaveLength(3);expect(leaves.every(r=>r.width*r.height>0)).toBe(true);
 });
 it('is stable and complete for 2000 heterogeneous magnitude observations',()=>{
  const groups=[group(...Array.from({length:2000},(_,i)=>amount(String(i),(i+1)*(i%2?1:-1))))];
  const a=monetaryTreemap(groups,375,440),b=monetaryTreemap(groups,375,440);expect(a).toEqual(b);expect(a.leaves).toHaveLength(2000);
  expect(a.leaves.reduce((sum,r)=>sum+r.share,0)).toBeCloseTo(1,10);
 });
});
