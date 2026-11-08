// @vitest-environment jsdom
import React from 'react';
import {Blob} from 'node:buffer';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import TpexInstitutional from '../components/tpex/TpexInstitutional';
import OrganizedEvidence,{TPEX_SHARE_PREVIEW_LIMIT} from '../components/evidence/OrganizedEvidence';
import {projectTpexShareReport,type OrganizedTpexShareReport} from '../lib/evidence/tpex-share-projection';
import {DAY_MS,MAX_CACHE_AGE_MS,MAX_REPORT_AGE_DAYS,REFRESH_MS} from '../lib/tpex/model';
import {NOW} from './tpex-fixture';
import {tpexShareReply,tpexShareSnapshot} from './organized-tpex-fixture';
const files=new Map<string,Blob>();
let sequence=0;
const create=vi.fn((blob:Blob)=>{const url=`blob:synthetic-${++sequence}`;files.set(url,blob);return url;});
const revoke=vi.fn((url:string)=>files.delete(url));
const link=()=>screen.queryByRole('link',{name:'下载整理后的 JSON',hidden:true});
const tick=(ms=5)=>act(()=>vi.advanceTimersByTimeAsync(ms));
const exported=async()=>JSON.parse(await files.get(link()!.getAttribute('href')!)!.text()) as OrganizedTpexShareReport;
beforeEach(()=>{
 vi.useFakeTimers();vi.setSystemTime(NOW);files.clear();create.mockClear();revoke.mockClear();
 vi.stubGlobal('Blob',Blob);vi.stubGlobal('URL',Object.assign(class extends URL {},{createObjectURL:create,revokeObjectURL:revoke}));
 Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});
});
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});});
async function start(){const view=render(<TpexInstitutional/>);await tick();await tick();return view;}

describe('TPEx share integration and local download lifecycle',()=>{
 it('exports all companies and participants below the matrix without requests or filter-dependent Blob recreation',async()=>{
  const fetcher=vi.fn(async()=>Response.json(tpexShareReply()));vi.stubGlobal('fetch',fetcher);await start();
  const data=await exported(),original=link()!.getAttribute('href');
  expect(data.rows).toHaveLength(48);expect(data.native_snapshot).toEqual(tpexShareSnapshot());
  expect(link()!.getAttribute('download')).toBe('tpex-shares-2026-11-04-organized.json');expect(original).toMatch(/^blob:/);
  const heading=screen.getByRole('heading',{name:'上柜法人行业矩阵'}),panel=screen.getByText('整理后的当前证据 · 统一字段与原值追溯');
  expect(heading.compareDocumentPosition(panel)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(panel);const table=screen.getByRole('table');
  expect(within(table).getByRole('columnheader',{name:'官方行业'})).toBeTruthy();
  expect(within(table).getByRole('columnheader',{name:'法人类别'})).toBeTruthy();
  expect(within(table).getAllByText('法人记录缺失 · null')).toHaveLength(12);
  expect(within(table).getAllByText('法人合计（重叠）')).toHaveLength(12);
  expect(within(table).getAllByText('原适配器加总')).toHaveLength(6);
  expect(within(table).queryByText(/金额/)).toBeNull();expect(screen.getByText(/股数不是金额/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'自营商'}));fireEvent.change(screen.getByRole('combobox'),{target:{value:'24'}});
  fireEvent.click(screen.getByRole('button',{name:/测试1001.*-10 股/}));await tick(30_000);
  expect(link()!.getAttribute('href')).toBe(original);expect(create).toHaveBeenCalledOnce();expect(revoke).not.toHaveBeenCalled();
  expect((await exported()).rows).toEqual(data.rows);expect(fetcher).toHaveBeenCalledOnce();
 });
 it.each([401,403,302,'denied','invalid'] as const)('withdraws and revokes the local file after %s',async reason=>{
  const fetcher=vi.fn(async()=>Response.json(tpexShareReply()));vi.stubGlobal('fetch',fetcher);await start();const original=link()!.getAttribute('href');
  fetcher.mockImplementation(async()=>typeof reason==='number'?new Response(null,{status:reason}):reason==='invalid'?Response.json({snapshot:{}}):Response.json({snapshot:null,status:{...tpexShareReply().status,state:'denied',error_code:'source_denied'}},{status:503}));
  await tick(REFRESH_MS);await tick();
  expect(link()).toBeNull();expect(screen.queryByText('整理后的当前证据 · 统一字段与原值追溯')).toBeNull();
  expect(revoke).toHaveBeenCalledWith(original);expect(files.size).toBe(0);expect(fetcher).toHaveBeenCalledTimes(2);
  if(reason!=='invalid'){await tick(2*REFRESH_MS);expect(fetcher).toHaveBeenCalledTimes(2);}
 });
 it('withdraws expired evidence in hidden tabs using the existing matrix clock',async()=>{
  const fetcher=vi.fn(async()=>Response.json(tpexShareReply()));vi.stubGlobal('fetch',fetcher);await start();
  Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});await tick(MAX_CACHE_AGE_MS+30_001);
  expect(link()).toBeNull();expect(files.size).toBe(0);expect(screen.queryByRole('group',{name:'上柜法人行业矩阵区块'})).toBeNull();expect(fetcher).toHaveBeenCalledOnce();
 });
 it.each(['cache','report'] as const)('blocks a suspended-tab click at the exact %s age limit plus one without waiting for the timer',async limit=>{
  const result=tpexShareReply();let boundary=NOW+MAX_CACHE_AGE_MS;
  if(limit==='report'){
   boundary=Date.parse(result.snapshot.report_date)-8*3_600_000+MAX_REPORT_AGE_DAYS*DAY_MS;
   vi.setSystemTime(boundary-10_000);const fetched=new Date(boundary-10_000).toISOString();
   result.snapshot.fetched_at=fetched;result.snapshot.acquisition_started_at=fetched;result.status.fetched_at=fetched;
  }
  const fetcher=vi.fn(async()=>Response.json(result));vi.stubGlobal('fetch',fetcher);await start();
  const original=link()!.getAttribute('href');vi.setSystemTime(boundary+1);
  expect(link()).not.toBeNull();expect(fireEvent.click(link()!)).toBe(false);
  expect(link()).toBeNull();expect(revoke).toHaveBeenCalledWith(original);expect(files.size).toBe(0);expect(fetcher).toHaveBeenCalledOnce();
 });
 it('keeps original native clocks through a temporary failure and revokes replaced files',async()=>{
  const fetcher=vi.fn(async()=>Response.json(tpexShareReply()));vi.stubGlobal('fetch',fetcher);await start();
  const original=link()!.getAttribute('href'),before=await exported();
  fetcher.mockRejectedValue(new Error('offline'));await tick(REFRESH_MS);await tick();await tick();
  const retained=await exported();expect(retained.presentation.stale).toBe(true);expect(retained.native_snapshot).toEqual(before.native_snapshot);expect(retained.clocks).toEqual(before.clocks);
  expect(revoke).toHaveBeenCalledWith(original);const stale=link()!.getAttribute('href');
  const next=tpexShareReply(),fetched=new Date(Date.now()).toISOString();next.snapshot.fetched_at=fetched;next.snapshot.acquisition_started_at=fetched;next.status.fetched_at=fetched;
  fetcher.mockImplementation(async()=>Response.json(next));await tick(60_000);await tick();await tick();
  expect((await exported()).clocks.fetched_at).toBe(fetched);expect((await exported()).presentation.stale).toBe(false);expect(revoke).toHaveBeenCalledWith(stale);expect(files.size).toBe(1);expect(fetcher).toHaveBeenCalledTimes(3);
 });
 it('has no evidence export for a source unavailable from the first response',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({snapshot:null,status:{...tpexShareReply().status,state:'unavailable'}},{status:503})));
  await start();expect(link()).toBeNull();expect(create).not.toHaveBeenCalled();
 });
 it('revokes the active URL and cancels local preparation on unmount',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json(tpexShareReply())));const view=await start();const original=link()!.getAttribute('href');
  view.unmount();expect(revoke).toHaveBeenCalledWith(original);expect(files.size).toBe(0);expect(vi.getTimerCount()).toBe(0);
  create.mockClear();const pending=render(<OrganizedEvidence report={projectTpexShareReport(tpexShareSnapshot())}/>);pending.unmount();await tick();
  expect(create).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
 });
});
describe('bounded preview and complete local JSON',()=>{
 it('renders at most 120 rows while retaining every row in the downloadable file',async()=>{
  const input=tpexShareSnapshot();input.rows=Array.from({length:15},(_,i)=>({...input.rows[i%4],code:String(2000+i)}));input.excluded_security_count=0;input.source_security_count=input.rows.filter(row=>row.flow!==null).length;
  const report=projectTpexShareReport(input)!;render(<OrganizedEvidence report={report}/>);await tick();
  fireEvent.click(screen.getByText('整理后的当前证据 · 统一字段与原值追溯'));
  expect(screen.getAllByRole('row')).toHaveLength(TPEX_SHARE_PREVIEW_LIMIT+1);expect(screen.getByText(/180 条（预览前 120 条，JSON 包含全部/)).toBeTruthy();
  expect((await exported()).rows).toHaveLength(180);expect((await exported()).native_snapshot.rows).toHaveLength(15);
 });
 it('does not expose a previous URL during replacement preparation and fails honestly if Blob creation fails',async()=>{
  const report=projectTpexShareReport(tpexShareSnapshot())!,view=render(<OrganizedEvidence report={report}/>);await tick();const old=link()!.getAttribute('href');
  const replacement=projectTpexShareReport(tpexShareSnapshot(),true)!;view.rerender(<OrganizedEvidence report={replacement}/>);
  expect(link()).toBeNull();expect(revoke).toHaveBeenCalledWith(old);
  create.mockImplementationOnce(()=>{throw new Error('not_supported');});await tick();
  expect(link()).toBeNull();expect(screen.getByText('无法准备本地 JSON，当前证据仍可在下表查看。')).toBeTruthy();expect(files.size).toBe(0);
 });
});
