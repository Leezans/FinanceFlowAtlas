// @vitest-environment jsdom
import React from 'react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import EvidenceHeatmap from '../components/ashare/EvidenceHeatmap';
import {evidenceMatrixGroup} from '../components/ashare/matrix';
import {flowScaleMaximum} from '../components/ashare/heatmap';
import {validateEvidence,type EvidenceRow,type EvidenceSnapshot} from '../components/ashare/model';
import type {EvidenceState} from '../components/ashare/client';

// Intentionally synthetic; this fixture is never loaded by a production route.
const rows=[100,-100,60,-60,20,-20,0,null].map((value,index)=>({
 f12:`BK${String(index+1).padStart(4,'0')}`,f14:`合成行业${index+1}`,f62:value,f3:index===4?null:index-2,
 f2:null,f184:null,f66:null,f69:null,f72:null,f75:null,f78:null,f81:null,f84:null,f87:null,
})) satisfies EvidenceRow[];
function state(sourceRows:EvidenceRow[]=rows,stock=false):EvidenceState {
 const snapshot={schema:'ashare-provider-evidence/1',rows:sourceRows.map(row=>({...row,f12:stock?row.f12.slice(2).padStart(6,'0'):row.f12})),source_total:sourceRows.length,
  fetched_at:'2026-11-04T08:00:00Z',scope:stock?{kind:'industry_stocks',fs:'b:BK0001',classification_level:'unknown_may_mix_levels'}:{kind:'industry_rank',fs:'m:90+s:2+f:!50',classification_level:'eastmoney_level_1'},
  page_count:1,source_observed_at:null,trade_date:null,metric_kind:'provider_order_flow_proxy',metric_field:'f62',unit:'CNY',field_units:{f62:'CNY',f3:'percent',f2:stock?'CNY':'index_points'},delay_status:'not_provided',classification_exclusivity:'not_established',notice:'仅合成测试',stale:false,has_error:false} as EvidenceSnapshot;
 return {snapshot:validateEvidence(snapshot),etag:'synthetic',status:'ready',message:''};
}
const preview=()=>screen.getByRole('region',{name:'区块数值预览'});
afterEach(cleanup);

describe('A-share monetary projection',()=>{
 it('retains signed CNY source amounts, missing and zero without using price returns for area',()=>{
  const snapshot=state().snapshot!;
  const group=evidenceMatrixGroup(snapshot,rows);
  expect(group.items.map(item=>item.amount?.value)).toEqual([100,-100,60,-60,20,-20,0,null]);
  expect(group.items.every(item=>item.amount?.currency==='CNY')).toBe(true);
  expect(new Set(group.items.map(item=>item.amount?.comparisonKey)).size).toBe(1);
  expect(group.items[0].colorValue).toBe(100);
  expect(group.items[0].detail).toContain('涨跌幅 -2%');
  expect(group.items[0].detail).toContain('当前面积占比 27.78%');
  expect(evidenceMatrixGroup(state(rows,true).snapshot!,rows).items[0].amount?.comparisonKey).not.toBe(group.items[0].amount?.comparisonKey);
 });
});

describe('scope-anchored visual scale',()=>{
 it('anchors the scale to reported source values',()=>{
  expect(flowScaleMaximum(rows)).toBe(100);
  expect(flowScaleMaximum(rows.slice(6))).toBe(0);
 });
 it('keeps shades and legend stable through filtering and palette changes',()=>{
  const {container}=render(<EvidenceHeatmap state={state()}/>);
  const tile=()=>container.querySelector('g[data-id="BK0005"]')!;
  expect(tile().getAttribute('data-color')).toBe('positive-1');
  expect(screen.getByLabelText('主力净额颜色刻度').textContent).toContain('+100 元');
  fireEvent.change(screen.getByLabelText('搜索代码或名称'),{target:{value:'BK0005'}});
  expect(tile().getAttribute('data-color')).toBe('positive-1');
  expect(screen.getByLabelText('主力净额颜色刻度').textContent).toContain('+100 元');
  fireEvent.change(screen.getByLabelText('正负配色'),{target:{value:'global'}});
  expect(tile().getAttribute('data-color')).toBe('positive-1');expect(container.querySelector('.palette-global')).not.toBeNull();
 });
 it('does not create tiles or a monetary color scale from only zero/missing data',()=>{
  const {container}=render(<EvidenceHeatmap state={state(rows.slice(6))}/>);
  expect(container.querySelectorAll('g[data-id]')).toHaveLength(0);expect(screen.queryByLabelText('主力净额颜色刻度')).toBeNull();
 });

});

describe('shared matrix zoom integration',()=>{
 it('zooms with the wheel only when enabled, retains same-scope view and resets on industry change',()=>{
  const view=render(<EvidenceHeatmap state={state()}/>);
  const canvas=()=>screen.getByRole('group',{name:'当前筛选范围的主力净额矩形热力图可缩放画布'});
  expect(canvas().getAttribute('data-zoom')).toBe('1');
  fireEvent.wheel(canvas(),{deltaY:-200,clientX:100,clientY:100});
  expect(canvas().getAttribute('data-zoom')).toBe('1');
  fireEvent.click(screen.getByRole('button',{name:'开启滚轮缩放'}));
  fireEvent.wheel(canvas(),{deltaY:-200,clientX:100,clientY:100});
  const zoom=canvas().getAttribute('data-zoom');
  expect(Number(zoom)).toBeGreaterThan(1);
  view.rerender(<EvidenceHeatmap state={state(rows.map(row=>({...row,f62:row.f62===null?null:Number(row.f62)*2})))}/>);
  expect(canvas().getAttribute('data-zoom')).toBe(zoom);
  fireEvent.change(screen.getByLabelText('正负配色'),{target:{value:'global'}});
  expect(canvas().getAttribute('data-zoom')).toBe(zoom);
  view.rerender(<EvidenceHeatmap state={state(rows,true)}/>);
  expect(canvas().getAttribute('data-zoom')).toBe('1');
 });
});

describe('heatmap value inspection',()=>{
 it('previews exact signed values, reported returns and current area shares without clicking',()=>{
  const {container}=render(<EvidenceHeatmap state={state()}/>);
  const buy=container.querySelector('g[data-id="BK0001"]')!;
  fireEvent.mouseEnter(buy);
  expect(preview().textContent).toContain('主力净额 +100 元');expect(preview().textContent).toContain('涨跌幅 -2%');expect(preview().textContent).toContain('当前面积占比 27.78%');
  expect(buy.getAttribute('aria-label')).toContain('主力净额 +100 元');
  fireEvent.mouseLeave(buy);expect(preview().textContent).toContain('指向区块');
 });
 it('allows keyboard inspection in a read-only embedding and does not invent absent returns',()=>{
  const {container}=render(<EvidenceHeatmap state={state()}/>);
  const tile=container.querySelector('g[data-id="BK0005"]')!;
  expect(tile.getAttribute('tabindex')).toBe('0');expect(tile.getAttribute('role')).toBe('img');
  fireEvent.focus(tile);expect(preview().textContent).toContain('涨跌幅 未提供');
  const hovered=container.querySelector('g[data-id="BK0002"]')!;
  fireEvent.mouseEnter(hovered);expect(preview().textContent).toContain('主力净额 -100 元');
  fireEvent.mouseLeave(hovered);expect(preview().textContent).toContain('主力净额 +20 元');
  fireEvent.blur(tile);expect(preview().textContent).toContain('指向区块');
 });
 it('retains industry keyboard drilldown and updates inspection on source refresh',()=>{
  const select=vi.fn();const view=render(<EvidenceHeatmap state={state()} onIndustrySelect={select}/>);
  const tile=view.container.querySelector('g[data-id="BK0001"]')!;
  fireEvent.focus(tile);fireEvent.keyDown(tile,{key:'Enter'});expect(select).toHaveBeenCalledOnce();
  view.rerender(<EvidenceHeatmap state={state(rows.map((row,index)=>index===0?{...row,f62:75}:row))} onIndustrySelect={select}/>);
  expect(preview().textContent).toContain('主力净额 +75 元');
  fireEvent.change(screen.getByLabelText('主力净额方向'),{target:{value:'negative'}});
  expect(preview().textContent).toContain('指向区块');
 });
 it('does not let a removed hover target hide keyboard or selected evidence after refresh',()=>{
  const view=render(<EvidenceHeatmap state={state(rows,true)}/>);
  const selected=view.container.querySelector('g[data-id="000001"]')!;
  fireEvent.click(selected);
  fireEvent.mouseEnter(view.container.querySelector('g[data-id="000002"]')!);
  view.rerender(<EvidenceHeatmap state={state(rows.filter(row=>row.f12!=='BK0002'),true)}/>);
  expect(preview().textContent).toContain('主力净额 +100 元');
  const focused=view.container.querySelector('g[data-id="000003"]')!;
  fireEvent.focus(focused);expect(preview().textContent).toContain('主力净额 +60 元');
  view.rerender(<EvidenceHeatmap state={state(rows.map((row,index)=>index===2?{...row,f62:null}:row),true)}/>);
  expect(preview().textContent).toContain('主力净额 +100 元');
 });
 it('keeps a clicked stock selected until evidence is closed and retains signed amounts',()=>{
  const {container}=render(<EvidenceHeatmap state={state(rows,true)}/>);
  const tile=container.querySelector('g[data-id="000001"]')!;
  expect(tile.textContent).toContain('主力净额 +100 元');
  fireEvent.click(tile);expect(tile.getAttribute('data-selected')).toBe('true');
  expect(preview().textContent).toContain('主力净额 +100 元');
  fireEvent.click(screen.getByRole('button',{name:'关闭原始证据'}));
  expect(tile.getAttribute('data-selected')).toBeNull();
 });
});
