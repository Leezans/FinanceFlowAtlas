// @vitest-environment jsdom
import React from 'react';
import {Blob} from 'node:buffer';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import CvmFunds from '../components/cvm/CvmFunds';
import OrganizedEvidence,{CVM_PREVIEW_LIMIT} from '../components/evidence/OrganizedEvidence';
import {projectCvmReport,type OrganizedCvmReport} from '../lib/evidence/cvm-projection';
import {MAX_CACHE_AGE_MS,MAX_REPORT_AGE_DAYS,REFRESH_MS} from '../lib/cvm/model';
import {cvmReply,cvmSnapshot,manyCvmSecurities,NOW} from './organized-cvm-fixture';
const files=new Map<string,Blob>();let sequence=0;
const create=vi.fn((blob:Blob)=>{const url=`blob:synthetic-cvm-${++sequence}`;files.set(url,blob);return url;});
const revoke=vi.fn((url:string)=>files.delete(url));
const link=()=>screen.queryByRole('link',{name:'下载整理后的 JSON',hidden:true});
const tick=(ms=5)=>act(()=>vi.advanceTimersByTimeAsync(ms));
const exported=async()=>JSON.parse(await files.get(link()!.getAttribute('href')!)!.text()) as OrganizedCvmReport;
function visibility(value:'visible'|'hidden',emit=true){Object.defineProperty(document,'visibilityState',{value,configurable:true});if(emit)fireEvent(document,new Event('visibilitychange'));}
beforeEach(()=>{
 vi.useFakeTimers();vi.setSystemTime(NOW);files.clear();create.mockClear();revoke.mockClear();
 vi.stubGlobal('Blob',Blob);vi.stubGlobal('URL',Object.assign(class extends URL {},{createObjectURL:create,revokeObjectURL:revoke}));visibility('visible',false);
});
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();visibility('visible',false);});
async function start(){const view=render(<CvmFunds/>);await tick();await tick();return view;}
async function nextCheck(){vi.setSystemTime(Date.now()+REFRESH_MS+1);visibility('visible');await tick();await tick();}

describe('CVM visible snapshot integration and local Blob download',()=>{
 it('exports the complete exact snapshot below the heatmap without acquisition or filter-dependent file recreation',async()=>{
  const fetcher=vi.fn(async()=>Response.json(cvmReply()));vi.stubGlobal('fetch',fetcher);await start();
  const report=await exported(),original=link()!.getAttribute('href');
  expect(report.native_snapshot).toEqual(cvmSnapshot());expect(report.rows).toHaveLength(15);
  expect(link()!.getAttribute('download')).toBe('cvm-fund-equity-2026-09-30-organized.json');expect(original).toMatch(/^blob:/);
  const heading=screen.getByRole('heading',{name:'基金股票 · 行业净买卖矩阵'}),panel=screen.getByText('整理后的当前证据 · 统一字段与原值追溯');
  expect(heading.compareDocumentPosition(panel)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();fireEvent.click(panel);
  const table=screen.getByRole('table');expect(within(table).getByRole('columnheader',{name:'原值 / BRL_cents'})).toBeTruthy();
  expect(within(table).getAllByText('公开交易金额不可用 · null')).toHaveLength(6);
  expect(within(table).getAllByText('原适配器汇总公开交易')).toHaveLength(6);expect(within(table).getAllByText('原适配器买入减卖出')).toHaveLength(3);
  expect(within(table).getByText('2001')).toBeTruthy();expect(within(table).queryByText('20.01')).toBeNull();
  expect(screen.getByText(/2026-09-01 至 2026-09-30 · 月度/)).toBeTruthy();expect(screen.getByText(/classification_point_in_time: false/)).toBeTruthy();
  fireEvent.change(screen.getByRole('combobox'),{target:{value:'Bancos'}});fireEvent.click(document.querySelector('g[data-id="ALPH3"]')!);await tick(30_000);
  expect(link()!.getAttribute('href')).toBe(original);expect(create).toHaveBeenCalledOnce();expect(revoke).not.toHaveBeenCalled();
  expect((await exported()).rows).toEqual(report.rows);expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0]).toEqual(['/api/v1/brazil/cvm/snapshot',expect.objectContaining({credentials:'same-origin',redirect:'manual'})]);
 });
 it.each([401,403,407,451,302,'denied','invalid','private_extra'] as const)('removes preview and revokes the file after %s',async reason=>{
  const fetcher=vi.fn(async()=>Response.json(cvmReply()));vi.stubGlobal('fetch',fetcher);await start();const original=link()!.getAttribute('href');
  fetcher.mockImplementation(async()=>typeof reason==='number'?new Response(null,{status:reason}):reason==='invalid'?Response.json({snapshot:{}}):reason==='private_extra'?Response.json({...cvmReply(),snapshot:{...cvmSnapshot(),private_token:'synthetic'}}):Response.json({snapshot:null,status:{...cvmReply().status,state:'denied',error_code:'source_denied'}},{status:503}));
  await nextCheck();expect(link()).toBeNull();expect(screen.queryByText('整理后的当前证据 · 统一字段与原值追溯')).toBeNull();
  expect(revoke).toHaveBeenCalledWith(original);expect(files.size).toBe(0);expect(fetcher).toHaveBeenCalledTimes(2);
  if(reason!=='invalid'&&reason!=='private_extra'){await tick(REFRESH_MS+1);expect(fetcher).toHaveBeenCalledTimes(2);}
 });
 it.each(['cache','report'] as const)('rejects a suspended-tab click just beyond the inclusive %s age bound',async limit=>{
  const reply=cvmReply();let boundary=NOW+MAX_CACHE_AGE_MS;
  if(limit==='report'){
   boundary=Date.parse(reply.snapshot.report_date)+MAX_REPORT_AGE_DAYS*86_400_000;vi.setSystemTime(boundary-10_000);
   const fetched=new Date(boundary-10_000).toISOString();reply.snapshot.fetched_at=reply.snapshot.acquisition_started_at=reply.status.fetched_at=fetched;reply.snapshot.classification_date=fetched.slice(0,10);
  }
  const fetcher=vi.fn(async()=>Response.json(reply));vi.stubGlobal('fetch',fetcher);await start();const original=link()!.getAttribute('href');
  vi.setSystemTime(boundary+1);expect(link()).not.toBeNull();expect(fireEvent.click(link()!)).toBe(false);
  expect(link()).toBeNull();expect(revoke).toHaveBeenCalledWith(original);expect(files.size).toBe(0);expect(fetcher).toHaveBeenCalledOnce();
 });
 it('withdraws both the heatmap and the export in hidden tabs using the existing timer',async()=>{
  const fetcher=vi.fn(async()=>Response.json(cvmReply()));vi.stubGlobal('fetch',fetcher);await start();visibility('hidden');
  vi.setSystemTime(NOW+MAX_CACHE_AGE_MS+1);await tick(30_001);
  expect(link()).toBeNull();expect(files.size).toBe(0);expect(document.querySelector('g[data-id="Bancos"]')).toBeNull();expect(fetcher).toHaveBeenCalledOnce();
 });
 it('retains original observation, acquisition and hash provenance after a temporary failure, then replaces the local file',async()=>{
  const fetcher=vi.fn(async()=>Response.json(cvmReply()));vi.stubGlobal('fetch',fetcher);await start();const before=await exported(),original=link()!.getAttribute('href');
  fetcher.mockRejectedValue(new Error('offline'));await nextCheck();const retained=await exported();
  expect(retained.presentation.stale).toBe(true);expect(retained.native_snapshot).toEqual(before.native_snapshot);expect(retained.clocks).toEqual(before.clocks);expect(retained.source.raw_sha256).toEqual(before.source.raw_sha256);
  expect(revoke).toHaveBeenCalledWith(original);const stale=link()!.getAttribute('href');
  const replacement=cvmReply(),fetched=new Date(Date.now()+REFRESH_MS+1).toISOString();replacement.snapshot.acquisition_started_at=replacement.snapshot.fetched_at=replacement.status.fetched_at=fetched;replacement.snapshot.classification_date=fetched.slice(0,10);
  fetcher.mockResolvedValue(Response.json(replacement));await nextCheck();
  expect((await exported()).clocks.fetched_at).toBe(fetched);expect((await exported()).presentation.stale).toBe(false);expect(revoke).toHaveBeenCalledWith(stale);expect(files.size).toBe(1);expect(fetcher).toHaveBeenCalledTimes(3);
 });
 it('has no downloadable evidence for unavailable or future-fetched snapshots',async()=>{
  const fetcher=vi.fn(async()=>Response.json({snapshot:null,status:{...cvmReply().status,state:'unavailable'}},{status:503}));vi.stubGlobal('fetch',fetcher);const view=await start();
  expect(link()).toBeNull();expect(create).not.toHaveBeenCalled();view.unmount();
  const future=cvmReply();future.snapshot.fetched_at=future.status.fetched_at=new Date(NOW+60_000).toISOString();fetcher.mockResolvedValue(Response.json(future));await start();
  expect(link()).toBeNull();expect(create).not.toHaveBeenCalled();
 });
 it('revokes on unmount and cancels unfinished local preparation',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json(cvmReply())));const view=await start();const original=link()!.getAttribute('href');
  view.unmount();expect(revoke).toHaveBeenCalledWith(original);expect(files.size).toBe(0);expect(vi.getTimerCount()).toBe(0);
  create.mockClear();const pending=render(<OrganizedEvidence report={projectCvmReport(cvmSnapshot())}/>);pending.unmount();await tick();
  expect(create).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
 });
 it('bounds the DOM preview at 120 rows but exports all 9000 rows from the maximum display schema',async()=>{
  render(<OrganizedEvidence report={projectCvmReport(manyCvmSecurities(3000))}/>);await tick();fireEvent.click(screen.getByText('整理后的当前证据 · 统一字段与原值追溯'));
  expect(screen.getAllByRole('row')).toHaveLength(CVM_PREVIEW_LIMIT+1);expect(screen.getByText(/9000 条（预览前 120 条，JSON 包含全部/)).toBeTruthy();
  const report=await exported();expect(report.rows).toHaveLength(9000);expect(report.native_snapshot.rows).toHaveLength(3000);
 });
 it('never presents the previous file during replacement and reports local preparation failure honestly',async()=>{
  const view=render(<OrganizedEvidence report={projectCvmReport(cvmSnapshot())}/>);await tick();const original=link()!.getAttribute('href');
  view.rerender(<OrganizedEvidence report={projectCvmReport(cvmSnapshot(),true)}/>);expect(link()).toBeNull();expect(revoke).toHaveBeenCalledWith(original);
  create.mockImplementationOnce(()=>{throw new Error('unsupported');});await tick();expect(link()).toBeNull();expect(files.size).toBe(0);expect(screen.getByText('无法准备本地 JSON，当前证据仍可在下表查看。')).toBeTruthy();
 });
});
