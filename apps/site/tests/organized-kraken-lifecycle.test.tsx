// @vitest-environment jsdom
import React from 'react';
import {Blob} from 'node:buffer';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,renderHook,screen,within} from '@testing-library/react';
import KrakenSpot from '../components/crypto/KrakenSpot';
import OrganizedEvidence,{KRAKEN_TRADE_PREVIEW_LIMIT} from '../components/evidence/OrganizedEvidence';
import {useKrakenEvidence} from '../components/crypto/useKrakenEvidence';
import {projectKrakenTradeReport,type OrganizedKrakenTradeReport} from '../lib/evidence/kraken-trade-projection';
import {MAX_CACHE_AGE_MS,REFRESH_MS} from '../lib/crypto/kraken';
import {at,iso,krakenTradeReply,legacyTrades,variedTrades} from './organized-kraken-fixture';
const files=new Map<string,Blob>();let sequence=0;
const create=vi.fn((blob:Blob)=>{const url=`blob:synthetic-kraken-${++sequence}`;files.set(url,blob);return url;});
const revoke=vi.fn((url:string)=>files.delete(url));
const link=()=>screen.queryByRole('link',{name:'下载整理后的 JSON',hidden:true});
const tick=(ms=5)=>act(()=>vi.advanceTimersByTimeAsync(ms));
const exported=async()=>JSON.parse(await files.get(link()!.getAttribute('href')!)!.text()) as OrganizedKrakenTradeReport;
function visibility(value:'visible'|'hidden',emit=true){Object.defineProperty(document,'visibilityState',{value,configurable:true});if(emit)fireEvent(document,new Event('visibilitychange'));}
beforeEach(()=>{
 vi.useFakeTimers();vi.setSystemTime(at);files.clear();create.mockClear();revoke.mockClear();
 vi.stubGlobal('Blob',Blob);vi.stubGlobal('URL',Object.assign(class extends URL {},{createObjectURL:create,revokeObjectURL:revoke}));visibility('visible',false);
});
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();visibility('visible',false);});
async function start(){const view=render(<KrakenSpot/>);await tick();await tick();return view;}
async function nextCheck(){fireEvent.click(screen.getByRole('button',{name:'检查更新'}));await tick();await tick();}
function selectAda(){fireEvent.click(screen.getByRole('button',{name:'清空待选'}));fireEvent.click(screen.getByRole('checkbox',{name:'ADA/USD'}));fireEvent.click(screen.getByRole('button',{name:'应用选择'}));}

describe('Kraken organized file and current trade-view lifecycle',()=>{
 it('keeps both heatmaps primary and one stable full Blob through clock ticks and unapplied search/drafts, without extra requests',async()=>{
  const response=krakenTradeReply();response.trade_snapshot=variedTrades();const storage=vi.spyOn(Storage.prototype,'setItem');
  const fetcher=vi.fn<typeof fetch>(async()=>Response.json(response));vi.stubGlobal('fetch',fetcher);await start();
  const report=await exported(),original=link()!.getAttribute('href');
  expect(report.native_snapshot).toEqual(response.trade_snapshot);expect(report.rows).toHaveLength(12);expect(original).toMatch(/^blob:/);expect(link()!.getAttribute('download')).toBe('kraken-trades-5m-2026-11-05T03-00-00-000Z-organized.json');
  const panel=screen.getByText('整理后的当前证据 · 统一字段与原值追溯'),matrix=screen.getByRole('region',{name:'来源买卖标记成交额差矩阵工作区'});
  expect(matrix.compareDocumentPosition(panel)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(panel.closest('details')!.open).toBe(false);fireEvent.click(panel);
  const table=screen.getByRole('table',{name:/当前证据字段/});expect(within(table).getByRole('columnheader',{name:'本行单位'})).toBeTruthy();
  expect(within(table).getAllByText('USD')).toHaveLength(9);expect(within(table).getAllByText('percent')).toHaveLength(3);
  expect(within(table).getByText('9007199254740993.000000000000000000000001')).toBeTruthy();expect(within(table).getAllByText('覆盖未知 · null')).toHaveLength(4);expect(within(table).getByText('无区间内成交 · 差比 null')).toBeTruthy();
  expect(screen.getByText(/即使主动方向已确认，也不等于净资本流入/)).toBeTruthy();
  fireEvent.change(screen.getByRole('searchbox'),{target:{value:'ADA'}});fireEvent.click(screen.getByRole('button',{name:'清空待选'}));fireEvent.click(screen.getByRole('checkbox',{name:'ADA/USD'}));await tick(20_000);
  expect(link()!.getAttribute('href')).toBe(original);expect((await exported()).rows).toEqual(report.rows);expect(create).toHaveBeenCalledOnce();expect(revoke).not.toHaveBeenCalled();expect(storage).not.toHaveBeenCalled();
  expect(fetcher).toHaveBeenCalledOnce();expect(fetcher.mock.calls[0]).toEqual(['/api/v1/crypto/kraken/snapshot',expect.objectContaining({credentials:'same-origin',cache:'no-store',signal:expect.any(AbortSignal)})]);
 });
 it('retains native schema-1 omission then replaces it with actual explicit schema-2 selection',async()=>{
  const response=krakenTradeReply();response.trade_snapshot=legacyTrades();
  const fetcher=vi.fn<typeof fetch>(async()=>Response.json(response));vi.stubGlobal('fetch',fetcher);await start();const original=link()!.getAttribute('href');
  expect((await exported()).native_snapshot).not.toHaveProperty('page_limit');expect((await exported()).coverage.selection_origin).toBe('schema_1_default_pairs');expect(screen.getByText(/schema-1 默认选择/)).toBeTruthy();
  fetcher.mockImplementation(async()=>Response.json(krakenTradeReply({selected:['ADA/USD']})));selectAda();expect(link()).toBeNull();expect(revoke).toHaveBeenCalledWith(original);await tick();await tick();
  const report=await exported();expect(report.native_schema).toBe('kraken-trades/2');expect(report.rows).toHaveLength(4);expect(report.coverage.selected_pairs).toEqual(['ADA/USD']);expect(files.size).toBe(1);
  expect(fetcher.mock.calls[1][0]).toBe('/api/v1/crypto/kraken/snapshot?pairs=ADA%2FUSD');
 });
 it('immediately removes prior-window files, preserves quotes and only accepts the new matching 1-minute scope',async()=>{
  const fetcher=vi.fn<typeof fetch>(async()=>Response.json(krakenTradeReply()));vi.stubGlobal('fetch',fetcher);await start();const original=link()!.getAttribute('href');
  let resolve!:(value:Response)=>void;fetcher.mockImplementation(()=>new Promise<Response>(done=>{resolve=done;}));fireEvent.click(screen.getByRole('radio',{name:'1 分钟'}));
  expect(link()).toBeNull();expect(revoke).toHaveBeenCalledWith(original);expect(screen.getByRole('img',{name:/ · BTC\/USD · /})).toBeTruthy();
  await act(async()=>resolve(Response.json(krakenTradeReply({timeframe:'1m'}))));await tick();
  const report=await exported();expect(report.period.window_ms).toBe(60000);expect(report.period.start).toBe(new Date(at-60000).toISOString());expect(fetcher.mock.calls[1][0]).toBe('/api/v1/crypto/kraken/snapshot?window=1m');expect(files.size).toBe(1);
 });
 it('cannot revive old-scope evidence when an in-flight reply arrives after Apply',async()=>{
  const fetcher=vi.fn<typeof fetch>(async()=>Response.json(krakenTradeReply()));vi.stubGlobal('fetch',fetcher);await start();const original=link()!.getAttribute('href');
  let resolve!:(value:Response)=>void;fetcher.mockImplementation(()=>new Promise<Response>(done=>{resolve=done;}));fireEvent.click(screen.getByRole('button',{name:'检查更新'}));selectAda();expect(link()).toBeNull();expect(revoke).toHaveBeenCalledWith(original);
  await act(async()=>resolve(Response.json(krakenTradeReply())));await tick();expect(link()).toBeNull();expect(files.size).toBe(0);expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it.each([401,403,302,'redirected','denied','invalid','private_extra','unavailable','wrong_window'] as const)('withdraws the preview and file after %s without adding acquisition paths',async reason=>{
  const fetcher=vi.fn<typeof fetch>(async()=>Response.json(krakenTradeReply()));vi.stubGlobal('fetch',fetcher);await start();const original=link()!.getAttribute('href');
  fetcher.mockImplementation(async()=>{
   if(typeof reason==='number')return new Response(null,{status:reason});
   if(reason==='redirected'){const value=Response.json(krakenTradeReply());Object.defineProperty(value,'redirected',{value:true});return value;}
   if(reason==='invalid')return Response.json({snapshot:{}});
   if(reason==='private_extra'){const reply=krakenTradeReply();return Response.json({...reply,trade_snapshot:{...reply.trade_snapshot,private_token:'synthetic'}});}
   if(reason==='wrong_window')return Response.json(krakenTradeReply({timeframe:'1m'}));
   return Response.json({snapshot:null,trade_snapshot:null,status:{...krakenTradeReply().status,state:reason,error_code:'source_denied'}},{status:503});
  });
  await nextCheck();expect(link()).toBeNull();expect(screen.queryByText('整理后的当前证据 · 统一字段与原值追溯')).toBeNull();expect(revoke).toHaveBeenCalledWith(original);expect(files.size).toBe(0);expect(fetcher).toHaveBeenCalledTimes(2);
  if(reason===401||reason===403||reason==='denied'){await tick(REFRESH_MS+1);expect(fetcher).toHaveBeenCalledTimes(2);}
 });
 it.each(['final','row'] as const)('checks current time on a suspended-tab click just past the inclusive 15-minute %s fetch bound',async clock=>{
  const response=krakenTradeReply({fetched:clock==='row'?at+2000:at});if(clock==='row')response.trade_snapshot!.rows[0].fetched_at=iso;
  vi.setSystemTime(clock==='row'?at+2000:at);const fetcher=vi.fn<typeof fetch>(async()=>Response.json(response));vi.stubGlobal('fetch',fetcher);await start();const original=link()!.getAttribute('href');
  vi.setSystemTime(at+MAX_CACHE_AGE_MS+1);expect(link()).not.toBeNull();expect(fireEvent.click(link()!)).toBe(false);expect(link()).toBeNull();expect(revoke).toHaveBeenCalledWith(original);expect(files.size).toBe(0);expect(fetcher).toHaveBeenCalledOnce();
 });
 it('refreshes the stale flag before a suspended-tab download while preserving all original fields and clocks',async()=>{
  const fetcher=vi.fn<typeof fetch>(async()=>Response.json(krakenTradeReply()));vi.stubGlobal('fetch',fetcher);await start();const before=await exported(),original=link()!.getAttribute('href');
  vi.setSystemTime(at+REFRESH_MS+1);expect(fireEvent.click(link()!)).toBe(false);expect(link()).toBeNull();expect(revoke).toHaveBeenCalledWith(original);await tick();
  const after=await exported();expect(after.presentation.stale).toBe(true);expect(after.clocks).toEqual(before.clocks);expect(after.native_snapshot).toEqual(before.native_snapshot);expect(fetcher).toHaveBeenCalledOnce();
 });
 it('uses hidden-tab expiry without polling, and accepts the exact age boundary with an already-stale current file',async()=>{
  const fetcher=vi.fn<typeof fetch>(async()=>Response.json(krakenTradeReply()));vi.stubGlobal('fetch',fetcher);await start();visibility('hidden');await tick(MAX_CACHE_AGE_MS-10_000);await tick();
  const original=link()!.getAttribute('href');expect((await exported()).presentation.stale).toBe(true);vi.setSystemTime(at+MAX_CACHE_AGE_MS);
  // Prevent jsdom navigation after recording whether the React guard allowed it.
  const event=new MouseEvent('click',{bubbles:true,cancelable:true});let blocked:boolean|undefined;
  const check=(e:Event)=>{blocked=e.defaultPrevented;e.preventDefault();};document.addEventListener('click',check);fireEvent(link()!,event);document.removeEventListener('click',check);expect(blocked).toBe(false);
  vi.setSystemTime(at+MAX_CACHE_AGE_MS+1);expect(fireEvent.click(link()!)).toBe(false);expect(link()).toBeNull();expect(revoke).toHaveBeenCalledWith(original);expect(fetcher).toHaveBeenCalledOnce();
 });
 it('retains the exact eligible snapshot across a temporary outage, then revokes its file on successful replacement',async()=>{
  const fetcher=vi.fn<typeof fetch>(async()=>Response.json(krakenTradeReply()));vi.stubGlobal('fetch',fetcher);await start();const before=await exported(),original=link()!.getAttribute('href');
  fetcher.mockRejectedValue(new Error('offline'));await nextCheck();const stale=await exported();expect(stale.presentation.stale).toBe(true);expect(stale.native_snapshot).toEqual(before.native_snapshot);expect(stale.clocks).toEqual(before.clocks);expect(revoke).toHaveBeenCalledWith(original);
  const staleUrl=link()!.getAttribute('href');vi.setSystemTime(at+1000);fetcher.mockImplementation(async()=>Response.json(krakenTradeReply({end:at+1000})));await nextCheck();expect((await exported()).presentation.stale).toBe(false);expect((await exported()).clocks.fetched_at).toBe(new Date(at+1000).toISOString());expect(revoke).toHaveBeenCalledWith(staleUrl);expect(files.size).toBe(1);
 });
 it('offers no file for future, quote-only, or initially hidden state',async()=>{
  const fetcher=vi.fn<typeof fetch>(async()=>Response.json(krakenTradeReply({end:at+60000})));vi.stubGlobal('fetch',fetcher);let view=await start();expect(link()).toBeNull();view.unmount();
  fetcher.mockImplementation(async()=>Response.json({...krakenTradeReply(),trade_snapshot:null}));view=await start();expect(link()).toBeNull();view.unmount();
  fetcher.mockClear();visibility('hidden',false);await start();expect(link()).toBeNull();expect(fetcher).not.toHaveBeenCalled();expect(create).not.toHaveBeenCalled();
 });
 it('shows only a missing-pair record when the selected catalog pair has no retained metadata',async()=>{
  const fetcher=vi.fn<typeof fetch>(async()=>Response.json(krakenTradeReply({missing:['SOL/USD']})));vi.stubGlobal('fetch',fetcher);await start();
  const report=await exported();expect(report.rows).toHaveLength(8);expect(report.coverage.missing_pairs).toEqual(['SOL/USD']);expect(screen.getByText(/只保留缺失名称，不补造交易对元数据或零值/)).toBeTruthy();
 });
 it('bounds preview at 120 without widening the three-pair native schema, exports all fields and handles Blob replacement/failure/unmount',async()=>{
  const report=projectKrakenTradeReport(variedTrades())!;expect(report.rows.length).toBeLessThan(KRAKEN_TRADE_PREVIEW_LIMIT);
  const view=render(<OrganizedEvidence report={report}/>);await tick();fireEvent.click(screen.getByText('整理后的当前证据 · 统一字段与原值追溯'));
  expect(screen.getAllByRole('row')).toHaveLength(Math.min(report.rows.length,KRAKEN_TRADE_PREVIEW_LIMIT)+1);expect((await exported()).rows).toHaveLength(12);const original=link()!.getAttribute('href');
  create.mockImplementationOnce(()=>{throw new Error('unsupported');});view.rerender(<OrganizedEvidence report={projectKrakenTradeReport(legacyTrades())}/>);expect(link()).toBeNull();expect(revoke).toHaveBeenCalledWith(original);await tick();expect(screen.getByText('无法准备本地 JSON，当前证据仍可在下表查看。')).toBeTruthy();expect(files.size).toBe(0);view.unmount();
  create.mockClear();const pending=render(<OrganizedEvidence report={report}/>);pending.unmount();await tick();expect(create).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
 });
 it('revokes active files and every timer on page unmount',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json(krakenTradeReply())));const view=await start(),original=link()!.getAttribute('href');view.unmount();expect(revoke).toHaveBeenCalledWith(original);expect(files.size).toBe(0);expect(vi.getTimerCount()).toBe(0);
 });
 it('rejects retained old click callbacks after replacement, selection, blocked permission or unmount',async()=>{
  const fetcher=vi.fn<typeof fetch>(async()=>Response.json(krakenTradeReply()));vi.stubGlobal('fetch',fetcher);
  const {result,unmount}=renderHook(()=>useKrakenEvidence());await tick();const initial=result.current.tradeSnapshot!,oldValidator=result.current.validateTradeDownload;
  expect(oldValidator(initial,false)).toBe(true);
  fetcher.mockImplementation(async()=>Response.json(krakenTradeReply({end:at+1000})));vi.setSystemTime(at+1000);await act(async()=>{await result.current.refresh();});await act(async()=>{expect(oldValidator(initial,false)).toBe(false);});
  const replacement=result.current.tradeSnapshot!;await act(async()=>{result.current.applyScope(['ADA/USD'],'5m');});await act(async()=>{expect(oldValidator(replacement,false)).toBe(false);});
  fetcher.mockImplementation(async()=>new Response(null,{status:403}));await act(async()=>{await result.current.refresh();});await act(async()=>{expect(oldValidator(initial,false)).toBe(false);});
  unmount();expect(oldValidator(initial,false)).toBe(false);
 });
});
