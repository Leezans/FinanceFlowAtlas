// @vitest-environment jsdom
import React from 'react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import MatrixHeatmap,{type MatrixGroup} from '../components/matrix/MatrixHeatmap';
const groups:MatrixGroup[]=[{id:'synthetic',label:'合成测试分类',items:[{id:'positive',label:'测试正值',displayValue:'+20%',colorValue:.2},{id:'negative',label:'测试负值',displayValue:'−90%',colorValue:-.9},{id:'zero',label:'测试零值',displayValue:'0%',colorValue:0},{id:'missing',label:'测试缺失',displayValue:'未提供',colorValue:null}]}];
const props={groups,title:'合成测试矩阵',colorMeaning:'测试比率，固定 ±100%',areaMeaning:'等面积，不代表金额',colorMaxAbs:1};
afterEach(()=>cleanup());
describe('shared category/instrument matrix',()=>{
 it('renders nested group headers and preserves positive, negative, zero and missing states',()=>{
  const {container}=render(<MatrixHeatmap {...props}/>);
  expect(screen.getByText('合成测试分类')).toBeTruthy();expect(container.querySelectorAll('[data-id]')).toHaveLength(4);
  expect(container.querySelector('[data-id=positive]')?.getAttribute('data-color')).toBe('positive-1');
  expect(container.querySelector('[data-id=negative]')?.getAttribute('data-color')).toBe('negative-3');
  expect(container.querySelector('[data-id=zero]')?.getAttribute('data-color')).toBe('zero');
  expect(container.querySelector('[data-id=missing]')?.getAttribute('data-color')).toBe('missing');
  expect(screen.queryByRole('table')).toBeNull();
 });
 it('keeps a fixed scale across category or selection changes',()=>{
  const {container,rerender}=render(<MatrixHeatmap {...props}/>);rerender(<MatrixHeatmap {...props} groups={[{...groups[0],items:[groups[0].items[0]]}]}/>);
  expect(container.querySelector('[data-id=positive]')?.getAttribute('data-color')).toBe('positive-1');
 });
 it('does not color unsigned references as inflows and supports keyboard drilldown',()=>{
  const onSelect=vi.fn();const {container}=render(<MatrixHeatmap {...props} colorMode="neutral" onSelect={onSelect}/>);
  expect(container.querySelectorAll('[data-color=missing]')).toHaveLength(4);
  fireEvent.click(screen.getByRole('button',{name:/合成测试分类 · 测试正值/}));
  expect(onSelect).toHaveBeenCalledWith(groups[0].items[0],groups[0]);
 });
 it('retains a large honest matrix canvas with no synthetic tiles when unavailable',()=>{
  const {container}=render(<MatrixHeatmap {...props} groups={[]} emptyMessage="来源停止，缺失不是零。"/>);
  expect(screen.getByText('来源停止，缺失不是零。')).toBeTruthy();expect(container.querySelector('[data-matrix-empty=true]')).toBeTruthy();
  expect(container.querySelectorAll('[data-id]')).toHaveLength(0);expect(container.querySelector('svg')).toBeNull();
 });
 it('does not carry an old inspected value into missing data',()=>{
  const {container,rerender}=render(<MatrixHeatmap {...props}/>);
  fireEvent.mouseEnter(container.querySelector('[data-id=positive]')!);expect(screen.getByText('合成测试分类 › 测试正值')).toBeTruthy();
  rerender(<MatrixHeatmap {...props} groups={[]}/>);expect(screen.queryByText('合成测试分类 › 测试正值')).toBeNull();
 });
});
