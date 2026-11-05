// @vitest-environment jsdom
import React from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {renderToString} from 'react-dom/server';
import MarketTiming from '../components/ashare/MarketTiming';
import {emptyState,type EvidenceState} from '../components/ashare/client';
import {validateEvidence} from '../components/ashare/model';

function state(overrides:Record<string,unknown>={}):EvidenceState {
 const snapshot = validateEvidence({schema:'ashare-provider-evidence/1',rows:[],source_total:0,
  fetched_at:'2026-11-05T02:00:00Z',scope:{kind:'industry_rank',fs:'m:90+s:2+f:!50',classification_level:'eastmoney_level_1'},
  page_count:1,source_observed_at:null,trade_date:null,metric_kind:'provider_order_flow_proxy',metric_field:'f62',unit:'CNY',
  field_units:{f62:'CNY',f3:'percent',f2:'index_points'},delay_status:'not_provided',classification_exclusivity:'not_established',
  notice:'Synthetic fixture only',stale:false,has_error:false,...overrides});
 return {snapshot,etag:null,status:snapshot.stale?'stale':'ready',message:''};
}
const tick = ()=>act(()=>{vi.advanceTimersByTime(0);});
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-05T02:00:00Z'));});
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();});

describe('session and source time stay distinct in the owner view',()=>{
 it('server renders an unknown clock, not a guessed open status',()=>{
  const html = renderToString(<MarketTiming state={state()}/>);
  expect(html).toContain('等待设备时间');expect(html).not.toContain('上午连续竞价时段');
 });
 it('shows acquisition timestamp but leaves provider date, observation time and delay unknown',()=>{
  const original = state();
  render(<MarketTiming state={original}/>);tick();
  expect(screen.getByText('上午连续竞价时段')).toBeTruthy();
  expect(screen.getByText('未提供')).toBeTruthy();expect(screen.getByText('均未知')).toBeTruthy();
  expect(screen.getByText('2026-11-05 10:00:00').getAttribute('dateTime')).toBe('2026-11-05T02:00:00Z');
  expect(screen.getByRole('status').textContent).toContain('行情新旧仍未知');
  expect(screen.getByText(/当前采集尚未验证主力净额对应的交易日期/)).toBeTruthy();
  expect(screen.getByText(/报价更新时间不等于资金观测时间/)).toBeTruthy();
  expect(screen.queryByText(/当前来源没有提供/)).toBeNull();
  expect(original.snapshot).toMatchObject({source_observed_at:null,trade_date:null,stale:false});
 });
 it('ages a displayed snapshot without any source request and renews only for a new fetched_at',()=>{
  const fetcher = vi.fn();vi.stubGlobal('fetch',fetcher);
  const view = render(<MarketTiming state={state()}/>);tick();
  act(()=>{vi.advanceTimersByTime(60_000);});
  expect(screen.getByRole('status').getAttribute('data-acquisition-status')).toBe('expired');
  expect(fetcher).not.toHaveBeenCalled();
  view.rerender(<MarketTiming state={state({fetched_at:'2026-11-05T02:01:00Z'})}/>);
  expect(screen.getByRole('status').getAttribute('data-acquisition-status')).toBe('recent');
 });
 it('updates immediately after background suspension/focus and at lunch boundaries',()=>{
  const view = render(<MarketTiming state={state()}/>);tick();
  vi.setSystemTime(new Date('2026-11-05T03:30:00Z'));fireEvent.focus(window);
  expect(screen.getByText('午间休市')).toBeTruthy();
  expect(screen.getByRole('status').getAttribute('data-acquisition-status')).toBe('expired');
  vi.setSystemTime(new Date('2026-11-05T05:00:00Z'));fireEvent(document,new Event('visibilitychange'));
  expect(screen.getByText('下午连续竞价时段')).toBeTruthy();
  view.unmount();expect(vi.getTimerCount()).toBe(0);
 });
 it('resamples when snapshots arrive between clock ticks without masking a real future timestamp',()=>{
  const view = render(<MarketTiming state={state()}/>);tick();
  // Changing wall time without running interval timers reproduces a response
  // arriving after the last clock sample and before the next 15-second tick.
  for(const seconds of ['05','10']){
   const fetched_at = `2026-11-05T02:00:${seconds}Z`;
   vi.setSystemTime(new Date(fetched_at));
   view.rerender(<MarketTiming state={state({fetched_at})}/>);tick();
   expect(screen.getByRole('status').getAttribute('data-acquisition-status')).toBe('recent');
   expect(screen.queryByText(/设备时间早于采集时间/)).toBeNull();
   expect(vi.getTimerCount()).toBe(1);
  }
  view.rerender(<MarketTiming state={state({fetched_at:'2026-11-05T02:01:00Z'})}/>);tick();
  expect(screen.getByRole('status').getAttribute('data-acquisition-status')).toBe('clock_mismatch');
  view.unmount();expect(vi.getTimerCount()).toBe(0);
 });
 it('shows exchange closure while source is unavailable, without inventing a last trading date',()=>{
  vi.setSystemTime(new Date('2026-10-01T02:00:00Z'));
  render(<MarketTiming state={emptyState()}/>);tick();
  expect(screen.getByText('国庆节休市')).toBeTruthy();expect(screen.getByText('尚未取得')).toBeTruthy();
  expect(screen.getByRole('status').textContent).toContain('尚无完整有效快照');
  expect(screen.getByText('未提供')).toBeTruthy();
 });
 it('does not display a retained timestamp once the client is blocked or cleared',()=>{
  render(<MarketTiming state={{...state(),status:'blocked'}}/>);tick();
  expect(screen.queryByText('2026-11-05 10:00:00')).toBeNull();
  expect(screen.getByText('尚未取得')).toBeTruthy();
 });
 it('keeps a refresh error and in-flight work separate from calendar status',()=>{
  render(<MarketTiming state={state({stale:true,has_error:true})} loading/>);tick();
  expect(screen.getByRole('status').textContent).toContain('刷新失败，保留带标记的旧快照；正在获取');
  expect(screen.getByText('上午连续竞价时段')).toBeTruthy();
 });
 it('makes missing calendar coverage visible instead of claiming a live market',()=>{
  vi.setSystemTime(new Date('2027-01-04T02:00:00Z'));
  render(<MarketTiming state={emptyState()}/>);tick();
  expect(screen.getByText('交易日历未覆盖，开休市未知')).toBeTruthy();
  expect(screen.getByRole('link',{name:'2026 年上交所休市安排'}).getAttribute('href')).toContain('c_20251222_10802507.shtml');
 });
});
