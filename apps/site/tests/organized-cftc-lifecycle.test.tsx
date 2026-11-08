// @vitest-environment jsdom
import React from 'react';
import {Blob} from 'node:buffer';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import FuturesPositioning from '../components/futures/FuturesPositioning';
import OrganizedEvidence,{CFTC_PREVIEW_LIMIT} from '../components/evidence/OrganizedEvidence';
import {projectCftcReport,type OrganizedCftcReport} from '../lib/evidence/cftc-projection';
import {MAX_CACHE_AGE_MS,MAX_REPORT_AGE_DAYS,REFRESH_MS} from '../lib/futures/model';
import {reply,legacyReply,NOW} from './cftc-fixture';
const files=new Map<string,Blob>();let sequence=0;
const create=vi.fn((blob:Blob)=>{const url=`blob:synthetic-cftc-${++sequence}`;files.set(url,blob);return url;});
const revoke=vi.fn((url:string)=>files.delete(url));
const link=()=>screen.queryByRole('link',{name:'下载整理后的 JSON',hidden:true});
const tick=(ms=5)=>act(()=>vi.advanceTimersByTimeAsync(ms));
const exported=async()=>JSON.parse(await files.get(link()!.getAttribute('href')!)!.text()) as OrganizedCftcReport;
function visibility(value:'visible'|'hidden',emit=true){Object.defineProperty(document,'visibilityState',{value,configurable:true});if(emit)fireEvent(document,new Event('visibilitychange'));}
beforeEach(()=>{
 vi.useFakeTimers();vi.setSystemTime(NOW);files.clear();create.mockClear();revoke.mockClear();
 vi.stubGlobal('Blob',Blob);vi.stubGlobal('URL',Object.assign(class extends URL {},{createObjectURL:create,revokeObjectURL:revoke}));visibility('visible',false);
});
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();visibility('visible',false);});
async function start(){const view=render(<FuturesPositioning/>);await tick();await tick();return view;}
async function nextCheck(){fireEvent.click(screen.getByRole('button',{name:'检查报告'}));await tick();await tick();}

describe('CFTC complete current-snapshot export and lifecycle',()=>{
 it('keeps the matrix primary and exports all 832 fields independently of trader or selected-market controls',async()=>{
  const fetcher=vi.fn(async()=>Response.json(reply()));vi.stubGlobal('fetch',fetcher);await start();
  const report=await exported(),original=link()!.getAttribute('href');
  expect(report.native_snapshot).toEqual(reply().snapshot);expect(report.rows).toHaveLength(832);
  expect(link()!.getAttribute('download')).toBe('cftc-2026-10-27-organized.json');expect(original).toMatch(/^blob:/);
  const heading=screen.getByRole('heading',{name:'精选美国期货品类矩阵'}),panel=screen.getByText('整理后的当前证据 · 统一字段与原值追溯');
  expect(heading.compareDocumentPosition(panel)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(panel.closest('details')!.open).toBe(false);fireEvent.click(panel);expect(panel.closest('details')!.open).toBe(true);
  const table=screen.getByRole('table');expect(within(table).getByRole('columnheader',{name:'原值 / contracts'})).toBeTruthy();
  expect(within(table).getByRole('columnheader',{name:'持仓观测日期'})).toBeTruthy();expect(within(table).getByRole('columnheader',{name:'应用导航品类 / 合约规格'})).toBeTruthy();
  expect(within(table).getAllByText('持仓字段（重叠）')).toHaveLength(CFTC_PREVIEW_LIMIT);expect(within(table).getByText('rows[0].previous.noncommercial_long')).toBeTruthy();
  expect(screen.getByText(/监管报告市场（不代表标的所在地）/)).toBeTruthy();expect(screen.getByText(/不一起相加，也不跨品种合计/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'商业交易者'}));fireEvent.click(screen.getByRole('button',{name:/欧元期货.*OI/}));await tick(30_000);
  expect(link()!.getAttribute('href')).toBe(original);expect(create).toHaveBeenCalledOnce();expect(revoke).not.toHaveBeenCalled();
  expect((await exported()).rows).toEqual(report.rows);expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0]).toEqual(['/api/v1/futures/cftc/snapshot',expect.objectContaining({credentials:'same-origin',cache:'no-store',redirect:'manual'})]);
 });
 it('keeps the legacy file at 64 fields with per-market previous dates, then revokes it on a full expansion',async()=>{
  const legacy=legacyReply();legacy.snapshot!.rows[1].previous.date='2026-10-18';
  const fetcher=vi.fn(async()=>Response.json(legacy));vi.stubGlobal('fetch',fetcher);await start();const original=link()!.getAttribute('href');
  const report=await exported();expect(report.rows).toHaveLength(64);expect(report.native_snapshot).toEqual(legacy.snapshot);expect(report.period.previous_report_dates).toEqual(['2026-10-18','2026-10-20']);
  fireEvent.click(screen.getByText('整理后的当前证据 · 统一字段与原值追溯'));
  expect(screen.getByText(/旧版 4 市场，未扩展为 52 市场/)).toBeTruthy();expect(screen.getAllByRole('row')).toHaveLength(65);expect(screen.getAllByText('前期 · 2026-10-18')).toHaveLength(8);
  fetcher.mockImplementation(async()=>Response.json(reply()));await nextCheck();
  expect((await exported()).rows).toHaveLength(832);expect(revoke).toHaveBeenCalledWith(original);expect(files.size).toBe(1);expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it.each([401,403,302,'opaque','redirected','denied','invalid','private_extra'] as const)('withdraws the preview and revokes its file after %s',async reason=>{
  const fetcher=vi.fn(async()=>Response.json(reply()));vi.stubGlobal('fetch',fetcher);await start();const original=link()!.getAttribute('href');
  fetcher.mockImplementation(async()=>{
   if(typeof reason==='number')return new Response(null,{status:reason});
   if(reason==='opaque'){const value=new Response(null);Object.defineProperties(value,{type:{value:'opaqueredirect'},status:{value:0}});return value;}
   if(reason==='redirected'){const value=Response.json(reply());Object.defineProperty(value,'redirected',{value:true});return value;}
   if(reason==='invalid')return Response.json({snapshot:{}});
   if(reason==='private_extra')return Response.json({...reply(),snapshot:{...reply().snapshot,private_token:'synthetic'}});
   return Response.json({snapshot:null,status:{...reply().status,state:'denied',error_code:'source_denied'}},{status:503});
  });
  await nextCheck();expect(link()).toBeNull();expect(screen.queryByText('整理后的当前证据 · 统一字段与原值追溯')).toBeNull();
  expect(revoke).toHaveBeenCalledWith(original);expect(files.size).toBe(0);expect(fetcher).toHaveBeenCalledTimes(2);
  if(reason!=='invalid'&&reason!=='private_extra'){await tick(REFRESH_MS+1);expect(fetcher).toHaveBeenCalledTimes(2);}
 });
 it.each(['cache','report'] as const)('rejects a suspended-tab click just past the inclusive %s bound',async limit=>{
  const response=reply();let boundary=NOW+MAX_CACHE_AGE_MS;
  if(limit==='report'){
   boundary=Date.parse(response.snapshot!.rows[0].current.date)+MAX_REPORT_AGE_DAYS*86_400_000;vi.setSystemTime(boundary-10_000);
   response.snapshot!.fetched_at=response.snapshot!.acquisition_started_at=response.status.fetched_at=new Date(boundary-10_000).toISOString();
  }
  const fetcher=vi.fn(async()=>Response.json(response));vi.stubGlobal('fetch',fetcher);await start();const original=link()!.getAttribute('href');
  vi.setSystemTime(boundary+1);expect(link()).not.toBeNull();expect(fireEvent.click(link()!)).toBe(false);
  expect(link()).toBeNull();expect(revoke).toHaveBeenCalledWith(original);expect(files.size).toBe(0);expect(fetcher).toHaveBeenCalledOnce();
 });
 it('withdraws both matrix and export in a hidden tab with the existing expiry clock',async()=>{
  const fetcher=vi.fn(async()=>Response.json(reply()));vi.stubGlobal('fetch',fetcher);await start();visibility('hidden');
  vi.setSystemTime(NOW+MAX_CACHE_AGE_MS+1);await tick(30_001);
  expect(link()).toBeNull();expect(files.size).toBe(0);expect(screen.queryByRole('group',{name:'精选美国期货品类矩阵区块'})).toBeNull();expect(fetcher).toHaveBeenCalledOnce();
 });
 it('retains exact position dates and acquisition clocks across temporary failure, with a stale replacement file',async()=>{
  const fetcher=vi.fn(async()=>Response.json(reply()));vi.stubGlobal('fetch',fetcher);await start();const before=await exported(),original=link()!.getAttribute('href');
  fetcher.mockRejectedValue(new Error('offline'));await nextCheck();const retained=await exported();
  expect(retained.presentation.stale).toBe(true);expect(retained.native_snapshot).toEqual(before.native_snapshot);expect(retained.clocks).toEqual(before.clocks);expect(retained.rows).toEqual(before.rows);expect(revoke).toHaveBeenCalledWith(original);
  const stale=link()!.getAttribute('href'),replacement=reply(),fetched=new Date(NOW+1000).toISOString();vi.setSystemTime(NOW+1000);
  replacement.snapshot!.acquisition_started_at=replacement.snapshot!.fetched_at=replacement.status.fetched_at=fetched;
  fetcher.mockResolvedValue(Response.json(replacement));await nextCheck();
  expect((await exported()).clocks.fetched_at).toBe(fetched);expect((await exported()).presentation.stale).toBe(false);expect(revoke).toHaveBeenCalledWith(stale);expect(files.size).toBe(1);expect(fetcher).toHaveBeenCalledTimes(3);
 });
 it('has no downloadable file for unavailable or future-fetched evidence',async()=>{
  const fetcher=vi.fn(async()=>Response.json({snapshot:null,status:{...reply().status,state:'unavailable'}},{status:503}));vi.stubGlobal('fetch',fetcher);const view=await start();
  expect(link()).toBeNull();expect(create).not.toHaveBeenCalled();view.unmount();
  const future=reply();future.snapshot!.fetched_at=future.status.fetched_at=new Date(NOW+60_000).toISOString();fetcher.mockResolvedValue(Response.json(future));await start();
  expect(link()).toBeNull();expect(create).not.toHaveBeenCalled();
 });
 it('revokes on unmount and cancels unfinished local preparation',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json(reply())));const view=await start(),original=link()!.getAttribute('href');
  view.unmount();expect(revoke).toHaveBeenCalledWith(original);expect(files.size).toBe(0);expect(vi.getTimerCount()).toBe(0);
  create.mockClear();const pending=render(<OrganizedEvidence report={projectCftcReport(reply().snapshot)}/>);pending.unmount();await tick();
  expect(create).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
 });
 it('bounds the preview at 120 while including every market and both dates in the 832-row file',async()=>{
  render(<OrganizedEvidence report={projectCftcReport(reply().snapshot)}/>);await tick();fireEvent.click(screen.getByText('整理后的当前证据 · 统一字段与原值追溯'));
  expect(screen.getAllByRole('row')).toHaveLength(CFTC_PREVIEW_LIMIT+1);expect(screen.getByText(/832 条（预览前 120 条，JSON 包含全部/)).toBeTruthy();
  expect((await exported()).native_snapshot.rows).toHaveLength(52);expect((await exported()).rows).toHaveLength(832);
 });
 it('never shows the old file while a replacement prepares and reports local preparation failure honestly',async()=>{
  const view=render(<OrganizedEvidence report={projectCftcReport(reply().snapshot)}/>);await tick();const original=link()!.getAttribute('href');
  view.rerender(<OrganizedEvidence report={projectCftcReport(reply().snapshot,true)}/>);expect(link()).toBeNull();expect(revoke).toHaveBeenCalledWith(original);
  create.mockImplementationOnce(()=>{throw new Error('unsupported');});await tick();expect(link()).toBeNull();expect(files.size).toBe(0);expect(screen.getByText('无法准备本地 JSON，当前证据仍可在下表查看。')).toBeTruthy();
 });
});
