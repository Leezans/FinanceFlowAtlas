// @vitest-environment jsdom
import React from 'react';
import {Blob as NodeBlob} from 'node:buffer';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import OrganizedAshareEvidence from '../components/ashare/OrganizedAshareEvidence';
import AshareWorkspace from '../components/ashare/AshareWorkspace';
import {consumeReply,emptyState,type EvidenceState} from '../components/ashare/client';
import type {Scope} from '../components/ashare/model';
import {SNAPSHOT_MAX_AGE_MS} from '../lib/ashare/snapshot';
import {ashareExportExpiresAt, type OrganizedAshareReport} from '../lib/evidence/ashare-projection';
import {ASHARE_REPORT_NOW as NOW,ASHARE_REPORT_ROOT as ROOT,ashareReportFixture} from './organized-ashare-fixture';
const stockScope:Scope={kind:'industry_stocks',fs:'b:BK9000',classification_level:'unknown_may_mix_levels'};
const ready=():EvidenceState=>({...emptyState(),status:'ready',snapshot:ashareReportFixture()});
const link=()=>screen.queryByRole('link',{name:'下载整理后的 JSON',hidden:true});
const files=new Map<string,Blob>();
const createObjectURL=vi.fn<(blob:Blob)=>string>();
const revokeObjectURL=vi.fn<(url:string)=>void>();
const exported=async()=>JSON.parse(await files.get(link()!.getAttribute('href')!)!.text()) as OrganizedAshareReport;
const tick=(ms=1)=>act(()=>vi.advanceTimersByTimeAsync(ms));
const prepare=async()=>{await tick();await tick();};
beforeEach(()=>{
 vi.useFakeTimers();vi.setSystemTime(NOW);files.clear();let sequence=0;
 createObjectURL.mockReset().mockImplementation(blob=>{const url=`blob:ashare-${++sequence}`;files.set(url,blob);return url;});
 revokeObjectURL.mockReset().mockImplementation(url=>{files.delete(url);});
 vi.stubGlobal('Blob',NodeBlob);
 vi.stubGlobal('URL',class extends URL {static createObjectURL=createObjectURL;static revokeObjectURL=revokeObjectURL;});
 Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});
});
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});});
describe('A-share read-only export lifecycle',()=>{
 it('renders a real full-scope JSON download with no acquisition, correct missing state and no total claims',async()=>{
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);render(<OrganizedAshareEvidence state={ready()} scope={ROOT}/>);await prepare();
  expect((await exported()).rows).toHaveLength(7);expect((await exported()).scope).toEqual(ROOT);
  fireEvent.click(screen.getByText('整理后的当前证据 · 统一字段与原值追溯'));
  expect(screen.getByRole('table')).toBeTruthy();expect(screen.getAllByText('来源缺失标记 · null')).toHaveLength(4);
  expect(screen.queryByText('来源合计（重叠）')).toBeNull();expect(screen.getByText(/观察期间与交易日期未知/)).toBeTruthy();
  expect(link()!.getAttribute('download')).toContain('eastmoney_level_1-acquired-');expect(fetcher).not.toHaveBeenCalled();
 });
 it('expires at the oldest acquisition clock without any network or state update',async()=>{
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  const snapshot=ashareReportFixture({now:NOW-SNAPSHOT_MAX_AGE_MS+120_010});
  render(<OrganizedAshareEvidence state={{...ready(),snapshot}} scope={ROOT}/>);await prepare();expect(link()).not.toBeNull();
  await tick(ashareExportExpiresAt(snapshot)-Date.now()-1);expect(link()).not.toBeNull();await tick(1);expect(link()).toBeNull();expect(files.size).toBe(0);expect(revokeObjectURL).toHaveBeenCalledOnce();expect(fetcher).not.toHaveBeenCalled();
 });
 it.each(['focus','pageshow','visibilitychange'])('withdraws suspended-tab evidence on %s even before the delayed timer fires',async event=>{
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);render(<OrganizedAshareEvidence state={ready()} scope={ROOT}/>);await prepare();expect(link()).not.toBeNull();
  vi.setSystemTime(NOW+SNAPSHOT_MAX_AGE_MS);fireEvent(event==='visibilitychange'?document:window,new Event(event));
  expect(link()).toBeNull();expect(files.size).toBe(0);expect(revokeObjectURL).toHaveBeenCalledOnce();expect(fetcher).not.toHaveBeenCalled();
 });
 it('blocks a late click even if no focus event or expiry timer has yet been delivered',async()=>{
  render(<OrganizedAshareEvidence state={ready()} scope={ROOT}/>);await prepare();
  vi.setSystemTime(NOW+SNAPSHOT_MAX_AGE_MS);
  expect(fireEvent.click(link()!)).toBe(false);expect(link()).toBeNull();expect(files.size).toBe(0);expect(revokeObjectURL).toHaveBeenCalledOnce();
 });
 it('suppresses mismatched scope during the very first render and distinguishes constituent exports',async()=>{
  const state=ready(),view=render(<OrganizedAshareEvidence state={state} scope={ROOT}/>);await prepare();expect(link()).not.toBeNull();
  view.rerender(<OrganizedAshareEvidence state={state} scope={stockScope}/>);expect(link()).toBeNull();
  view.rerender(<OrganizedAshareEvidence state={{...state,snapshot:ashareReportFixture({scope:stockScope})}} scope={stockScope}/>);await prepare();
  expect((await exported()).scope).toEqual(stockScope);expect(link()!.getAttribute('download')).toContain('-BK9000-acquired-');
  view.rerender(<OrganizedAshareEvidence state={{...state,snapshot:ashareReportFixture({scope:stockScope})}} scope={ROOT}/>);expect(link()).toBeNull();
 });
 it.each([401,403,429,400,'invalid','source_denied'] as const)('withdraws actual downloadable evidence after %s',async reason=>{
  const state=ready(),view=render(<OrganizedAshareEvidence state={state} scope={ROOT}/>);await prepare();expect(link()).not.toBeNull();
  const reply=reason==='invalid'?{status:200,payload:{}}:reason==='source_denied'?{status:503,errorCode:'source_denied',recoveryMode:'stopped'}:{status:reason};
  const next=consumeReply(state,reply,ROOT,NOW+1);
  view.rerender(<OrganizedAshareEvidence state={next} scope={ROOT}/>);expect(link()).toBeNull();expect(files.size).toBe(0);expect(revokeObjectURL).toHaveBeenCalledOnce();
 });
 it('keeps native bytes and original expiry through 503, staged collection, 304 and a fresher snapshot',async()=>{
  let state=ready();const view=render(<OrganizedAshareEvidence state={state} scope={ROOT}/>);await prepare();
  const original=await exported();
  state=consumeReply(state,{status:503,errorCode:'upstream_http',recoveryMode:'retry'},ROOT,NOW+1);
  view.rerender(<OrganizedAshareEvidence state={state} scope={ROOT}/>);await prepare();expect((await exported()).presentation.stale).toBe(true);expect((await exported()).native_snapshot).toEqual(original.native_snapshot);
  state=consumeReply(state,{status:503,errorCode:'collection_in_progress',recoveryMode:'retry'},ROOT,NOW+2);
  view.rerender(<OrganizedAshareEvidence state={state} scope={ROOT}/>);await prepare();expect((await exported()).presentation.stale).toBe(true);
  state=consumeReply(state,{status:304},ROOT,NOW+3);view.rerender(<OrganizedAshareEvidence state={state} scope={ROOT}/>);await prepare();
  expect((await exported()).presentation.retention.expires_at).toBe(original.presentation.retention.expires_at);expect((await exported()).clocks).toEqual(original.clocks);
  vi.setSystemTime(NOW+60_000);state=consumeReply(state,{status:200,payload:ashareReportFixture({now:NOW+60_000})},ROOT,NOW+60_000);
  view.rerender(<OrganizedAshareEvidence state={state} scope={ROOT}/>);await prepare();expect((await exported()).clocks.fetched_at).toBe(new Date(NOW+60_000).toISOString());
  expect((await exported()).presentation.retention.expires_at).not.toBe(original.presentation.retention.expires_at);
 });
 it('cleans up expiry and resume listeners on unmount',async()=>{
  const view=render(<OrganizedAshareEvidence state={ready()} scope={ROOT}/>);await prepare();expect(vi.getTimerCount()).toBeGreaterThan(0);
  view.unmount();expect(files.size).toBe(0);expect(revokeObjectURL).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);fireEvent.focus(window);await tick(SNAPSHOT_MAX_AGE_MS);expect(link()).toBeNull();
 });

 it.each(['scope', 'denial', 'stopped', 'expiry', 'unmount'] as const)(
  'cancels pending local preparation on %s before any file exists',
  async reason => {
   const state = ready();
   const fetcher = vi.fn();
   vi.stubGlobal('fetch', fetcher);
   const view = render(<OrganizedAshareEvidence state={state} scope={ROOT}/>);
   await tick(); // Clock sampled, but the Blob timer has not run.
   expect(screen.getByText('正在准备本地 JSON…')).toBeTruthy();
   expect(createObjectURL).not.toHaveBeenCalled();
   if (reason === 'scope') {
    view.rerender(<OrganizedAshareEvidence state={state} scope={stockScope}/>);
   } else if (reason === 'denial') {
    view.rerender(<OrganizedAshareEvidence state={consumeReply(state, {status: 403}, ROOT, NOW)} scope={ROOT}/>);
   } else if (reason === 'stopped') {
    // A stopped recovery must hide even bytes retained by a caller.
    view.rerender(<OrganizedAshareEvidence state={{...state, recovery: {mode: 'stopped', code: 'source_denied', retryAt: null, httpStatus: 403}}} scope={ROOT}/>);
   } else if (reason === 'expiry') {
    vi.setSystemTime(ashareExportExpiresAt(state.snapshot!));
    fireEvent.focus(window);
   } else {
    view.unmount();
   }
   await prepare();
   expect(link()).toBeNull();
   expect(files.size).toBe(0);
   expect(createObjectURL).not.toHaveBeenCalled();
   expect(revokeObjectURL).not.toHaveBeenCalled();
   expect(fetcher).not.toHaveBeenCalled();
  },
 );

 it('cancels a pending report replacement and prepares only the latest permitted scope', async () => {
  const state = ready();
  const view = render(<OrganizedAshareEvidence state={state} scope={ROOT}/>);
  await prepare();
  const firstHref = link()!.getAttribute('href');
  const replacement = ashareReportFixture();
  replacement.rows[0].f62 = 321;
  view.rerender(<OrganizedAshareEvidence state={{...state, snapshot: replacement}} scope={ROOT}/>);
  expect(link()).toBeNull();
  view.rerender(<OrganizedAshareEvidence state={{...state, snapshot: ashareReportFixture({scope: stockScope})}} scope={stockScope}/>);
  expect(link()).toBeNull();
  await prepare();
  expect((await exported()).scope).toEqual(stockScope);
  expect(createObjectURL).toHaveBeenCalledTimes(2);
  expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(firstHref);
  expect(files.size).toBe(1);
  view.unmount();
  expect(files.size).toBe(0);
  expect(revokeObjectURL).toHaveBeenCalledTimes(2);
 });

 it('keeps a valid prepared file through repeated allowed clicks without rebuilding', async () => {
  const view = render(<OrganizedAshareEvidence state={ready()} scope={ROOT}/>);
  await prepare();
  const href = link()!.getAttribute('href');
  const blocked: boolean[] = [];
  // Observe the React guard before stopping jsdom's unsupported navigation.
  const observe = (event: MouseEvent) => {
   blocked.push(event.defaultPrevented);
   event.preventDefault();
  };
  document.addEventListener('click', observe);
  try {
   for (let index = 0; index < 3; index++) {
    vi.setSystemTime(Date.now() + 1_000);
    fireEvent.click(link()!);
    await prepare();
    expect(link()!.getAttribute('href')).toBe(href);
   }
  } finally {
   document.removeEventListener('click', observe);
  }
  expect(blocked).toEqual([false, false, false]);
  expect(createObjectURL).toHaveBeenCalledOnce();
  expect(revokeObjectURL).not.toHaveBeenCalled();
  view.unmount();
  expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(href);
 });
});
describe('A-share workspace integration',()=>{
 it('reuses the existing response below the heatmap, preserves full scope through filters, and clears on navigation before another response',async()=>{
  let finish!:(response:Response)=>void;
  const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(ashareReportFixture())).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));vi.stubGlobal('fetch',fetcher);
  render(<AshareWorkspace/>);await tick(5);await prepare();
  expect((await exported()).rows).toHaveLength(7);expect(fetcher).toHaveBeenCalledOnce();
  const heatmap=document.querySelector('.evidence-heatmap')!,panel=screen.getByText('整理后的当前证据 · 统一字段与原值追溯');
  expect(heatmap.compareDocumentPosition(panel)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.change(screen.getByLabelText('搜索代码或名称'),{target:{value:'合成证据0'}});
  fireEvent.change(screen.getByLabelText('主力净额方向'),{target:{value:'positive'}});
  expect((await exported()).rows).toHaveLength(7);expect(fetcher).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button',{name:/合成证据0.*BK9000/}));expect(link()).toBeNull();await prepare();expect(fetcher).toHaveBeenCalledTimes(2);
  await act(async()=>finish(Response.json(ashareReportFixture({scope:stockScope}))));await prepare();expect((await exported()).scope).toEqual(stockScope);
  fireEvent.click(screen.getByRole('button',{name:'← 全部一级行业'}));expect(link()).toBeNull();
 });
 it('removes the export on a polling permission denial, without an export-specific request',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(ashareReportFixture())).mockResolvedValueOnce(new Response(null,{status:403}));vi.stubGlobal('fetch',fetcher);
  render(<AshareWorkspace/>);await tick(5);await prepare();expect(link()).not.toBeNull();await tick(60_000);expect(link()).toBeNull();expect(fetcher).toHaveBeenCalledTimes(2);
 });
});
