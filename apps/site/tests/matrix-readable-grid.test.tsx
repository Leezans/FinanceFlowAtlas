// @vitest-environment jsdom
import React from 'react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {readFileSync} from 'node:fs';
import MatrixHeatmap,{readableGridColumns,type MatrixGroup} from '../components/matrix/MatrixHeatmap';
const props={title:'密集矩阵测试',colorMeaning:'净买卖超比率',areaMeaning:'等面积',colorMaxAbs:1};
const dense=(count:number):MatrixGroup[]=>[{id:'dense',label:'全部测试行业',items:Array.from({length:count},(_,i)=>({id:`item-${i}`,label:`完整行业公司名称${i}`,displayValue:`${i%2?'-':'+'}123,456 股`,detail:`CODE${i} · 覆盖 5/6`,colorValue:i%2?-.8:.2}))}];
afterEach(()=>{cleanup();vi.restoreAllMocks();});
describe('opt-in readable matrix density',()=>{
 it.each([28,200])('retains visible names, values and keyboard drilldown for all %s rows at 375px',count=>{
  vi.spyOn(HTMLElement.prototype,'clientWidth','get').mockReturnValue(375);
  const groups=dense(count),onSelect=vi.fn();const {container}=render(<MatrixHeatmap {...props} groups={groups} layout="readable-grid" onSelect={onSelect}/>);
  expect(container.querySelector('svg')).toBeNull();
  expect(container.querySelectorAll('[data-id]')).toHaveLength(count);
  expect(container.querySelectorAll('[data-matrix-label]')).toHaveLength(count);
  for(let i=0;i<count;i++){
   const tile=container.querySelector(`[data-id="item-${i}"]`)!;
   expect(tile.querySelector('[data-matrix-label]')?.textContent).toBe(`完整行业公司名称${i}`);
   expect(tile.textContent).toContain('123,456 股');
  }
  const grid=container.querySelector('[style*="grid-template-columns"]') as HTMLElement;
  expect(grid.style.gridTemplateColumns).toBe('repeat(2, minmax(0, 1fr))');
  expect(screen.getByText(`全部 ${count} 个区块 · 在矩阵内滚动查看，或按 Tab 逐项选择`)).toBeTruthy();
  const last=screen.getByRole('button',{name:new RegExp(`名称${count-1} ·`)});
  fireEvent.click(last);expect(onSelect).toHaveBeenCalledWith(groups[0].items[count-1],groups[0]);
  fireEvent.click(last);expect(onSelect).toHaveBeenCalledTimes(2);
 });
 it('uses safe columns and never invents area without monetary metadata',()=>{
  expect(readableGridColumns(289)).toBe(2);expect(readableGridColumns(240)).toBe(1);expect(readableGridColumns(0)).toBe(1);
  const {container}=render(<MatrixHeatmap {...props} groups={dense(28)}/>);
  expect(container.querySelector('svg')).toBeNull();expect(container.querySelector('[data-layout=readable-grid]')).not.toBeNull();
 });
 it('retains missing/zero states and an honest empty canvas in readable mode',()=>{
  const groups=dense(2);groups[0].items[0].colorValue=0;groups[0].items[1].colorValue=null;
  const {container,rerender}=render(<MatrixHeatmap {...props} groups={groups} layout="readable-grid"/>);
  expect(container.querySelector('[data-id=item-0]')?.getAttribute('data-color')).toBe('zero');expect(container.querySelector('[data-id=item-1]')?.getAttribute('data-color')).toBe('missing');
  rerender(<MatrixHeatmap {...props} groups={[]} layout="readable-grid"/>);expect(container.querySelector('[data-matrix-empty=true]')).toBeTruthy();expect(container.querySelectorAll('[data-id]')).toHaveLength(0);
 });
 it('starts a new drilldown at the top without resetting same-scope refresh scrolling',()=>{
  const {container,rerender}=render(<MatrixHeatmap {...props} groups={dense(28)} layout="readable-grid"/>);
  const canvas=container.querySelector('[data-layout=readable-grid]') as HTMLElement;canvas.scrollTop=900;
  rerender(<MatrixHeatmap {...props} groups={dense(28)} layout="readable-grid"/>);expect(canvas.scrollTop).toBe(900);
  rerender(<MatrixHeatmap {...props} title="选中行业公司" groups={dense(200)} layout="readable-grid"/>);expect(canvas.scrollTop).toBe(0);
 });
 it('stretches a small metric group only when explicitly requested',()=>{
  vi.spyOn(HTMLElement.prototype,'clientWidth','get').mockReturnValue(1100);
  const {container}=render(<MatrixHeatmap {...props} groups={dense(2)} layout="readable-grid" stretchSmallGroups/>);
  expect((container.querySelector('[style*="grid-template-columns"]') as HTMLElement).style.gridTemplateColumns).toBe('repeat(2, minmax(0, 1fr))');
 });
 it('keeps equal country column widths across groups of different sizes by default',()=>{
  vi.spyOn(HTMLElement.prototype,'clientWidth','get').mockReturnValue(1100);
  const {container}=render(<MatrixHeatmap {...props} groups={[...dense(20),{...dense(5)[0],id:'small'}]} layout="readable-grid"/>);
  for(const grid of container.querySelectorAll<HTMLElement>('[style*="grid-template-columns"]'))expect(grid.style.gridTemplateColumns).toBe('repeat(8, minmax(0, 1fr))');
 });
 it('bounds scrolling instead of hiding labels or shrinking them below readable sizes',()=>{
  const css=readFileSync('components/matrix/matrix.module.css','utf8');
  expect(css).toContain('max-height:560px');expect(css).toContain('overflow:auto');expect(css).toContain('.gridName,.gridValue,.gridDetail{white-space:normal}');expect(css).toContain('grid-auto-rows:minmax(140px,1fr)');expect(css).toContain('.gridName,.gridValue{font-size:14px}');
 });
});
