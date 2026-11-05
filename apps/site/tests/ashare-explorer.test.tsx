// @vitest-environment jsdom
import React from 'react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {cleanup, fireEvent, render, screen, within} from '@testing-library/react';
import EvidenceHeatmap from '../components/ashare/EvidenceHeatmap';
import {validateEvidence, selectEvidenceRows, exactAmount, type EvidenceRow, type EvidenceSnapshot} from '../components/ashare/model';
import {emptyState, type EvidenceState} from '../components/ashare/client';

// Synthetic observations only. No captured provider data or access approval.
const rows: EvidenceRow[] = [
 {f12:'BK0001',f14:'合成净买',f62:12500.25,f3:1.25},
 {f12:'BK0002',f14:'合成净卖',f62:-25000.5,f3:-2},
 {f12:'BK0003',f14:'合成零值',f62:0,f3:0},
 {f12:'BK0004',f14:'合成缺失',f62:null,f3:'-'},
].map(row=>({f2:null,f184:null,f66:null,f69:null,f72:null,f75:null,f78:null,f81:null,f84:null,f87:null,...row})) as EvidenceRow[];
function snapshot(stocks=false): EvidenceSnapshot {
 return {schema:'ashare-provider-evidence/1',rows:rows.map(row=>({...row,f12:stocks?row.f12.slice(2).padStart(6,'0'):row.f12})),source_total:4,
  fetched_at:'2026-11-04T08:00:00Z',scope:stocks?{kind:'industry_stocks',fs:'b:BK0001',classification_level:'unknown_may_mix_levels'}:{kind:'industry_rank',fs:'m:90+s:2+f:!50',classification_level:'eastmoney_level_1'},
  page_count:1,source_observed_at:null,trade_date:null,metric_kind:'provider_order_flow_proxy',metric_field:'f62',unit:'CNY',field_units:{f62:'CNY',f3:'percent',f2:stocks?'CNY':'index_points'},delay_status:'not_provided',classification_exclusivity:'not_established',notice:'仅合成测试',stale:false,has_error:false};
}
function state(data=snapshot()): EvidenceState {
 return {snapshot:validateEvidence(data),etag:data.fetched_at,status:data.stale?'stale':'ready',message:''};
}
function openList(){fireEvent.click(screen.getByText(/^数值明细 ·/));}
function tableCodes() {return Array.from(screen.getByRole('table').querySelectorAll('tbody tr')).map(row=>row.getAttribute('data-code'));}
afterEach(cleanup);

describe('evidence selection without fabricated amounts',()=>{
 it('sorts signed and magnitude values, keeps missing last, and never mutates input',()=>{
  expect(selectEvidenceRows(rows,'','all','magnitude').map(row=>row.f12)).toEqual(['BK0002','BK0001','BK0003','BK0004']);
  expect(selectEvidenceRows(rows,'','all','net_desc').map(row=>row.f12)).toEqual(['BK0001','BK0003','BK0002','BK0004']);
  expect(selectEvidenceRows(rows,'','all','net_asc').map(row=>row.f12)).toEqual(['BK0002','BK0003','BK0001','BK0004']);
  expect(rows.map(row=>row.f12)).toEqual(['BK0001','BK0002','BK0003','BK0004']);
 });
 it('combines trimmed case-insensitive search and direction while keeping zero distinct from missing',()=>{
  expect(selectEvidenceRows(rows,' bk0001 ','positive','magnitude')).toEqual([rows[0]]);
  expect(selectEvidenceRows(rows,'合成','negative','magnitude')).toEqual([rows[1]]);
  expect(selectEvidenceRows(rows,'','zero','magnitude')).toEqual([rows[2]]);
  expect(selectEvidenceRows(rows,'','missing','magnitude')).toEqual([rows[3]]);
  expect(selectEvidenceRows(rows,'BK0001','negative','magnitude')).toEqual([]);
 });
 it('breaks equal-value ties by provider code and displays unscaled values',()=>{
  const tied=[{...rows[0],f12:'BK0002'},{...rows[0],f12:'BK0001'}];
  expect(selectEvidenceRows(tied,'','all','magnitude').map(row=>row.f12)).toEqual(['BK0001','BK0002']);
  expect(exactAmount(12500.25)).toBe('+12,500.25');expect(exactAmount(-25000.5)).toBe('-25,000.5');
  expect(exactAmount(0)).toBe('0');expect(exactAmount(null)).toBe('未提供');
  expect(exactAmount(1e-21)).toBe('+0.000000000000000000001');
 });
});

describe('complete reachable A-share evidence list',()=>{
 it('explains that a board index and a stock quote have different units',()=>{
  const view=render(<EvidenceHeatmap state={state()}/>);
  expect(screen.getByText('f2 报价口径：行业指数（点），不是股票价格或资金金额。')).toBeTruthy();
  view.rerender(<EvidenceHeatmap state={state(snapshot(true))}/>);
  expect(screen.getByText('f2 报价口径：成分股价格（人民币元）。')).toBeTruthy();
 });
 it('keeps the treemap primary and hides the supplementary table until requested',()=>{
  const {container}=render(<EvidenceHeatmap state={state()}/>);
  expect(screen.getByRole('group',{name:'当前筛选范围的主力净额矩形热力图区块'})).toBeTruthy();
  expect(container.querySelector('details.evidence-list')?.hasAttribute('open')).toBe(false);
  openList();expect(container.querySelector('details.evidence-list')?.hasAttribute('open')).toBe(true);expect(screen.getByRole('table')).toBeTruthy();
 });
 it('shows every row with exact signed amounts and no manufactured zero or area',()=>{
  render(<EvidenceHeatmap state={state()}/>);openList();
  const table=screen.getByRole('table',{name:'行业主力净额明细'});
  expect(tableCodes()).toEqual(['BK0002','BK0001','BK0003','BK0004']);
  expect(within(table).getByText('+12,500.25')).toBeTruthy();expect(within(table).getByText('-25,000.5')).toBeTruthy();
  expect(within(table).getByText('33.33%')).toBeTruthy();expect(within(table).getByText('66.67%')).toBeTruthy();
  expect(within(table).getByText('—（零值）')).toBeTruthy();expect(within(table).getByText('—（缺失）')).toBeTruthy();
  expect(within(table).getByText('未提供，不是零')).toBeTruthy();
  expect(screen.getByRole('group',{name:'当前筛选范围的主力净额矩形热力图区块'}).querySelectorAll('g[data-id]')).toHaveLength(2);
  // Read-only industry embedding does not offer an unusable drilldown button.
  expect(within(table).queryByRole('button')).toBeNull();
 });
 it('allows zero and missing industries to open constituents without a treemap tile',()=>{
  const select=vi.fn();render(<EvidenceHeatmap state={state()} onIndustrySelect={select}/>);openList();
  fireEvent.click(screen.getByRole('button',{name:'进入合成零值的成分股'}));
  expect(select).toHaveBeenLastCalledWith({kind:'industry_stocks',fs:'b:BK0003',classification_level:'unknown_may_mix_levels'},expect.objectContaining({f62:0}));
  fireEvent.change(screen.getByLabelText('主力净额方向'),{target:{value:'missing'}});
  expect(screen.queryByRole('group',{name:'当前筛选范围的主力净额矩形热力图区块'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'进入合成缺失的成分股'}));
  expect(select).toHaveBeenLastCalledWith({kind:'industry_stocks',fs:'b:BK0004',classification_level:'unknown_may_mix_levels'},expect.objectContaining({f62:null}));
 });
 it('sorts, filters and recalculates shares from only the currently displayed rows',()=>{
  render(<EvidenceHeatmap state={state()}/>);openList();
  fireEvent.change(screen.getByLabelText('明细排序'),{target:{value:'net_desc'}});
  expect(tableCodes()).toEqual(['BK0001','BK0003','BK0002','BK0004']);
  fireEvent.change(screen.getByLabelText('主力净额方向'),{target:{value:'positive'}});
  expect(tableCodes()).toEqual(['BK0001']);expect(within(screen.getByRole('table')).getByText('100.00%')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('搜索代码或名称'),{target:{value:'不存在'}});
  expect(tableCodes()).toEqual([]);expect(screen.queryByRole('group',{name:'当前筛选范围的主力净额矩形热力图区块'})).toBeNull();expect(screen.getByText('没有匹配的行业或股票。')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('搜索代码或名称'),{target:{value:''}});
  fireEvent.change(screen.getByLabelText('主力净额方向'),{target:{value:'zero'}});
  expect(tableCodes()).toEqual(['BK0003']);expect(screen.queryByRole('group',{name:'当前筛选范围的主力净额矩形热力图区块'})).toBeNull();
 });
 it('keeps controls, selected evidence and exact updated values during same-scope refresh',()=>{
  const initial=snapshot(true);const view=render(<EvidenceHeatmap state={state(initial)}/>);openList();
  fireEvent.change(screen.getByLabelText('搜索代码或名称'),{target:{value:'000001'}});
  fireEvent.change(screen.getByLabelText('正负配色'),{target:{value:'global'}});
  fireEvent.change(screen.getByLabelText('主力净额方向'),{target:{value:'positive'}});
  fireEvent.change(screen.getByLabelText('明细排序'),{target:{value:'net_desc'}});
  fireEvent.click(screen.getByRole('button',{name:'查看合成净买的原始证据'}));
  const fresh={...initial,fetched_at:'2026-11-04T08:01:00Z',rows:initial.rows.map((row,i)=>i===0?{...row,f62:32000.75}:row)};
  view.rerender(<EvidenceHeatmap state={state(fresh)}/>);
  expect(screen.getByLabelText<HTMLInputElement>('搜索代码或名称').value).toBe('000001');
  expect(screen.getByLabelText('正负配色').querySelector('option:checked')?.getAttribute('value')).toBe('global');
  expect(screen.getByLabelText('主力净额方向').querySelector('option:checked')?.getAttribute('value')).toBe('positive');
  expect(screen.getByLabelText('明细排序').querySelector('option:checked')?.getAttribute('value')).toBe('net_desc');
  expect(screen.getByRole('article',{name:'股票原始证据'}).textContent).toContain('+32,000.75 元');
  expect(within(screen.getByRole('table')).getByText('+32,000.75')).toBeTruthy();
  view.rerender(<EvidenceHeatmap state={state({...fresh,stale:true,has_error:true})}/>);
  expect(screen.getByText(/服务器已标记缓存陈旧且有刷新错误/)).toBeTruthy();
  expect(screen.getByRole('article',{name:'股票原始证据'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'关闭原始证据'}));expect(screen.queryByRole('article')).toBeNull();
 });
 it('keeps selected evidence current when a refresh changes its flow direction',()=>{
  const initial=snapshot(true);const view=render(<EvidenceHeatmap state={state(initial)}/>);openList();
  fireEvent.change(screen.getByLabelText('主力净额方向'),{target:{value:'positive'}});
  fireEvent.click(screen.getByRole('button',{name:'查看合成净买的原始证据'}));
  for(const amount of [-7,0,null]){
   view.rerender(<EvidenceHeatmap state={state({...initial,rows:initial.rows.map((row,i)=>i===0?{...row,f62:amount}:row)})}/>);
   expect(tableCodes()).toEqual([]);
   expect(screen.getByRole('article').textContent).toContain(`f62：${exactAmount(amount)} 元`);
   expect(screen.getByText('所选股票已不符合当前筛选，仍显示其最新来源记录。')).toBeTruthy();
  }
 });
 it('resets exploration on another scope and clears all values after access denial',()=>{
  const view=render(<EvidenceHeatmap state={state(snapshot(true))}/>);openList();
  fireEvent.change(screen.getByLabelText('搜索代码或名称'),{target:{value:'000001'}});
  fireEvent.click(screen.getByRole('button',{name:'查看合成净买的原始证据'}));
  view.rerender(<EvidenceHeatmap state={state({...snapshot(true),scope:{kind:'industry_stocks',fs:'b:BK0002',classification_level:'unknown_may_mix_levels'}})}/>);
  expect(screen.getByLabelText<HTMLInputElement>('搜索代码或名称').value).toBe('');openList();expect(tableCodes()).toHaveLength(4);expect(screen.queryByRole('article')).toBeNull();
  view.rerender(<EvidenceHeatmap state={{...emptyState(),status:'blocked',message:'来源已拒绝'}}/>);
  expect(screen.queryByRole('table')).toBeNull();expect(screen.queryByRole('group',{name:'当前筛选范围的主力净额矩形热力图区块'})).toBeNull();expect(screen.queryByText('+12,500.25')).toBeNull();
 });
 it('opens zero/missing stock evidence and hides a selection removed by refreshed coverage',()=>{
  const initial=snapshot(true);const view=render(<EvidenceHeatmap state={state(initial)}/>);openList();
  fireEvent.click(screen.getByRole('button',{name:'查看合成缺失的原始证据'}));
  expect(screen.getByRole('article').textContent).toContain('f62：未提供 元');
  fireEvent.click(screen.getByRole('button',{name:'查看合成零值的原始证据'}));
  expect(screen.getByRole('article').textContent).toContain('f62：0 元');
  view.rerender(<EvidenceHeatmap state={state({...initial,source_total:3,rows:initial.rows.filter(row=>row.f12!=='000003')})}/>);
  expect(screen.queryByRole('article')).toBeNull();
 });
});
