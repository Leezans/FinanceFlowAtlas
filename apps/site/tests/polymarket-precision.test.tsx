// @vitest-environment jsdom
import React from 'react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import Polymarket from '../components/polymarket/Polymarket';
import {marketItem} from '../components/polymarket/matrix';
import {marketSchema,type PolymarketMarket} from '../lib/polymarket/model';
import {snapshot} from './polymarket-fixture';
const base=snapshot().rows[0];
const withPrice=(price:string|null):PolymarketMarket=>marketSchema.parse({...base,outcomes:[{name:'No',price:'0.5'},{name:'Yes',price}]});
const state=vi.hoisted(()=>({snapshot:null as unknown}));
vi.mock('../components/polymarket/useSnapshot',()=>({useSnapshot:()=>({snapshot:state.snapshot,age:0,loading:false,error:null,refresh:vi.fn(),coolingDown:false,denied:false,stale:false})}));
afterEach(()=>{cleanup();state.snapshot=null;});
describe('Polymarket source precision is preserved in presentation',()=>{
 it.each([
  ['0','0%'],['1','100%'],['0.000000000001','0.0000000001%'],
  ['0.000000499999','0.0000499999%'],['0.999999999999','99.9999999999%'],
  ['0.123456789123','12.3456789123%'],['0.290000000000','29%'],
  ['1.000000000000','100%'],[null,'来源未提供'],
 ])('shows the exact decimal percentage for %s', (price,displayValue)=>{
  const row=withPrice(price);expect(marketItem(row,'probability')).toMatchObject({displayValue,colorValue:price===null?null:Number(price),weight:1});
  expect(marketItem(row,'probability').amount).toBeUndefined();
 });
 it.each([
  [0,'0'],[0.000000000001,'0.000000000001'],[0.0000499999,'0.0000499999'],
  [1234.56789123,'1,234.56789123'],[1e-100,'1e-100'],[Number.MIN_VALUE,'5e-324'],
  [1000000000000000,'1,000,000,000,000,000'],
 ])('preserves finite source volume %s without monetary relabeling', (volume,expected)=>{
  const row=marketSchema.parse({...base,volume_24h:volume});
  expect(marketItem(row,'volume')).toMatchObject({displayValue:`${expected} · 来源单位`,colorValue:volume,weight:1});
  expect(marketItem(row,'volume').amount).toBeUndefined();
 });
 it('uses the same exact probabilities in market cards, accessible labels and all outcome details',()=>{
  const value=snapshot();value.rows=[{...withPrice('0.999999999999'),outcomes:[{name:'No',price:'0.000000000001'},{name:'Yes',price:'0.999999999999'}]}];state.snapshot=value;
  render(<Polymarket/>);
  expect(screen.getByRole('img',{name:/99\.9999999999%/})).toBeTruthy();
  expect(screen.getByText('99.9999999999%')).toBeTruthy();
  expect(screen.getByText('No：0.0000000001%；Yes：99.9999999999%')).toBeTruthy();
  expect(screen.queryByText('100%')).toBeNull();
 });
 it('keeps the first named non-binary outcome exact rather than inferring Yes',()=>{
  const row={...base,outcomes:[{name:'Candidate A',price:'0.000000000001'},{name:'Candidate B',price:'0.999999999999'}]};
  expect(marketItem(row,'probability')).toMatchObject({displayValue:'0.0000000001%',detail:'结果：Candidate A · 价格隐含概率'});
 });
});
