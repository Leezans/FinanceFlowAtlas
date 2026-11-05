// @vitest-environment jsdom
import React from 'react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import EvidenceHeatmap from '../components/ashare/EvidenceHeatmap';
import {flowScaleMaximum,flowStrength,fitTileFont} from '../components/ashare/heatmap';
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

describe('scope-anchored visual scale',()=>{
 it('uses only reported values and symmetric equal-width bands',()=>{
  expect(flowScaleMaximum(rows)).toBe(100);
  expect(flowScaleMaximum(rows.slice(6))).toBe(0);
  expect(flowStrength(null,100)).toBe(0);expect(flowStrength(0,100)).toBe(0);
  expect(flowStrength(Infinity,100)).toBe(0);expect(flowStrength(1,0)).toBe(0);
  for(const sign of [-1,1]){
   expect(flowStrength(sign*33,100)).toBe(1);expect(flowStrength(sign*60,100)).toBe(2);expect(flowStrength(sign*100,100)).toBe(3);
   expect(flowStrength(sign/3,1)).toBe(1);expect(flowStrength(sign*2/3,1)).toBe(2);
  }
 });
 it('keeps shades and legend stable through filtering and palette changes',()=>{
  const {container}=render(<EvidenceHeatmap state={state()}/>);
  const tile=()=>container.querySelector('.tile[data-code="BK0005"]')!;
  expect(tile().getAttribute('data-flow-strength')).toBe('1');
  expect(screen.getByLabelText('主力净额颜色刻度').textContent).toContain('+100 元');
  fireEvent.change(screen.getByLabelText('搜索代码或名称'),{target:{value:'BK0005'}});
  expect(tile().getAttribute('data-flow-strength')).toBe('1');
  expect(screen.getByLabelText('主力净额颜色刻度').textContent).toContain('+100 元');
  fireEvent.change(screen.getByLabelText('正负配色'),{target:{value:'global'}});
  expect(tile().getAttribute('data-flow-strength')).toBe('1');expect(container.querySelector('.palette-global')).not.toBeNull();
 });
 it('does not create tiles or a monetary color scale from only zero/missing data',()=>{
  const {container}=render(<EvidenceHeatmap state={state(rows.slice(6))}/>);
  expect(container.querySelectorAll('.tile')).toHaveLength(0);expect(screen.queryByLabelText('主力净额颜色刻度')).toBeNull();
 });
 it('fits Unicode labels conservatively rather than forcing oversized minimum text',()=>{
  expect(fitTileFont('合成行业',100,27)).toBe(22);
  expect(fitTileFont('000001',100,27)).toBeCloseTo(22.5641);
  expect(fitTileFont('名称过长时不溢出区块边缘',42,27)).toBeLessThan(9);
 });
});

describe('heatmap value inspection',()=>{
 it('previews exact signed values, reported returns and current area shares without clicking',()=>{
  const {container}=render(<EvidenceHeatmap state={state()}/>);
  const buy=container.querySelector('.tile[data-code="BK0001"]')!;
  fireEvent.mouseEnter(buy);
  expect(within(preview()).getByText('+100')).toBeTruthy();expect(within(preview()).getByText('-2%')).toBeTruthy();expect(within(preview()).getByText('27.78%')).toBeTruthy();
  expect(buy.getAttribute('aria-label')).toContain('主力净额 +100 元');
  fireEvent.mouseLeave(buy);expect(preview().textContent).toContain('指向区块');
 });
 it('allows keyboard inspection in a read-only embedding and does not invent absent returns',()=>{
  const {container}=render(<EvidenceHeatmap state={state()}/>);
  const tile=container.querySelector('.tile[data-code="BK0005"]')!;
  expect(tile.getAttribute('tabindex')).toBe('0');expect(tile.getAttribute('role')).toBe('img');
  fireEvent.focus(tile);expect(within(preview()).getByText('未提供')).toBeTruthy();
  const hovered=container.querySelector('.tile[data-code="BK0002"]')!;
  fireEvent.mouseEnter(hovered);expect(within(preview()).getByText('-100')).toBeTruthy();
  fireEvent.mouseLeave(hovered);expect(within(preview()).getByText('+20')).toBeTruthy();
  fireEvent.blur(tile);expect(preview().textContent).toContain('指向区块');
 });
 it('retains industry keyboard drilldown and updates inspection on source refresh',()=>{
  const select=vi.fn();const view=render(<EvidenceHeatmap state={state()} onIndustrySelect={select}/>);
  const tile=view.container.querySelector('.tile[data-code="BK0001"]')!;
  fireEvent.focus(tile);fireEvent.keyDown(tile,{key:'Enter'});expect(select).toHaveBeenCalledOnce();
  view.rerender(<EvidenceHeatmap state={state(rows.map((row,index)=>index===0?{...row,f62:75}:row))} onIndustrySelect={select}/>);
  expect(within(preview()).getByText('+75')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('主力净额方向'),{target:{value:'negative'}});
  expect(preview().textContent).toContain('指向区块');
 });
 it('does not let a removed hover target hide keyboard or selected evidence after refresh',()=>{
  const view=render(<EvidenceHeatmap state={state(rows,true)}/>);
  const selected=view.container.querySelector('.tile[data-code="000001"]')!;
  fireEvent.click(selected);
  fireEvent.mouseEnter(view.container.querySelector('.tile[data-code="000002"]')!);
  view.rerender(<EvidenceHeatmap state={state(rows.filter(row=>row.f12!=='BK0002'),true)}/>);
  expect(within(preview()).getByText('+100')).toBeTruthy();
  const focused=view.container.querySelector('.tile[data-code="000003"]')!;
  fireEvent.focus(focused);expect(within(preview()).getByText('+60')).toBeTruthy();
  view.rerender(<EvidenceHeatmap state={state(rows.map((row,index)=>index===2?{...row,f62:null}:row),true)}/>);
  expect(within(preview()).getByText('+100')).toBeTruthy();
 });
 it('keeps a clicked stock selected until evidence is closed and renders compact signed amounts',()=>{
  const {container}=render(<EvidenceHeatmap state={state(rows,true)}/>);
  const tile=container.querySelector('.tile[data-code="000001"]')!;
  expect(tile.querySelector('.tile-amount')?.textContent).toBe('+100');
  fireEvent.click(tile);expect(tile.getAttribute('data-selected')).toBe('true');
  expect(within(preview()).getByText('+100')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'关闭原始证据'}));
  expect(tile.getAttribute('data-selected')).toBeNull();
 });
});
