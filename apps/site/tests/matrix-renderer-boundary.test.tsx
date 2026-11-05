// @vitest-environment jsdom
import React from 'react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
const mocks=vi.hoisted(()=>({treemap:vi.fn()}));
vi.mock('d3-hierarchy',async importOriginal=>{
 const actual=await importOriginal<typeof import('d3-hierarchy')>();
 return {...actual,treemap:(...args:Parameters<typeof actual.treemap>)=>{mocks.treemap();return actual.treemap(...args);}};
});
import MatrixHeatmap from '../components/matrix/MatrixHeatmap';
const groups=[{id:'scope',label:'Synthetic scope',items:[{id:'x',label:'Synthetic item',displayValue:'1.234500',colorValue:.1}]}];
const props={groups,title:'Matrix',areaMeaning:'Equal tiles',colorMeaning:'Explicit source ratio'};
afterEach(()=>{cleanup();mocks.treemap.mockClear();});
describe('matrix renderer boundaries',()=>{
 it('does not calculate a treemap for readable grids but keeps selection and current values',()=>{
  const {container,rerender}=render(<MatrixHeatmap {...props} layout="readable-grid"/>);
  expect(mocks.treemap).not.toHaveBeenCalled();fireEvent.focus(container.querySelector('[data-id=x]')!);
  expect(screen.getByText('Synthetic scope › Synthetic item')).toBeTruthy();
  rerender(<MatrixHeatmap {...props} groups={[{...groups[0],items:[{...groups[0].items[0],displayValue:'2.345600'}]}]} layout="readable-grid"/>);
  expect(screen.queryByText('1.234500')).toBeNull();expect(screen.getAllByText('2.345600')).toHaveLength(2);
  expect(mocks.treemap).not.toHaveBeenCalled();rerender(<MatrixHeatmap {...props}/>);expect(mocks.treemap).toHaveBeenCalledTimes(1);
 });
 it('allows non-flow sources to describe unavailable evidence accurately',()=>{
  render(<MatrixHeatmap {...props} groups={[]} emptyTitle="Reference data unavailable" emptyMessage="No verified exchange rates" emptyNote="Prices are not net flows"/>);
  expect(screen.getByText('Reference data unavailable')).toBeTruthy();expect(screen.getByText('No verified exchange rates')).toBeTruthy();expect(screen.getByText('Prices are not net flows')).toBeTruthy();
 });
 it('can omit a source-inappropriate empty note without inventing tiles',()=>{
  const {container}=render(<MatrixHeatmap {...props} groups={[]} emptyNote=""/>);
  expect(container.querySelector('small')).toBeNull();expect(container.querySelector('[data-id]')).toBeNull();
 });
});
