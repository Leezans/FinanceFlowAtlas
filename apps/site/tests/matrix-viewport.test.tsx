// @vitest-environment jsdom
import React from 'react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import MatrixHeatmap from '../components/matrix/MatrixHeatmap';
import {clampTransform,INITIAL_TRANSFORM,revealRectangle,zoomAt} from '../lib/matrix/viewport';
const items=[100,-10,1,0,null].map((value,i)=>({id:`item-${i}`,label:`Synthetic ${i}`,displayValue:value===null?'Unknown':String(value),colorValue:value,amount:{value,currency:'USD',comparisonKey:'metric:2026'}}));
const props={groups:[{id:'g',label:'Group',items}],title:'Amount matrix',colorMeaning:'Sign',areaMeaning:'Absolute amount'};
afterEach(()=>{cleanup();vi.restoreAllMocks()});
const canvas=(container:HTMLElement)=>container.querySelector('[data-zoom]')!;
describe('amount zoom interaction',()=>{
 it('uses area geometry instead of equal cells, with area-free accessible zero/missing rows',()=>{
  const {container}=render(<MatrixHeatmap {...props}/>);expect(container.querySelectorAll('svg [data-id]')).toHaveLength(3);
  expect(container.querySelector('svg [data-id=item-3]')).toBeNull();expect(screen.getByText(/实测零值/)).toBeTruthy();expect(screen.getByText(/金额缺失/)).toBeTruthy();
  expect(container.querySelector('svg [data-id=item-0]')?.getAttribute('data-color')).toBe('positive-3');expect(container.querySelector('svg [data-id=item-1]')?.getAttribute('data-color')).toBe('negative-1');
 });
 it('never traps wheel scrolling by default and captures only opt-in in-range zoom',()=>{
  const {container}=render(<MatrixHeatmap {...props}/>);const view=canvas(container);
  expect(fireEvent.wheel(view,{deltaY:-100,cancelable:true})).toBe(true);expect(view.getAttribute('data-zoom')).toBe('1');
  fireEvent.click(screen.getByRole('button',{name:'开启滚轮缩放'}));
  expect(fireEvent.wheel(view,{deltaY:100,cancelable:true})).toBe(true);
  expect(fireEvent.wheel(view,{deltaY:-100,cancelable:true})).toBe(false);expect(Number(view.getAttribute('data-zoom'))).toBeGreaterThan(1);
  fireEvent.keyDown(view,{key:'Escape'});const before=view.getAttribute('data-zoom');expect(fireEvent.wheel(view,{deltaY:-100,cancelable:true})).toBe(true);expect(view.getAttribute('data-zoom')).toBe(before);
 });
 it('exits wheel mode with Escape while the toolbar still has focus',()=>{
  const {container}=render(<MatrixHeatmap {...props}/>);const toggle=screen.getByRole('button',{name:'开启滚轮缩放'});fireEvent.click(toggle);fireEvent.focus(toggle);
  fireEvent.keyDown(toggle,{key:'Escape'});expect(canvas(container).getAttribute('data-interactive')).toBe('false');
  expect(fireEvent.wheel(canvas(container),{deltaY:-100,cancelable:true})).toBe(true);
 });
 it('provides bounded buttons, keyboard zoom/reset and preserves browser zoom shortcuts',()=>{
  const {container}=render(<MatrixHeatmap {...props}/>);const view=canvas(container);
  fireEvent.click(screen.getByRole('button',{name:'放大矩阵'}));expect(view.getAttribute('data-zoom')).toBe('1.5');
  expect(fireEvent.wheel(view,{deltaY:-100,ctrlKey:true,cancelable:true})).toBe(true);expect(view.getAttribute('data-zoom')).toBe('1.5');
  fireEvent.keyDown(view,{key:'+'});expect(view.getAttribute('data-zoom')).toBe('2.25');fireEvent.keyDown(view,{key:'Home'});expect(view.getAttribute('data-zoom')).toBe('1');
  fireEvent.click(screen.getByRole('button',{name:'放大矩阵'}));fireEvent.click(screen.getByRole('button',{name:'重置视图'}));expect(view.getAttribute('data-zoom')).toBe('1');expect(screen.getByRole('button',{name:'开启滚轮缩放'})).toBeTruthy();
 });
 it('preserves same-scope refresh zoom but resets on drilldown and does not retain stale evidence',()=>{
  const {container,rerender}=render(<MatrixHeatmap {...props} scopeKey="one"/>);fireEvent.click(screen.getByRole('button',{name:'放大矩阵'}));
  rerender(<MatrixHeatmap {...props} groups={[{...props.groups[0],items:[...items]}]} scopeKey="one"/>);expect(canvas(container).getAttribute('data-zoom')).toBe('1.5');
  rerender(<MatrixHeatmap {...props} scopeKey="two"/>);expect(canvas(container).getAttribute('data-zoom')).toBe('1');
  rerender(<MatrixHeatmap {...props} groups={[]}/>);expect(container.querySelector('svg')).toBeNull();expect(screen.queryByRole('button',{name:'放大矩阵'})).toBeNull();
 });
 it('keeps keyboard selection and current inspection through zoom, and selected fallback',()=>{
  const select=vi.fn();const {container}=render(<MatrixHeatmap {...props} selectedItemId="item-0" onSelect={select}/>);
  expect(screen.getByRole('region',{name:'区块数值预览'}).textContent).toContain('Synthetic 0');const tile=container.querySelector('svg [data-id=item-1]')!;
  fireEvent.focus(tile);fireEvent.keyDown(tile,{key:'Enter'});expect(select).toHaveBeenCalledWith(items[1],props.groups[0]);fireEvent.blur(tile);expect(screen.getByRole('region',{name:'区块数值预览'}).textContent).toContain('Synthetic 0');
 });
});
describe('viewport geometry',()=>{
 it('zooms around the pointer and keeps panning inside bounds',()=>{
  expect(zoomAt(INITIAL_TRANSFORM,2,{x:200,y:100},1000,500)).toEqual({scale:2,x:-200,y:-100});
  expect(clampTransform({scale:100,x:2,y:-1e9},100,100)).toEqual({scale:32,x:0,y:-3100});
 });
 it('reveals focused offscreen tiles at the current scale',()=>{
  const t=revealRectangle({scale:2,x:0,y:0},{x:800,y:400,width:50,height:30},1000,500);expect(t.x).toBe(-700);expect(t.y).toBe(-360);
 });
});
