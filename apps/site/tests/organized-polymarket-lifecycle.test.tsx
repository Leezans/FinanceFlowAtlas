// @vitest-environment jsdom
import React from 'react';
import {Blob} from 'node:buffer';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,renderHook,screen,within} from '@testing-library/react';
import Polymarket from '../components/polymarket/Polymarket';
import {useSnapshot} from '../components/polymarket/useSnapshot';
import OrganizedEvidence,{POLYMARKET_PREVIEW_LIMIT} from '../components/evidence/OrganizedEvidence';
import {projectPolymarketReport,type OrganizedPolymarketReport} from '../lib/evidence/polymarket-projection';
import {parseOpenInterest} from '../lib/polymarket/interest';
import {hotSnapshotSchema,MAX_CACHE_AGE_MS,REFRESH_MS,type PolymarketReply,type PolymarketView} from '../lib/polymarket/model';
import {gammaReply,legacyGamma,largeGamma,NOW,ISO} from './organized-polymarket-fixture';
const files=new Map<string,Blob>();let sequence=0;
const create=vi.fn((blob:Blob)=>{const url=`blob:synthetic-polymarket-${++sequence}`;files.set(url,blob);return url;});
const revoke=vi.fn((url:string)=>files.delete(url));
const link=()=>screen.queryByRole('link',{name:'下载整理后的 JSON',hidden:true});
const tick=(ms=5)=>act(()=>vi.advanceTimersByTimeAsync(ms));
const exported=async()=>JSON.parse(await files.get(link()!.getAttribute('href')!)!.text()) as OrganizedPolymarketReport;
function visibility(value:'visible'|'hidden',emit=true){Object.defineProperty(document,'visibilityState',{value,configurable:true});if(emit)fireEvent(document,new Event('visibilitychange'));}
const mode=(view:PolymarketView)=>fireEvent.click(screen.getByRole('button',{name:view==='hot'?'热门 · 24 小时成交量':view==='newest'?'较新 · 市场 ID':'金额 · 未平仓持仓'}));
beforeEach(()=>{
 vi.useFakeTimers();vi.setSystemTime(NOW);files.clear();create.mockClear();revoke.mockClear();
 vi.stubGlobal('Blob',Blob);vi.stubGlobal('URL',Object.assign(class extends URL {},{createObjectURL:create,revokeObjectURL:revoke}));visibility('visible',false);
});
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();visibility('visible',false);});
async function start(){const view=render(<Polymarket/>);await tick();await tick();return view;}
async function nextCheck(){await tick(REFRESH_MS);await tick();}

 describe('Polymarket organized file and existing current-mode lifecycle',()=>{
 it('keeps the heatmap primary and a stable complete file through clock ticks, search, group drilldown and metric changes without new requests or storage',async()=>{
  const response=gammaReply(),storage=vi.spyOn(Storage.prototype,'setItem'),fetcher=vi.fn<typeof fetch>(async()=>Response.json(response));vi.stubGlobal('fetch',fetcher);await start();
  const original=link()!.getAttribute('href'),report=await exported();expect(report.native_snapshot).toEqual(response.snapshot);expect(report.rows).toHaveLength(9);expect(link()!.getAttribute('download')).toBe('polymarket-gamma-hot-2026-11-05T12-00-00-000Z-organized.json');
  const panel=screen.getByText('整理后的当前证据 · 统一字段与原值追溯'),matrix=screen.getByRole('region',{name:'市场问题矩阵'});expect(matrix.compareDocumentPosition(panel)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(panel.closest('details')!.open).toBe(false);fireEvent.click(panel);
  const table=screen.getByRole('table',{name:/当前证据字段/});expect(within(table).getByText('0.123456789012')).toBeTruthy();expect(within(table).getByText('1.000000000000')).toBeTruthy();expect(within(table).getAllByText('来源保留 null')).toHaveLength(3);expect(within(table).getAllByText('source_reported')).toHaveLength(3);expect(within(table).getAllByText('probability_fraction')).toHaveLength(6);
  fireEvent.click(screen.getByRole('button',{name:'按分组浏览'}));fireEvent.click(screen.getByRole('button',{name:/Science · 来源分类/}));fireEvent.change(screen.getByLabelText('市场指标'),{target:{value:'volume'}});fireEvent.change(screen.getByLabelText('搜索市场'),{target:{value:'no matching synthetic query'}});await tick(20_000);
  expect(screen.getByText('矩阵暂无可核验数据')).toBeTruthy();expect(link()!.getAttribute('href')).toBe(original);expect((await exported()).rows).toEqual(report.rows);expect(create).toHaveBeenCalledOnce();expect(revoke).not.toHaveBeenCalled();expect(storage).not.toHaveBeenCalled();expect(fetcher).toHaveBeenCalledOnce();expect(fetcher.mock.calls[0]).toEqual(['/api/v1/polymarket/snapshot?view=hot',expect.objectContaining({credentials:'same-origin',cache:'no-store',redirect:'manual',signal:expect.any(AbortSignal)})]);
 });
 it('withdraws old mode evidence immediately, preserves per-mode controls, and exports only the current cached Gamma mode',async()=>{
  const fetcher=vi.fn<typeof fetch>(async url=>Response.json(gammaReply(String(url).endsWith('newest')?'newest':'hot',Date.now())));vi.stubGlobal('fetch',fetcher);await start();const original=link()!.getAttribute('href');
  fireEvent.change(screen.getByLabelText('搜索市场'),{target:{value:'Science'}});mode('newest');expect(link()).toBeNull();expect(revoke).toHaveBeenCalledWith(original);expect(fetcher).toHaveBeenCalledOnce();expect(files.size).toBe(0);await nextCheck();
  expect((await exported()).coverage.view).toBe('newest');expect((await exported()).native_schema).toBe('polymarket-gamma/2');expect(fetcher).toHaveBeenCalledTimes(2);const newest=link()!.getAttribute('href');
  mode('hot');expect(link()).toBeNull();expect(revoke).toHaveBeenCalledWith(newest);await tick();expect((await exported()).coverage.view).toBe('hot');expect((screen.getByLabelText('搜索市场') as HTMLInputElement).value).toBe('Science');expect(fetcher).toHaveBeenCalledTimes(2);expect(files.size).toBe(1);
 });
 it('does not export the separate OI view or its Gamma discovery cohort',async()=>{
  const discovery=hotSnapshotSchema.parse(gammaReply().snapshot),interest=parseOpenInterest({data:[{condition_id:discovery.rows[0].condition_id!,value:0}]},discovery,ISO,ISO);
  const oiReply:PolymarketReply={snapshot:interest,status:{...gammaReply().status,refresh_ms:300000,max_cache_age_ms:600000}};
  const fetcher=vi.fn<typeof fetch>(async url=>Response.json(String(url).endsWith('interest')?oiReply:gammaReply()));vi.stubGlobal('fetch',fetcher);await start();const original=link()!.getAttribute('href');mode('interest');expect(link()).toBeNull();expect(revoke).toHaveBeenCalledWith(original);await nextCheck();expect(link()).toBeNull();expect(screen.queryByText('整理后的当前证据 · 统一字段与原值追溯')).toBeNull();expect(screen.getByText(/全站 OI 排名/)).toBeTruthy();expect(fetcher).toHaveBeenCalledTimes(2);expect(files.size).toBe(0);
 });
 it('cannot publish a previous-mode pending body into the selected mode or create its export',async()=>{
  let finish!:(response:Response)=>void;const fetcher=vi.fn<typeof fetch>().mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockImplementation(async()=>Response.json(gammaReply('newest',Date.now())));vi.stubGlobal('fetch',fetcher);await start();mode('newest');await act(async()=>finish(Response.json(gammaReply())));await tick();expect(link()).toBeNull();expect(create).not.toHaveBeenCalled();await nextCheck();expect((await exported()).coverage.view).toBe('newest');expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it.each([401,403,407,451,302,'redirected','opaque','denied','source_busy','source_gate_unavailable','source_gate_outcome_unconfirmed','source_stale_lease','source_denied','invalid','private_extra','wrong_mode','unavailable'] as const)('revokes the preview and file after %s through the existing single request path',async reason=>{
  const fetcher=vi.fn<typeof fetch>(async()=>Response.json(gammaReply()));vi.stubGlobal('fetch',fetcher);await start();const original=link()!.getAttribute('href');
  fetcher.mockImplementation(async()=>{
   if(typeof reason==='number')return new Response(null,{status:reason});
   if(reason==='redirected'||reason==='opaque'){const response=Response.json(gammaReply());Object.defineProperty(response,reason==='redirected'?'redirected':'type',{value:reason==='redirected'?true:'opaqueredirect'});return response;}
   if(reason==='invalid')return Response.json({bad:true});
   if(reason==='private_extra')return Response.json({...gammaReply(),snapshot:{...gammaReply().snapshot,private_token:'synthetic'}});
   if(reason==='wrong_mode')return Response.json(gammaReply('newest'));
   if(reason==='unavailable')return Response.json({snapshot:null,status:{...gammaReply().status,state:'unavailable'}});
   return Response.json({snapshot:null,status:{...gammaReply().status,state:reason==='denied'?'denied':'unavailable',error_code:reason==='denied'?'source_denied':reason}},{status:503});
  });
  await nextCheck();expect(link()).toBeNull();expect(screen.queryByText('整理后的当前证据 · 统一字段与原值追溯')).toBeNull();expect(revoke).toHaveBeenCalledWith(original);expect(files.size).toBe(0);expect(fetcher).toHaveBeenCalledTimes(2);
  if(typeof reason==='number'||['redirected','opaque','denied','source_denied'].includes(reason)){mode('newest');mode('hot');await tick(REFRESH_MS*2);expect(fetcher).toHaveBeenCalledTimes(2);expect(link()).toBeNull();}
 });
 it('guards a suspended-tab download at the original inclusive five-minute bound and revokes it without a request',async()=>{
  const fetcher=vi.fn<typeof fetch>(async()=>Response.json(gammaReply()));vi.stubGlobal('fetch',fetcher);await start();visibility('hidden');await tick(REFRESH_MS+1001);await tick();const original=link()!.getAttribute('href');expect((await exported()).presentation.stale).toBe(true);
  vi.setSystemTime(NOW+MAX_CACHE_AGE_MS);const event=new MouseEvent('click',{bubbles:true,cancelable:true});let blocked:boolean|undefined;const check=(e:Event)=>{blocked=e.defaultPrevented;e.preventDefault();};document.addEventListener('click',check);fireEvent(link()!,event);document.removeEventListener('click',check);expect(blocked).toBe(false);
  vi.setSystemTime(NOW+MAX_CACHE_AGE_MS+1);expect(link()).not.toBeNull();expect(fireEvent.click(link()!)).toBe(false);expect(link()).toBeNull();expect(revoke).toHaveBeenCalledWith(original);expect(files.size).toBe(0);expect(fetcher).toHaveBeenCalledOnce();
 });
 it('refreshes a stale label before a suspended-tab download without changing native fields or clocks',async()=>{
  const fetcher=vi.fn<typeof fetch>(async()=>Response.json(gammaReply()));vi.stubGlobal('fetch',fetcher);await start();const before=await exported(),original=link()!.getAttribute('href');vi.setSystemTime(NOW+REFRESH_MS+1);expect(fireEvent.click(link()!)).toBe(false);expect(link()).toBeNull();expect(revoke).toHaveBeenCalledWith(original);await tick();const after=await exported();expect(after.presentation.stale).toBe(true);expect(after.native_snapshot).toEqual(before.native_snapshot);expect(after.clocks).toEqual(before.clocks);expect(fetcher).toHaveBeenCalledOnce();
 });
 it('expires naturally while hidden, without polling or changing source gates',async()=>{
  const fetcher=vi.fn<typeof fetch>(async()=>Response.json(gammaReply()));vi.stubGlobal('fetch',fetcher);await start();visibility('hidden');await tick(MAX_CACHE_AGE_MS+1000);expect(link()).toBeNull();expect(files.size).toBe(0);expect(fetcher).toHaveBeenCalledOnce();
 });
 it('retains an eligible native snapshot on a temporary failure and revokes its stale file on replacement',async()=>{
  const fetcher=vi.fn<typeof fetch>(async()=>Response.json(gammaReply()));vi.stubGlobal('fetch',fetcher);await start();const before=await exported(),original=link()!.getAttribute('href');fetcher.mockRejectedValue(new Error('temporary'));await nextCheck();expect((await exported()).presentation.stale).toBe(true);expect((await exported()).native_snapshot).toEqual(before.native_snapshot);expect(revoke).toHaveBeenCalledWith(original);const stale=link()!.getAttribute('href');
  fetcher.mockImplementation(async()=>Response.json(gammaReply('hot',Date.now())));await nextCheck();expect((await exported()).presentation.stale).toBe(false);expect((await exported()).clocks.fetched_at).not.toBe(ISO);expect(revoke).toHaveBeenCalledWith(stale);expect(files.size).toBe(1);expect(fetcher).toHaveBeenCalledTimes(3);
 });
 it('preserves the exact legacy snapshot and its absent condition/paging fields in the newest mode',async()=>{
  const legacy={...gammaReply('newest'),snapshot:legacyGamma()},fetcher=vi.fn<typeof fetch>(async url=>Response.json(String(url).endsWith('newest')?legacy:gammaReply()));vi.stubGlobal('fetch',fetcher);await start();mode('newest');await nextCheck();const report=await exported();expect(report.native_schema).toBe('polymarket-gamma/1');expect(report.native_snapshot).not.toHaveProperty('pagination');expect(report.native_snapshot.rows[0]).not.toHaveProperty('condition_id');expect(screen.getByText(/旧版未保留分页、游标及分组规则字段/)).toBeTruthy();
 });
 it('has no export for future or initially hidden snapshots',async()=>{
  const fetcher=vi.fn<typeof fetch>(async()=>Response.json(gammaReply('hot',NOW+60000)));vi.stubGlobal('fetch',fetcher);const view=await start();expect(link()).toBeNull();view.unmount();fetcher.mockClear();visibility('hidden',false);await start();expect(link()).toBeNull();expect(create).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();
 });
 it('previews 120 fields and exports all 180, replaces and revokes Blob URLs, and handles unavailable Blob creation and pending unmount',async()=>{
  const report=projectPolymarketReport(largeGamma(60,2))!,fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);const view=render(<OrganizedEvidence report={report}/>);await tick();fireEvent.click(screen.getByText('整理后的当前证据 · 统一字段与原值追溯'));expect(screen.getAllByRole('row')).toHaveLength(POLYMARKET_PREVIEW_LIMIT+1);expect((await exported()).rows).toHaveLength(180);expect((await exported()).native_snapshot.rows).toHaveLength(60);const original=link()!.getAttribute('href');
  view.rerender(<OrganizedEvidence report={report}/>);await tick();expect(link()!.getAttribute('href')).toBe(original);expect(create).toHaveBeenCalledOnce();
  create.mockImplementationOnce(()=>{throw new Error('unsupported');});view.rerender(<OrganizedEvidence report={projectPolymarketReport(legacyGamma())}/>);expect(link()).toBeNull();expect(revoke).toHaveBeenCalledWith(original);await tick();expect(screen.getByText('无法准备本地 JSON，当前证据仍可在下表查看。')).toBeTruthy();expect(files.size).toBe(0);view.unmount();
  create.mockClear();const pending=render(<OrganizedEvidence report={report}/>);pending.unmount();await tick();expect(create).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
 });
 it('rejects retained old click callbacks after mode change, replacement, permission loss and unmount',async()=>{
  const fetcher=vi.fn<typeof fetch>(async url=>Response.json(gammaReply(String(url).endsWith('newest')?'newest':'hot',Date.now())));vi.stubGlobal('fetch',fetcher);
  const {result,rerender,unmount}=renderHook(({view}:{view:PolymarketView})=>useSnapshot(view),{initialProps:{view:'hot' as PolymarketView}});await tick();const initial=result.current.snapshot!,oldValidator=result.current.validateDownload;expect(oldValidator(initial,false)).toBe(true);
  rerender({view:'newest'});await act(async()=>expect(oldValidator(initial,false)).toBe(false));await nextCheck();const replacement=result.current.snapshot!;await act(async()=>expect(oldValidator(initial,false)).toBe(false));expect(oldValidator(replacement,false)).toBe(true);
  fetcher.mockImplementation(async()=>new Response(null,{status:403}));await nextCheck();await act(async()=>expect(oldValidator(replacement,false)).toBe(false));unmount();expect(oldValidator(replacement,false)).toBe(false);expect(vi.getTimerCount()).toBe(0);
 });
 it('revokes active files and all timers on page unmount',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json(gammaReply())));const view=await start(),original=link()!.getAttribute('href');view.unmount();expect(revoke).toHaveBeenCalledWith(original);expect(files.size).toBe(0);expect(vi.getTimerCount()).toBe(0);
 });
});
