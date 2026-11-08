// @vitest-environment jsdom
import React from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import OrganizedAshareEvidence from '../components/ashare/OrganizedAshareEvidence';
import AshareWorkspace from '../components/ashare/AshareWorkspace';
import {consumeReply,emptyState,type EvidenceState} from '../components/ashare/client';
import type {Scope} from '../components/ashare/model';
import {SNAPSHOT_MAX_AGE_MS} from '../lib/ashare/snapshot';
import type {OrganizedAshareReport} from '../lib/evidence/ashare-projection';
import {ASHARE_REPORT_NOW as NOW,ASHARE_REPORT_ROOT as ROOT,ashareReportFixture} from './organized-ashare-fixture';
const stockScope:Scope={kind:'industry_stocks',fs:'b:BK9000',classification_level:'unknown_may_mix_levels'};
const ready=():EvidenceState=>({...emptyState(),status:'ready',snapshot:ashareReportFixture()});
const link=()=>screen.queryByRole('link',{name:'下载整理后的 JSON',hidden:true});
const exported=()=>JSON.parse(decodeURIComponent(link()!.getAttribute('href')!.split(',')[1])) as OrganizedAshareReport;
const tick=(ms=1)=>act(()=>vi.advanceTimersByTimeAsync(ms));
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(NOW);Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});});
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});});
describe('A-share read-only export lifecycle',()=>{
 it('renders a real full-scope JSON download with no acquisition, correct missing state and no total claims',async()=>{
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);render(<OrganizedAshareEvidence state={ready()} scope={ROOT}/>);await tick();
  expect(exported().rows).toHaveLength(7);expect(exported().scope).toEqual(ROOT);
  fireEvent.click(screen.getByText('整理后的当前证据 · 统一字段与原值追溯'));
  expect(screen.getByRole('table')).toBeTruthy();expect(screen.getAllByText('来源缺失标记 · null')).toHaveLength(4);
  expect(screen.queryByText('来源合计（重叠）')).toBeNull();expect(screen.getByText(/观察期间与交易日期未知/)).toBeTruthy();
  expect(link()!.getAttribute('download')).toContain('eastmoney_level_1-acquired-');expect(fetcher).not.toHaveBeenCalled();
 });
 it('expires at the oldest acquisition clock without any network or state update',async()=>{
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  const snapshot=ashareReportFixture({now:NOW-SNAPSHOT_MAX_AGE_MS+120_010});
  render(<OrganizedAshareEvidence state={{...ready(),snapshot}} scope={ROOT}/>);await tick();expect(link()).not.toBeNull();
  await tick(8);expect(link()).not.toBeNull();await tick(1);expect(link()).toBeNull();expect(fetcher).not.toHaveBeenCalled();
 });
 it.each(['focus','pageshow','visibilitychange'])('withdraws suspended-tab evidence on %s even before the delayed timer fires',async event=>{
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);render(<OrganizedAshareEvidence state={ready()} scope={ROOT}/>);await tick();expect(link()).not.toBeNull();
  vi.setSystemTime(NOW+SNAPSHOT_MAX_AGE_MS);fireEvent(event==='visibilitychange'?document:window,new Event(event));
  expect(link()).toBeNull();expect(fetcher).not.toHaveBeenCalled();
 });
 it('blocks a late click even if no focus event or expiry timer has yet been delivered',async()=>{
  render(<OrganizedAshareEvidence state={ready()} scope={ROOT}/>);await tick();
  vi.setSystemTime(NOW+SNAPSHOT_MAX_AGE_MS);
  expect(fireEvent.click(link()!)).toBe(false);expect(link()).toBeNull();
 });
 it('suppresses mismatched scope during the very first render and distinguishes constituent exports',async()=>{
  const state=ready(),view=render(<OrganizedAshareEvidence state={state} scope={ROOT}/>);await tick();expect(link()).not.toBeNull();
  view.rerender(<OrganizedAshareEvidence state={state} scope={stockScope}/>);expect(link()).toBeNull();
  view.rerender(<OrganizedAshareEvidence state={{...state,snapshot:ashareReportFixture({scope:stockScope})}} scope={stockScope}/>);await tick();
  expect(exported().scope).toEqual(stockScope);expect(link()!.getAttribute('download')).toContain('-BK9000-acquired-');
  view.rerender(<OrganizedAshareEvidence state={{...state,snapshot:ashareReportFixture({scope:stockScope})}} scope={ROOT}/>);expect(link()).toBeNull();
 });
 it.each([401,403,429,400,'invalid','source_denied'] as const)('withdraws actual downloadable evidence after %s',async reason=>{
  const state=ready(),view=render(<OrganizedAshareEvidence state={state} scope={ROOT}/>);await tick();expect(link()).not.toBeNull();
  const reply=reason==='invalid'?{status:200,payload:{}}:reason==='source_denied'?{status:503,errorCode:'source_denied',recoveryMode:'stopped'}:{status:reason};
  const next=consumeReply(state,reply,ROOT,NOW+1);
  view.rerender(<OrganizedAshareEvidence state={next} scope={ROOT}/>);expect(link()).toBeNull();
 });
 it('keeps native bytes and original expiry through 503, staged collection, 304 and a fresher snapshot',async()=>{
  let state=ready();const view=render(<OrganizedAshareEvidence state={state} scope={ROOT}/>);await tick();
  const original=exported();
  state=consumeReply(state,{status:503,errorCode:'upstream_http',recoveryMode:'retry'},ROOT,NOW+1);
  view.rerender(<OrganizedAshareEvidence state={state} scope={ROOT}/>);expect(exported().presentation.stale).toBe(true);expect(exported().native_snapshot).toEqual(original.native_snapshot);
  state=consumeReply(state,{status:503,errorCode:'collection_in_progress',recoveryMode:'retry'},ROOT,NOW+2);
  view.rerender(<OrganizedAshareEvidence state={state} scope={ROOT}/>);expect(exported().presentation.stale).toBe(true);
  state=consumeReply(state,{status:304},ROOT,NOW+3);view.rerender(<OrganizedAshareEvidence state={state} scope={ROOT}/>);
  expect(exported().presentation.retention.expires_at).toBe(original.presentation.retention.expires_at);expect(exported().clocks).toEqual(original.clocks);
  vi.setSystemTime(NOW+60_000);state=consumeReply(state,{status:200,payload:ashareReportFixture({now:NOW+60_000})},ROOT,NOW+60_000);
  view.rerender(<OrganizedAshareEvidence state={state} scope={ROOT}/>);await tick();expect(exported().clocks.fetched_at).toBe(new Date(NOW+60_000).toISOString());
  expect(exported().presentation.retention.expires_at).not.toBe(original.presentation.retention.expires_at);
 });
 it('cleans up expiry and resume listeners on unmount',async()=>{
  const view=render(<OrganizedAshareEvidence state={ready()} scope={ROOT}/>);await tick();expect(vi.getTimerCount()).toBeGreaterThan(0);
  view.unmount();expect(vi.getTimerCount()).toBe(0);fireEvent.focus(window);await tick(SNAPSHOT_MAX_AGE_MS);expect(link()).toBeNull();
 });
});
describe('A-share workspace integration',()=>{
 it('reuses the existing response below the heatmap, preserves full scope through filters, and clears on navigation before another response',async()=>{
  let finish!:(response:Response)=>void;
  const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(ashareReportFixture())).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));vi.stubGlobal('fetch',fetcher);
  render(<AshareWorkspace/>);await tick(5);
  expect(exported().rows).toHaveLength(7);expect(fetcher).toHaveBeenCalledOnce();
  const heatmap=document.querySelector('.evidence-heatmap')!,panel=screen.getByText('整理后的当前证据 · 统一字段与原值追溯');
  expect(heatmap.compareDocumentPosition(panel)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.change(screen.getByLabelText('搜索代码或名称'),{target:{value:'合成证据0'}});
  fireEvent.change(screen.getByLabelText('主力净额方向'),{target:{value:'positive'}});
  expect(exported().rows).toHaveLength(7);expect(fetcher).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button',{name:/合成证据0.*BK9000/}));expect(link()).toBeNull();await tick();expect(fetcher).toHaveBeenCalledTimes(2);
  await act(async()=>finish(Response.json(ashareReportFixture({scope:stockScope}))));await tick();expect(exported().scope).toEqual(stockScope);
  fireEvent.click(screen.getByRole('button',{name:'← 全部一级行业'}));expect(link()).toBeNull();
 });
 it('removes the export on a polling permission denial, without an export-specific request',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(ashareReportFixture())).mockResolvedValueOnce(new Response(null,{status:403}));vi.stubGlobal('fetch',fetcher);
  render(<AshareWorkspace/>);await tick(5);expect(link()).not.toBeNull();await tick(60_000);expect(link()).toBeNull();expect(fetcher).toHaveBeenCalledTimes(2);
 });
});
