// @vitest-environment jsdom
import React from 'react';
import {Blob} from 'node:buffer';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import DeribitOptions from '../components/options/DeribitOptions';
import OrganizedEvidence,{DERIBIT_PREVIEW_LIMIT} from '../components/evidence/OrganizedEvidence';
import type {OrganizedDeribitReport} from '../lib/evidence/deribit-projection';
import {MAX_CACHE_AGE_MS,REFRESH_MS} from '../lib/options/model';
import {at,iso,combinedOptionsReply,optionsReply} from './deribit-fixture';
import {expiringOptionsReply,legacyOptionsReply,organizedOptions} from './organized-deribit-fixture';
const files=new Map<string,Blob>();let sequence=0;
const create=vi.fn((blob:Blob)=>{const url=`blob:synthetic-deribit-${++sequence}`;files.set(url,blob);return url;});
const revoke=vi.fn((url:string)=>files.delete(url));
const link=()=>screen.queryByRole('link',{name:'下载整理后的 JSON',hidden:true});
const tick=(ms=5)=>act(()=>vi.advanceTimersByTimeAsync(ms));
const exported=async()=>JSON.parse(await files.get(link()!.getAttribute('href')!)!.text()) as OrganizedDeribitReport;
function visibility(value:'visible'|'hidden',emit=true){Object.defineProperty(document,'visibilityState',{value,configurable:true});if(emit)fireEvent(document,new Event('visibilitychange'));}
beforeEach(()=>{
 vi.useFakeTimers();vi.setSystemTime(at);files.clear();create.mockClear();revoke.mockClear();
 vi.stubGlobal('Blob',Blob);vi.stubGlobal('URL',Object.assign(class extends URL {},{createObjectURL:create,revokeObjectURL:revoke}));visibility('visible',false);
});
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();visibility('visible',false);});
async function start(){const view=render(<DeribitOptions/>);await tick();await tick();return view;}
async function nextCheck(){fireEvent.click(screen.getByRole('button',{name:'检查更新'}));await tick();await tick();}

describe('Deribit current-view file and lifecycle',()=>{
 it('keeps the matrix primary, distinct row units and a complete filter-independent stable Blob',async()=>{
  const response=combinedOptionsReply();Object.assign(response.snapshot!.rows[0],{bid_price:null,ask_price:0,last:null});
  const fetcher=vi.fn(async()=>Response.json(response));vi.stubGlobal('fetch',fetcher);await start();
  const report=await exported(),original=link()!.getAttribute('href');
  expect(report.rows).toHaveLength(42);expect(report.native_snapshot.rows).toEqual(response.snapshot!.rows);
  expect(link()!.getAttribute('download')).toBe('deribit-options-BTC-ETH-source-2026-11-06T03-00-00-000Z-organized.json');expect(original).toMatch(/^blob:/);
  const matrix=screen.getByRole('region',{name:'期权矩阵工作区'}),panel=screen.getByText('整理后的当前证据 · 统一字段与原值追溯');
  expect(matrix.compareDocumentPosition(panel)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(panel.closest('details')!.open).toBe(false);fireEvent.click(panel);
  const table=screen.getByRole('table');expect(within(table).getByRole('columnheader',{name:'本行单位'})).toBeTruthy();expect(within(table).queryByRole('columnheader',{name:'原值 / per_row'})).toBeNull();
  expect(within(table).getAllByText('BTC / BTC')).toHaveLength(12);expect(within(table).getAllByText('ETH / ETH')).toHaveLength(12);expect(within(table).getAllByText('来源空值 · null')).toHaveLength(2);
  expect(screen.getByText(/交易场所，不推断 BTC \/ ETH 所属国家/)).toBeTruthy();expect(screen.getByText(/volume_usd 是来源24小时成交额/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('期权标的'),{target:{value:'ETH'}});fireEvent.change(screen.getByLabelText('查找期权合约'),{target:{value:'3500'}});fireEvent.change(screen.getByLabelText('期权类型'),{target:{value:'call'}});await tick(30_000);
  expect(link()!.getAttribute('href')).toBe(original);expect(create).toHaveBeenCalledOnce();expect(revoke).not.toHaveBeenCalled();expect((await exported()).rows).toEqual(report.rows);expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0]).toEqual(['/api/v1/options/deribit/snapshot',expect.objectContaining({credentials:'same-origin',cache:'no-store',redirect:'manual'})]);
 });
 it('records actual legacy wire normalization, then replaces it with actual schema-2 coverage',async()=>{
  const fetcher=vi.fn(async()=>Response.json(legacyOptionsReply()));vi.stubGlobal('fetch',fetcher);await start();const original=link()!.getAttribute('href');
  const report=await exported();expect(report.rows).toHaveLength(21);expect(report.normalization).toMatchObject({input_schema:'deribit-btc-options/1',legacy_btc_normalized:true});expect(report.clocks.source_as_of).toBe(new Date(at-1000).toISOString());
  expect(report.coverage.source_currencies).toEqual(['BTC']);expect(report.clocks.metadata_fetched_at).toEqual({BTC:iso});
  fetcher.mockImplementation(async()=>Response.json(combinedOptionsReply()));await nextCheck();
  expect((await exported()).rows).toHaveLength(42);expect((await exported()).normalization).toMatchObject({input_schema:'deribit-options/2',legacy_btc_normalized:false});expect(revoke).toHaveBeenCalledWith(original);expect(files.size).toBe(1);expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it.each([401,403,302,'opaque','redirected','denied','invalid','private_extra','unavailable'] as const)('withdraws preview and file after %s without new acquisition paths',async reason=>{
  const fetcher=vi.fn(async()=>Response.json(combinedOptionsReply()));vi.stubGlobal('fetch',fetcher);await start();const original=link()!.getAttribute('href');
  fetcher.mockImplementation(async()=>{
   if(typeof reason==='number')return new Response(null,{status:reason});
   if(reason==='opaque'){const value=new Response(null);Object.defineProperties(value,{type:{value:'opaqueredirect'},status:{value:0}});return value;}
   if(reason==='redirected'){const value=Response.json(combinedOptionsReply());Object.defineProperty(value,'redirected',{value:true});return value;}
   if(reason==='invalid')return Response.json({snapshot:{}});
   if(reason==='private_extra')return Response.json({...combinedOptionsReply(),snapshot:{...combinedOptionsReply().snapshot,private_token:'synthetic'}});
   return Response.json({snapshot:null,status:{...combinedOptionsReply().status,state:reason==='unavailable'?'unavailable':'denied',error_code:'source_denied'}},{status:503});
  });
  await nextCheck();expect(link()).toBeNull();expect(screen.queryByText('整理后的当前证据 · 统一字段与原值追溯')).toBeNull();expect(revoke).toHaveBeenCalledWith(original);expect(files.size).toBe(0);expect(fetcher).toHaveBeenCalledTimes(2);
  if(reason!=='invalid'&&reason!=='private_extra'&&reason!=='unavailable'){await tick(REFRESH_MS+1);expect(fetcher).toHaveBeenCalledTimes(2);}
 });
 it.each(['cache','source'] as const)('rejects a suspended-tab click just past the inclusive five-minute %s bound',async limit=>{
  const response=combinedOptionsReply();let boundary=at+MAX_CACHE_AGE_MS;
  if(limit==='source'){response.snapshot!.source_as_of=new Date(at-30000).toISOString();response.snapshot!.rows.forEach(row=>{row.creation_timestamp=at-30000;});boundary-=30000;}
  const fetcher=vi.fn(async()=>Response.json(response));vi.stubGlobal('fetch',fetcher);await start();const original=link()!.getAttribute('href');
  vi.setSystemTime(boundary+1);expect(link()).not.toBeNull();expect(fireEvent.click(link()!)).toBe(false);expect(link()).toBeNull();expect(revoke).toHaveBeenCalledWith(original);expect(files.size).toBe(0);expect(fetcher).toHaveBeenCalledOnce();
 });
 it.each(['single','currency'] as const)('cancels late download and rebuilds only active rows when %s expires, preserving original clocks and scope',async scope=>{
  const response=scope==='currency'?expiringOptionsReply():combinedOptionsReply();
  if(scope==='single'){response.snapshot!.rows[0].expiration_timestamp=at+2000;response.snapshot!.rows.slice(1).forEach(row=>{row.creation_timestamp=at+1000;});}
  const fetcher=vi.fn(async()=>Response.json(response));vi.stubGlobal('fetch',fetcher);await start();const original=link()!.getAttribute('href');
  vi.setSystemTime(at+2000);expect(fireEvent.click(link()!)).toBe(false);expect(link()).toBeNull();expect(revoke).toHaveBeenCalledWith(original);await tick();
  const report=await exported();expect(report.native_snapshot.rows).toHaveLength(scope==='currency'?3:5);expect(report.coverage.source_instrument_count).toBe(6);expect(report.coverage.source_currencies).toEqual(['BTC','ETH']);expect(report.clocks.source_as_of).toBe(iso);
  expect(report.coverage.visible_currencies).toEqual(scope==='currency'?['ETH']:['BTC','ETH']);expect(report.native_snapshot.rows.every(row=>row.expiration_timestamp>at+2000)).toBe(true);expect(report.native_snapshot.rows.every(row=>row.creation_timestamp===at+1000)).toBe(true);
  expect(files.size).toBe(1);expect(fetcher).toHaveBeenCalledOnce();
 });
 it('updates the source-stale flag before a suspended-tab download without renewing any clock',async()=>{
  const fetcher=vi.fn(async()=>Response.json(combinedOptionsReply()));vi.stubGlobal('fetch',fetcher);await start();const before=await exported(),original=link()!.getAttribute('href');
  vi.setSystemTime(at+REFRESH_MS+1);expect(fireEvent.click(link()!)).toBe(false);expect(link()).toBeNull();expect(revoke).toHaveBeenCalledWith(original);await tick();
  const after=await exported();expect(after.presentation.stale).toBe(true);expect(after.clocks).toEqual(before.clocks);expect(after.rows).toEqual(before.rows);expect(fetcher).toHaveBeenCalledOnce();
 });
 it('rebuilds at individual expiry while hidden, then withdraws the entire matrix/export at cache expiry',async()=>{
  const fetcher=vi.fn(async()=>Response.json(expiringOptionsReply()));vi.stubGlobal('fetch',fetcher);await start();const original=link()!.getAttribute('href');visibility('hidden');await tick(2100);await tick();
  expect((await exported()).coverage.visible_currencies).toEqual(['ETH']);expect(revoke).toHaveBeenCalledWith(original);expect(files.size).toBe(1);
  await tick(MAX_CACHE_AGE_MS);expect(link()).toBeNull();expect(files.size).toBe(0);expect(document.querySelector('g[data-id="ETH-27NOV26-3000-C"]')).toBeNull();expect(fetcher).toHaveBeenCalledOnce();
 });
 it('retains native fields and clocks across a temporary outage, marks stale and revokes on replacement',async()=>{
  const fetcher=vi.fn(async()=>Response.json(combinedOptionsReply()));vi.stubGlobal('fetch',fetcher);await start();const before=await exported(),original=link()!.getAttribute('href');
  fetcher.mockRejectedValue(new Error('offline'));await nextCheck();const retained=await exported();
  expect(retained.presentation.stale).toBe(true);expect(retained.native_snapshot).toEqual(before.native_snapshot);expect(retained.clocks).toEqual(before.clocks);expect(retained.rows).toEqual(before.rows);expect(revoke).toHaveBeenCalledWith(original);
  const stale=link()!.getAttribute('href'),replacement=combinedOptionsReply(),fetched=new Date(at+1000).toISOString();vi.setSystemTime(at+1000);replacement.snapshot!.acquisition_started_at=replacement.snapshot!.fetched_at=replacement.status.fetched_at=fetched;
  fetcher.mockResolvedValue(Response.json(replacement));await nextCheck();expect((await exported()).clocks.fetched_at).toBe(fetched);expect((await exported()).presentation.stale).toBe(false);expect(revoke).toHaveBeenCalledWith(stale);expect(files.size).toBe(1);
 });
 it('offers no file for a future snapshot or an initial hidden tab',async()=>{
  const future=combinedOptionsReply();future.snapshot!.fetched_at=future.status.fetched_at=new Date(at+60000).toISOString();
  const fetcher=vi.fn(async()=>Response.json(future));vi.stubGlobal('fetch',fetcher);const view=await start();expect(link()).toBeNull();expect(create).not.toHaveBeenCalled();view.unmount();
  fetcher.mockClear();visibility('hidden',false);await start();expect(fetcher).not.toHaveBeenCalled();expect(link()).toBeNull();
 });
 it('bounds DOM preview at 120 while keeping all selected fields and cancels pending preparation on unmount',async()=>{
  const response=optionsReply(),row=response.snapshot!.rows[0];response.snapshot!.rows=Array.from({length:30},(_,index)=>({...row,instrument:`BTC-27NOV26-${index+1}-C`,strike:index+1}));
  const view=render(<OrganizedEvidence report={organizedOptions(response)}/>);await tick();fireEvent.click(screen.getByText('整理后的当前证据 · 统一字段与原值追溯'));
  expect(screen.getAllByRole('row')).toHaveLength(DERIBIT_PREVIEW_LIMIT+1);expect(screen.getByText(/210 条（预览前 120 条，JSON 包含全部当前可见合约/)).toBeTruthy();expect((await exported()).rows).toHaveLength(210);
  const original=link()!.getAttribute('href');view.unmount();expect(revoke).toHaveBeenCalledWith(original);expect(files.size).toBe(0);
  create.mockClear();const pending=render(<OrganizedEvidence report={organizedOptions()}/>);pending.unmount();await tick();expect(create).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
 });
 it('never serves the preceding Blob while replacement prepares, and reports local preparation failure',async()=>{
  const view=render(<OrganizedEvidence report={organizedOptions()}/>);await tick();const original=link()!.getAttribute('href');
  view.rerender(<OrganizedEvidence report={organizedOptions(combinedOptionsReply(),at,true)}/>);expect(link()).toBeNull();expect(revoke).toHaveBeenCalledWith(original);
  create.mockImplementationOnce(()=>{throw new Error('unsupported');});await tick();expect(link()).toBeNull();expect(files.size).toBe(0);expect(screen.getByText('无法准备本地 JSON，当前证据仍可在下表查看。')).toBeTruthy();
 });
 it('revokes the real file and all lifecycle timers on page unmount',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json(combinedOptionsReply())));const view=await start(),original=link()!.getAttribute('href');view.unmount();expect(revoke).toHaveBeenCalledWith(original);expect(files.size).toBe(0);expect(vi.getTimerCount()).toBe(0);
 });
});
