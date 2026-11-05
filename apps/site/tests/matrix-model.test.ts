import {describe,expect,it} from 'vitest';
import {describeMatrixItem,matrixColor,matrixColorMaximum,matrixEntries,matrixWeight,readableGridColumns,type MatrixGroup,type MatrixItem} from '../lib/matrix/model';
const item=(value?:number|null):MatrixItem=>({id:'row',label:'Synthetic',displayValue:'source precision',colorValue:value});
const groups:MatrixGroup[]=[{id:'empty',label:'Empty',items:[]},{id:'scope',label:'Scope',items:[item(.2),{...item(-.9),id:'negative'}]}];
describe('pure matrix presentation contract',()=>{
 it('preserves source item identity, order, precision text and containing group',()=>{
  const entries=matrixEntries(groups);
  expect(entries.map(entry=>entry.id)).toEqual(['scope/row','scope/negative']);
  expect(entries[0].item).toBe(groups[1].items[0]);expect(entries[0].group).toBe(groups[1]);
  expect(entries[0].item.displayValue).toBe('source precision');expect(groups[0].items).toHaveLength(0);
 });
 it('uses finite color observations without treating missing values as reported zero',()=>{
  expect(matrixColorMaximum(matrixEntries([{id:'g',label:'g',items:[item(null),item(NaN),item(Infinity),item(-.8)]}]))).toBe(.8);
  expect(matrixColorMaximum([])).toBe(0);
  for(const value of [undefined,null,NaN,Infinity,-Infinity])expect(matrixColor(item(value),'signed',1)).toBe('missing');
  expect(matrixColor(item(0),'signed',1)).toBe('zero');expect(matrixColor(item(-0),'signed',1)).toBe('zero');
 });
 it('keeps fixed scale stable when callers filter or change selected scope',()=>{
  const entries=matrixEntries(groups);
  expect(matrixColorMaximum(entries,1)).toBe(1);expect(matrixColorMaximum(entries.slice(0,1),1)).toBe(1);
  expect(matrixColor(entries[0].item,'signed',1)).toBe('positive-1');expect(matrixColor(entries[1].item,'signed',1)).toBe('negative-3');
  expect(matrixColor(item(20),'signed',1)).toBe('positive-3');
  for(const maximum of [0,-1,NaN,Infinity])expect(matrixColorMaximum(entries,maximum)).toBe(.9);
 });
 it('does not color unsigned reference data as positive flow',()=>{
  for(const value of [0,42,-7,null])expect(matrixColor(item(value),'neutral',1)).toBe('missing');
 });
 it('uses a distinct nonnegative sequential palette without inventing sign',()=>{
  expect(matrixColor(item(.2),'sequential',1)).toBe('magnitude-1');
  expect(matrixColor(item(.5),'sequential',1)).toBe('magnitude-2');
  expect(matrixColor(item(1),'sequential',1)).toBe('magnitude-3');
  expect(matrixColor(item(0),'sequential',1)).toBe('zero');
  for(const value of [-1,null,undefined,NaN])expect(matrixColor(item(value),'sequential',1)).toBe('missing');
 });
 it('never converts signed color or formatted amount into geometry weight',()=>{
  expect(matrixWeight({...item(-50),displayValue:'9,999,999 USD'})).toBe(1);
  for(const weight of [undefined,null,0,-2,NaN,Infinity])expect(matrixWeight({...item(2),weight})).toBe(1);
  expect(matrixWeight({...item(-2),weight:3.5})).toBe(3.5);
 });
 it('keeps accessible descriptions and readable layout independent of React',()=>{
  expect(describeMatrixItem({...item(),detail:'verified scope'},groups[1])).toBe('Scope · Synthetic · source precision · verified scope');
  expect(readableGridColumns(375)).toBe(2);expect(readableGridColumns(240)).toBe(1);
 });
});
