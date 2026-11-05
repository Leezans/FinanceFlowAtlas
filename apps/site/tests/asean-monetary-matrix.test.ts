import {describe,expect,it} from 'vitest';
import {fdiMonetaryGroups} from '../components/asean/matrix';
import type {FdiCell} from '../lib/asean/model';
const cell=(host:string,sector:string,value:number|null,state:FdiCell['state']='reported',year=2025):FdiCell=>({host,sector,value,state,year,raw_values:[]});
describe('ASEAN homogeneous monetary scopes',()=>{
 it('never mixes countries or years and converts USD millions uniformly',()=>{
  const cells=[cell('PH','C',120),cell('PH','D',-30),cell('SG','C',45),cell('PH','C',20,'reported',2024)];
  expect(fdiMonetaryGroups(cells,2025,'')).toEqual([]);
  const items=fdiMonetaryGroups(cells,2025,'PH')[0].items;
  expect(items.map(item=>item.amount?.value)).toEqual([120e6,-30e6]);
  expect(items.every(item=>item.amount?.currency==='USD')).toBe(true);
  expect(new Set(items.map(item=>item.amount?.comparisonKey)).size).toBe(1);
  expect(items[0].amount?.comparisonKey).toContain('net-equity-capital');
  expect(items[0].amount?.comparisonKey).not.toBe(fdiMonetaryGroups(cells,2025,'SG')[0].items[0].amount?.comparisonKey);
 });
 it('excludes unspecified sectors and Singapore overlapping N but keeps M',()=>{
  expect(fdiMonetaryGroups([cell('SG','M',12),cell('SG','N',12),cell('SG','Z',30)],2025,'SG')[0].items.map(item=>item.id)).toEqual(['M']);
  expect(fdiMonetaryGroups([cell('PH','C',12),cell('PH','Z',30)],2025,'PH')[0].items.map(item=>item.id)).toEqual(['C']);
 });
 it('preserves zero and refuses missing, n.a and duplicate values',()=>{
  const items=fdiMonetaryGroups([cell('ID','A',0),cell('ID','B',null,'missing'),cell('ID','C',null,'source_na'),cell('ID','D',null,'duplicate')],2025,'ID')[0].items;
  expect(items.map(item=>item.amount?.value)).toEqual([0,null,null,null]);
  expect(items.map(item=>item.colorValue)).toEqual([0,null,null,null]);
 });
});
