// @vitest-environment jsdom
import React from 'react';
import {Blob} from 'node:buffer';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,renderHook,screen,within} from '@testing-library/react';
import Polymarket from '../components/polymarket/Polymarket';
import {useSnapshot} from '../components/polymarket/useSnapshot';
import OrganizedEvidence,{POLYMARKET_INTEREST_PREVIEW_LIMIT} from '../components/evidence/OrganizedEvidence';
import {projectPolymarketInterestReport,type OrganizedPolymarketInterestReport} from '../lib/evidence/polymarket-interest-projection';
import {INTEREST_REFRESH_MS,INTEREST_MAX_CACHE_AGE_MS,REFRESH_MS,type PolymarketView} from '../lib/polymarket/model';
import {organizedInterest,interestReply,interestDiscovery,NOW,iso} from './organized-polymarket-interest-fixture';
import {gammaReply} from './organized-polymarket-fixture';
const files=new Map<string,Blob>();let sequence=0;
const create=vi.fn((blob:Blob)=>{const url=`blob:synthetic-polymarket-oi-${++sequence}`;files.set(url,blob);return url;});
const revoke=vi.fn((url:string)=>files.delete(url));
const summary='整理后的当前持仓证据 · USDC 原值与批次追溯';
const link=()=>screen.queryByRole('link',{name:'下载整理后的 JSON',hidden:true});
const tick=(ms=5)=>act(()=>vi.advanceTimersByTimeAsync(ms));
const exported=async()=>JSON.parse(await files.get(link()!.getAttribute('href')!)!.text()) as OrganizedPolymarketInterestReport;
const mode=(view:PolymarketView)=>fireEvent.click(screen.getByRole('button',{name:view==='hot'?'热门 · 24 小时成交量':view==='newest'?'较新 · 市场 ID':'金额 · 未平仓持仓'}));
function visibility(value:'visible'|'hidden',emit=true){Object.defineProperty(document,'visibilityState',{value,configurable:true});if(emit)fireEvent(document,new Event('visibilitychange'));}
function setup(kind:'legacy'|'batched'='batched'){
 const fetcher=vi.fn<typeof fetch>(async url=>Response.json(String(url).endsWith('interest')?interestReply(organizedInterest(kind,Date.now())):gammaReply(String(url).endsWith('newest')?'newest':'hot',Date.now())));vi.stubGlobal('fetch',fetcher);return fetcher;
}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(NOW);files.clear();create.mockClear();revoke.mockClear();vi.stubGlobal('Blob',Blob);vi.stubGlobal('URL',Object.assign(class extends URL {},{createObjectURL:create,revokeObjectURL:revoke}));visibility('visible',false);});
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();visibility('visible',false);});
async function start(){const result=render(<Polymarket/>);await tick();await tick();mode('interest');await tick(REFRESH_MS);await tick();return result;}
async function nextCheck(){await tick(INTEREST_REFRESH_MS);await tick();}

describe('Polymarket independent OI file and unchanged visible lifecycle',()=>{
 it('leaves the primary heatmap and amount details intact and exports all conditions independent of search, ticks and grouping provenance',async()=>{
  const fetcher=setup(),storage=vi.spyOn(Storage.prototype,'setItem');await start();const report=await exported(),original=link()!.getAttribute('href'),created=create.mock.calls.length;
  expect(report.source_id).toBe('polymarket-open-interest');expect(report.rows).toHaveLength(40);expect(report.native_snapshot.discovery.rows).toHaveLength(45);expect(report.rows.every(row=>row.metric_id==='polymarket-open-interest.priced_gross_open_interest')).toBe(true);expect(report.native_snapshot.values).toHaveLength(38);
  expect(link()!.getAttribute('download')).toBe(`polymarket-open-interest-${report.clocks.fetched_at.replace(/[:.]/g,'-')}-organized.json`);
  const panel=screen.getByText(summary),matrix=screen.getByRole('region',{name:'样本持仓金额矩阵'});expect(matrix.compareDocumentPosition(panel)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(panel.closest('details')!.open).toBe(false);fireEvent.click(panel);
  const table=within(screen.getByRole('table',{name:/当前持仓证据字段/}));expect(POLYMARKET_INTEREST_PREVIEW_LIMIT).toBe(120);expect(table.getAllByRole('row')).toHaveLength(41);expect(table.getByText('0')).toBeTruthy();expect(table.getByText('0.125')).toBeTruthy();expect(table.getAllByText('条件未返回 · null')).toHaveLength(2);expect(table.getAllByText('无返回值路径 · null')).toHaveLength(2);
  expect(screen.getByText(/原生 discovery 和候选市场记录中的价格、成交量只用于追溯选样/)).toBeTruthy();expect(screen.getByText(/实际选中 40 个，返回金额 38 个，未返回 2 个/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('搜索持仓金额样本'),{target:{value:'no matching synthetic market'}});await tick(20_000);expect(screen.getByText('暂无可核验的持仓金额')).toBeTruthy();expect(link()!.getAttribute('href')).toBe(original);expect((await exported()).rows).toEqual(report.rows);expect(create).toHaveBeenCalledTimes(created);expect(files.size).toBe(1);expect(fetcher).toHaveBeenCalledTimes(2);expect(storage).not.toHaveBeenCalled();
  expect(fetcher.mock.calls.every(([url,options])=>String(url).startsWith('/api/v1/polymarket/snapshot?view=')&&options?.credentials==='same-origin'&&options?.cache==='no-store'&&options?.redirect==='manual')).toBe(true);
 });
 it('withdraws OI immediately on mode changes and never projects its Gamma discovery as the selected hot/newest snapshot',async()=>{
  const fetcher=setup();await start();const report=await exported(),original=link()!.getAttribute('href');mode('hot');expect(screen.queryByText(summary)).toBeNull();expect(link()).toBeNull();expect(revoke).toHaveBeenCalledWith(original);await tick();
  const gamma=await exported();expect(gamma.source_id).toBe('polymarket-gamma');expect(gamma.native_snapshot.rows).toHaveLength(3);expect(gamma.native_snapshot).not.toHaveProperty('discovery');const hot=link()!.getAttribute('href');
  mode('interest');expect(link()).toBeNull();expect(revoke).toHaveBeenCalledWith(hot);await tick();expect((await exported()).native_snapshot).toEqual(report.native_snapshot);expect(files.size).toBe(1);expect(fetcher).toHaveBeenCalledTimes(2);
  mode('newest');expect(link()).toBeNull();expect(screen.queryByText(summary)).toBeNull();await tick(REFRESH_MS);await tick();expect((await exported()).source_id).toBe('polymarket-gamma');expect(fetcher).toHaveBeenCalledTimes(3);
 });
 it.each(['legacy','batched'] as const)('retains %s limits/clocks and blocks suspended stale/expired clicks at the existing boundary',async kind=>{
  const fetcher=setup(kind);await start();visibility('hidden');const before=await exported(),anchor=Date.parse(before.retention.age_anchor),original=link()!.getAttribute('href');
  expect(before.coverage.sample_limit).toBe(kind==='legacy'?20:40);expect(before.retention.native_locator).toBe(kind==='legacy'?'fetched_at':'oi_request_started_at');
  vi.setSystemTime(anchor+INTEREST_REFRESH_MS+1);expect(fireEvent.click(link()!)).toBe(false);expect(link()).toBeNull();expect(revoke).toHaveBeenCalledWith(original);await tick();const stale=await exported(),staleUrl=link()!.getAttribute('href');expect(stale.presentation.stale).toBe(true);expect(stale.clocks).toEqual(before.clocks);expect(stale.native_snapshot).toEqual(before.native_snapshot);
  vi.setSystemTime(anchor+INTEREST_MAX_CACHE_AGE_MS);let blocked:boolean|undefined;const inspect=(event:Event)=>{blocked=event.defaultPrevented;event.preventDefault();};document.addEventListener('click',inspect);fireEvent.click(link()!);document.removeEventListener('click',inspect);expect(blocked).toBe(false);
  vi.setSystemTime(anchor+INTEREST_MAX_CACHE_AGE_MS+1);expect(fireEvent.click(link()!)).toBe(false);expect(link()).toBeNull();expect(screen.queryByText(summary)).toBeNull();expect(revoke).toHaveBeenCalledWith(staleUrl);expect(files.size).toBe(0);expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it.each(['legacy','batched'] as const)('expires %s evidence while hidden without new polling or renewed acquisition',async kind=>{
  const fetcher=setup(kind);await start();const before=await exported();visibility('hidden');await tick(INTEREST_MAX_CACHE_AGE_MS+1000);expect(link()).toBeNull();expect(screen.queryByText(summary)).toBeNull();expect(screen.getByText('暂无可核验的持仓金额')).toBeTruthy();expect(files.size).toBe(0);expect(fetcher).toHaveBeenCalledTimes(2);expect(Date.parse(before.clocks.fetched_at)).toBeLessThan(Date.now());
 });
 it.each([401,403,407,451,302,'redirected','opaque','denied','source_busy','source_gate_unavailable','source_gate_outcome_unconfirmed','source_stale_lease','source_denied','invalid','private_extra','wrong_mode','unavailable'] as const)('withdraws OI preview and file after %s through the unchanged hook',async reason=>{
  const fetcher=setup();await start();const original=link()!.getAttribute('href');fetcher.mockImplementation(async()=>{
   if(typeof reason==='number')return new Response(null,{status:reason});
   const reply=interestReply(organizedInterest('batched',Date.now()));
   if(reason==='redirected'||reason==='opaque'){const response=Response.json(reply);Object.defineProperty(response,reason==='redirected'?'redirected':'type',{value:reason==='redirected'?true:'opaqueredirect'});return response;}
   if(reason==='invalid')return Response.json({bad:true});
   if(reason==='private_extra')return Response.json({...reply,snapshot:{...reply.snapshot,private_token:'synthetic'}});
   if(reason==='wrong_mode')return Response.json(gammaReply());
   if(reason==='unavailable')return Response.json({snapshot:null,status:{...reply.status,state:'unavailable'}});
   return Response.json({snapshot:null,status:{...reply.status,state:reason==='denied'?'denied':'unavailable',error_code:reason==='denied'?'source_denied':reason}},{status:503});
  });await nextCheck();expect(link()).toBeNull();expect(screen.queryByText(summary)).toBeNull();expect(revoke).toHaveBeenCalledWith(original);expect(files.size).toBe(0);expect(fetcher).toHaveBeenCalledTimes(3);
  if(typeof reason==='number'||['redirected','opaque','denied','source_denied'].includes(reason)){mode('hot');mode('interest');await tick(INTEREST_REFRESH_MS);expect(fetcher).toHaveBeenCalledTimes(3);expect(link()).toBeNull();}
 });
 it('keeps eligible OI after temporary network failure then revokes its stale file on successful replacement',async()=>{
  const fetcher=setup();await start();const before=await exported(),original=link()!.getAttribute('href');fetcher.mockRejectedValue(new Error('temporary'));await nextCheck();expect((await exported()).presentation.stale).toBe(true);expect((await exported()).native_snapshot).toEqual(before.native_snapshot);expect(revoke).toHaveBeenCalledWith(original);const stale=link()!.getAttribute('href');
  fetcher.mockImplementation(async()=>Response.json(interestReply(organizedInterest('batched',Date.now()))));await tick(REFRESH_MS);await tick();expect((await exported()).presentation.stale).toBe(false);expect((await exported()).clocks.fetched_at).not.toBe(before.clocks.fetched_at);expect(revoke).toHaveBeenCalledWith(stale);expect(files.size).toBe(1);expect(fetcher).toHaveBeenCalledTimes(4);
 });
 it('preserves legacy discovery even older than Gamma display lifetime without exporting it as current prices',async()=>{
  const discovery=interestDiscovery(45,NOW-900_000),fetcher=vi.fn<typeof fetch>(async url=>Response.json(String(url).endsWith('interest')?interestReply(organizedInterest('legacy',Date.now(),discovery)):gammaReply()));vi.stubGlobal('fetch',fetcher);await start();const report=await exported();expect(report.coverage.sample_limit).toBe(20);expect(report.native_snapshot.discovery).toEqual(discovery);expect(report.clocks.discovery_fetched_at).toBe(iso(NOW-907000));expect(report.retention.age_basis).toBe('legacy_response_received');expect(screen.getByText(/旧版单批最多 20 个条件，不升级为 40 个/)).toBeTruthy();expect(screen.getByText(/旧版单次请求，未补造 batches 字段/)).toBeTruthy();
 });
 it('rejects an OI response received after switching away as a current-mode export',async()=>{
  let finish!:(response:Response)=>void;const fetcher=vi.fn<typeof fetch>(async url=>String(url).endsWith('interest')?new Promise(resolve=>{finish=resolve;}):Response.json(gammaReply('hot',Date.now())));vi.stubGlobal('fetch',fetcher);const page=render(<Polymarket/>);await tick();await tick();mode('interest');await tick(REFRESH_MS);expect(link()).toBeNull();mode('hot');await tick();const hot=(await exported()).native_snapshot;await act(async()=>finish(Response.json(interestReply(organizedInterest('batched',Date.now())))));await tick();expect(screen.queryByText(summary)).toBeNull();expect((await exported()).source_id).toBe('polymarket-gamma');expect((await exported()).native_snapshot).toEqual(hot);expect(files.size).toBe(1);expect(fetcher).toHaveBeenCalledTimes(2);page.unmount();expect(files.size).toBe(0);
 });
 it('rejects old OI callbacks after mode change, replacement, permission loss and unmount',async()=>{
  const fetcher=setup();const {result,rerender,unmount}=renderHook(({view}:{view:PolymarketView})=>useSnapshot(view),{initialProps:{view:'interest' as PolymarketView}});await tick();const initial=result.current.snapshot!,guard=result.current.validateDownload;expect(guard(initial,false)).toBe(true);
  rerender({view:'hot'});await act(async()=>expect(guard(initial,false)).toBe(false));await tick(REFRESH_MS);rerender({view:'interest'});await tick();expect(guard(initial,false)).toBe(true);await nextCheck();const replacement=result.current.snapshot!;expect(replacement).not.toBe(initial);await act(async()=>expect(guard(initial,false)).toBe(false));expect(guard(replacement,false)).toBe(true);
  fetcher.mockImplementation(async()=>new Response(null,{status:403}));await nextCheck();await act(async()=>expect(guard(replacement,false)).toBe(false));unmount();expect(guard(replacement,false)).toBe(false);expect(vi.getTimerCount()).toBe(0);
 });
 it('does not export future/expired OI or fetch on an initially hidden page',async()=>{
  for(const at of [NOW+60_000,NOW-INTEREST_MAX_CACHE_AGE_MS]){
   const fetcher=vi.fn<typeof fetch>(async url=>Response.json(String(url).endsWith('interest')?interestReply(organizedInterest('batched',at)):gammaReply()));vi.stubGlobal('fetch',fetcher);const page=await start();expect(screen.queryByText(summary)).toBeNull();expect(link()).toBeNull();page.unmount();vi.setSystemTime(NOW);
  }
  const fetcher=setup();visibility('hidden',false);render(<Polymarket/>);mode('interest');await tick(INTEREST_REFRESH_MS);expect(link()).toBeNull();expect(fetcher).not.toHaveBeenCalled();expect(files.size).toBe(0);
 });
 it('cancels pending Blob work, revokes replacements/unmounts and leaves preview on local preparation failure without requests',async()=>{
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);const report=projectPolymarketInterestReport(organizedInterest())!,page=render(<OrganizedEvidence report={report}/>);await tick();const original=link()!.getAttribute('href');page.rerender(<OrganizedEvidence report={report}/>);await tick();expect(link()!.getAttribute('href')).toBe(original);expect(create).toHaveBeenCalledOnce();
  create.mockImplementationOnce(()=>{throw new Error('unsupported');});page.rerender(<OrganizedEvidence report={projectPolymarketInterestReport(organizedInterest('legacy'))}/>);expect(link()).toBeNull();expect(revoke).toHaveBeenCalledWith(original);await tick();expect(screen.getByText('无法准备本地 JSON，当前证据仍可在下表查看。')).toBeTruthy();fireEvent.click(screen.getByText(summary));expect(screen.getByRole('table',{name:/当前持仓证据字段/})).toBeTruthy();page.unmount();expect(files.size).toBe(0);
  create.mockClear();const pending=render(<OrganizedEvidence report={report}/>);pending.unmount();await tick();expect(create).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
 });
 it('revokes a live OI file and clears every timer when the page unmounts',async()=>{
  setup();const page=await start(),original=link()!.getAttribute('href');page.unmount();expect(revoke).toHaveBeenCalledWith(original);expect(files.size).toBe(0);expect(vi.getTimerCount()).toBe(0);
 });
});
