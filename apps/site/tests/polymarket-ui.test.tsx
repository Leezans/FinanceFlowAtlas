// @vitest-environment jsdom
import React from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import Polymarket from '../components/polymarket/Polymarket';
import {MAX_CACHE_AGE_MS,keysetSnapshotSchema,legacySnapshotSchema,type PolymarketReply} from '../lib/polymarket/model';
const at=Date.parse('2026-11-05T03:00:00Z'),iso=new Date(at).toISOString();
const question='Will this deliberately long and complete prediction market question be displayed without truncation?';
function reply():PolymarketReply{return {snapshot:{schema:'polymarket-gamma/hot/1',source:'Polymarket Gamma',coverage:'bounded_active_market_sample',sample_limit:100,source_market_count:2,excluded_market_count:0,ordering:'source_volume24hr_descending',complete_universe:false,total_market_count:null,pagination:'single_page',source_page_count:1,source_page_sizes:[2],stop_reason:'source_short_page',has_more:null,grouping:'source_category_else_smallest_tag_slug',acquisition_started_at:iso,fetched_at:iso,source_observed_at:null,net_capital_flow:null,rows:[{id:'2',question,category:'Science',category_basis:'source_category',tags:[],outcomes:[{name:'No',price:'0.75'},{name:'Yes',price:'0.25'}],volume_24h:0,volume_unit:'source_reported',source_record_updated_at:iso,source_observed_at:null,accepting_orders:null},{id:'1',question:'Other market',category:'Science',category_basis:'source_category',tags:[],outcomes:[{name:'Alpha',price:null},{name:'Beta',price:'0.1'}],volume_24h:null,volume_unit:'source_reported',source_record_updated_at:null,source_observed_at:null,accepting_orders:null}]},status:{state:'available',error_code:null,last_attempt_at:iso,fetched_at:iso,cache_age_ms:0,refresh_ms:30_000,max_cache_age_ms:300_000,next_retry_at:null}};}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(at);Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});});
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();});
async function start(){const result=render(<Polymarket/>);await act(()=>vi.advanceTimersByTimeAsync(1));return result;}
function drill(){fireEvent.click(screen.getByRole('button',{name:'按分组浏览'}));fireEvent.click(screen.getByRole('button',{name:/Science · 来源分类 · 2 个市场/}));}
function market(){return screen.queryByRole('img',{name:new RegExp(question.replace('?','\\?'))});}
describe('Polymarket view and refresh trust boundary',()=>{
 it('drills into full labels, shows named outcomes, zeros and missing metrics; preserves controls across polling',async()=>{
  const fetcher=vi.fn(async()=>Response.json(reply()));vi.stubGlobal('fetch',fetcher);await start();drill();expect(market()).toBeTruthy();expect(screen.getByText('25%')).toBeTruthy();expect(screen.getByText('结果：Yes · 价格隐含概率')).toBeTruthy();expect(screen.getByText('来源未提供')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('搜索市场'),{target:{value:'deliberately'}});fireEvent.change(screen.getByLabelText('市场指标'),{target:{value:'volume'}});expect(screen.getByText('0 · 来源单位')).toBeTruthy();
  await act(()=>vi.advanceTimersByTimeAsync(30_000));expect(fetcher).toHaveBeenCalledTimes(2);expect((screen.getByLabelText('搜索市场') as HTMLInputElement).value).toBe('deliberately');expect((screen.getByLabelText('市场指标') as unknown as HTMLSelectElement).value).toBe('volume');expect(market()).toBeTruthy();expect(screen.getByText('市场问题矩阵')).toBeTruthy();
  expect((fetcher.mock.calls as unknown as [string,RequestInit][])[0][0]).toBe('/api/v1/polymarket/snapshot?view=hot');expect(screen.getByText(/价格观测时间：接口未提供/)).toBeTruthy();expect(screen.getByText(/来源记录更新时间：/)).toBeTruthy();
 });
 it('retains a separately labeled v1 sample through transient failure and expires it normally',async()=>{
  const base=reply(),raw:Record<string,unknown>={...base.snapshot,schema:'polymarket-gamma/1',sample_limit:200,ordering:'source_volume24hr_descending'};for(const key of ['total_market_count','pagination','source_page_count','source_page_sizes','stop_reason','has_more','grouping'])delete raw[key];const legacy:PolymarketReply={...base,snapshot:legacySnapshotSchema.parse(raw)},fetcher=vi.fn(async()=>Response.json(legacy));vi.stubGlobal('fetch',fetcher);await start();fireEvent.click(screen.getByRole('button',{name:'较新 · 市场 ID'}));await act(()=>vi.advanceTimersByTimeAsync(30_000));expect(screen.getByText(/当前显示上一版单页样本：按来源 24 小时成交量排序，最多 200 个市场/)).toBeTruthy();expect(screen.queryByText(/本次读取/)).toBeNull();drill();expect(market()).toBeTruthy();fetcher.mockImplementation(async()=>Response.json({...legacy,status:{...legacy.status,state:'stale',error_code:'upstream_http',cache_age_ms:30_000}}));await act(()=>vi.advanceTimersByTimeAsync(30_000));expect(market()).toBeTruthy();expect(screen.getByText('上次有效快照 · 已陈旧')).toBeTruthy();expect(screen.getByText(/上一版样本的展示分组使用来源分类，否则使用来源首个标签/)).toBeTruthy();Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});fireEvent(document,new Event('visibilitychange'));await act(()=>vi.advanceTimersByTimeAsync(MAX_CACHE_AGE_MS+1));expect(market()).toBeNull();
 });
 it.each([401,403])('clears and permanently stops after HTTP %s',async status=>{
  const fetcher=vi.fn(async()=>Response.json(reply()));vi.stubGlobal('fetch',fetcher);await start();drill();fetcher.mockImplementation(async()=>new Response('Denied',{status}));fireEvent.click(screen.getByRole('button',{name:'检查更新'}));await act(()=>vi.advanceTimersByTimeAsync(30_000));expect(market()).toBeNull();expect(screen.getByText('展示权限已失效')).toBeTruthy();await act(()=>vi.advanceTimersByTimeAsync(60_000));fireEvent(document,new Event('visibilitychange'));expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('clears and stops after structured source denial',async()=>{const fetcher=vi.fn(async()=>Response.json(reply()));vi.stubGlobal('fetch',fetcher);await start();drill();fetcher.mockImplementation(async()=>Response.json({snapshot:null,status:{...reply().status,state:'denied',error_code:'source_denied'}},{status:503}));fireEvent.click(screen.getByRole('button',{name:'检查更新'}));await act(()=>vi.advanceTimersByTimeAsync(30_000));expect(market()).toBeNull();expect(screen.getByText('来源访问已停止')).toBeTruthy();await act(()=>vi.advanceTimersByTimeAsync(60_000));expect(fetcher).toHaveBeenCalledTimes(2);});
 it('clears on invalid 200, then recovers without losing the drilldown',async()=>{const fetcher=vi.fn(async()=>Response.json(reply()));vi.stubGlobal('fetch',fetcher);await start();drill();fetcher.mockImplementation(async()=>Response.json({bad:true}));fireEvent.click(screen.getByRole('button',{name:'检查更新'}));await act(()=>vi.advanceTimersByTimeAsync(30_000));expect(market()).toBeNull();expect(screen.getByText('响应数据未通过校验，已清空当前模式数据。')).toBeTruthy();fetcher.mockImplementation(async()=>Response.json(reply()));fireEvent.click(screen.getByRole('button',{name:'检查更新'}));await act(()=>vi.advanceTimersByTimeAsync(30_000));expect(market()).toBeTruthy();});
 it.each(['html','structured'])('retains age-valid stale evidence on temporary %s failure, expires while hidden',async kind=>{const fetcher=vi.fn(async()=>Response.json(reply()));vi.stubGlobal('fetch',fetcher);await start();drill();fetcher.mockImplementation(async()=>kind==='html'?new Response('gateway',{status:502}):Response.json({snapshot:null,status:{...reply().status,state:'unavailable'}},{status:503}));fireEvent.click(screen.getByRole('button',{name:'检查更新'}));await act(()=>vi.advanceTimersByTimeAsync(30_000));expect(market()).toBeTruthy();expect(screen.getByText('上次有效快照 · 已陈旧')).toBeTruthy();Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});fireEvent(document,new Event('visibilitychange'));await act(()=>vi.advanceTimersByTimeAsync(MAX_CACHE_AGE_MS+1000));expect(market()).toBeNull();expect(fetcher).toHaveBeenCalledTimes(2);});
 it.each(['source_busy','source_gate_unavailable','source_gate_outcome_unconfirmed','source_stale_lease','source_denied'])('clears warm evidence on %s and never retains rows under uncertain access',async error_code=>{
  const fetcher=vi.fn(async()=>Response.json(reply()));vi.stubGlobal('fetch',fetcher);await start();drill();expect(market()).toBeTruthy();
  fetcher.mockImplementation(async()=>Response.json({snapshot:null,status:{...reply().status,state:'unavailable',error_code}},{status:503}));await act(()=>vi.advanceTimersByTimeAsync(30_000));expect(market()).toBeNull();
  if(error_code==='source_denied'){expect(screen.getByText('来源访问已停止')).toBeTruthy();await act(()=>vi.advanceTimersByTimeAsync(60_000));expect(fetcher).toHaveBeenCalledTimes(2);}
  else expect(screen.getByText('来源访问状态尚未确认，暂不展示数据。')).toBeTruthy();
 });
 it('keeps a minimum 30-second gap across manual clicks and hide/show toggles',async()=>{
  const fetcher=vi.fn(async()=>Response.json(reply()));vi.stubGlobal('fetch',fetcher);await start();
  for(let i=0;i<3;i++){fireEvent.click(screen.getByRole('button',{name:'检查更新'}));Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});fireEvent(document,new Event('visibilitychange'));Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});fireEvent(document,new Event('visibilitychange'));}
  expect(fetcher).toHaveBeenCalledTimes(1);await act(()=>vi.advanceTimersByTimeAsync(29_998));expect(fetcher).toHaveBeenCalledTimes(1);await act(()=>vi.advanceTimersByTimeAsync(1));expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('honors a later next_retry_at from the server',async()=>{
  const value=reply();value.status.next_retry_at=new Date(at+90_000).toISOString();const fetcher=vi.fn(async()=>Response.json(value));vi.stubGlobal('fetch',fetcher);await start();await act(()=>vi.advanceTimersByTimeAsync(60_000));fireEvent(document,new Event('visibilitychange'));fireEvent.click(screen.getByRole('button',{name:'检查更新'}));expect(fetcher).toHaveBeenCalledTimes(1);await act(()=>vi.advanceTimersByTimeAsync(30_000));expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('does not start hidden, prevents simultaneous requests, and aborts on unmount',async()=>{
  Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});const fetcher=vi.fn(()=>new Promise<Response>(()=>{}));vi.stubGlobal('fetch',fetcher);const result=await start();expect(fetcher).not.toHaveBeenCalled();Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});fireEvent(document,new Event('visibilitychange'));fireEvent(document,new Event('visibilitychange'));fireEvent.click(screen.getByRole('button',{name:'正在检查…'}));expect(fetcher).toHaveBeenCalledTimes(1);const init=(fetcher.mock.calls as unknown as [string,RequestInit][])[0][1];result.unmount();expect(init.signal?.aborted).toBe(true);
 });
});
function newestReply():PolymarketReply{
 const base=reply();return {...base,snapshot:keysetSnapshotSchema.parse({...base.snapshot!,schema:'polymarket-gamma/2',sample_limit:500,ordering:'source_id_descending',pagination:'keyset',stop_reason:'source_exhausted',has_more:false,rows:base.snapshot!.rows.map(row=>({...row,question:`Newest: ${row.question}`}))})};
}
const switchMode=(mode:'hot'|'newest')=>fireEvent.click(screen.getByRole('button',{name:mode==='hot'?'热门 · 24 小时成交量':'较新 · 市场 ID'}));
describe('independent discovery modes',()=>{
 it('starts with market questions and reports field availability without a drilldown',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json(reply())));await start();expect(market()).toBeTruthy();expect(screen.getByText(/指定结果价格可用 1 个、缺失 1 个/)).toBeTruthy();expect(screen.getByText(/24 小时成交量缺失 1 个、零 1 个、正值 0 个/)).toBeTruthy();expect(screen.getByText(/后续范围未知/)).toBeTruthy();
 });
 it('requests only the active mode, shares cooldown, restores each mode controls and does not relabel cached rows',async()=>{
  const fetcher=vi.fn(async(url:string)=>Response.json(url.endsWith('hot')?reply():newestReply()));vi.stubGlobal('fetch',fetcher);await start();
  fireEvent.change(screen.getByLabelText('搜索市场'),{target:{value:'deliberately'}});switchMode('newest');expect(market()).toBeNull();expect(fetcher).toHaveBeenCalledTimes(1);expect((screen.getByLabelText('搜索市场') as HTMLInputElement).value).toBe('');expect(screen.getByText('等待共享来源冷却')).toBeTruthy();expect(screen.getByText(/等待共享来源冷却结束/)).toBeTruthy();expect(screen.queryByText('暂无可验证数据')).toBeNull();
  await act(()=>vi.advanceTimersByTimeAsync(30_000));expect(fetcher).toHaveBeenLastCalledWith('/api/v1/polymarket/snapshot?view=newest',expect.any(Object));expect(screen.getByText(/ID 仅是新旧代理/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('搜索市场'),{target:{value:'Other'}});switchMode('hot');expect(market()).toBeTruthy();expect((screen.getByLabelText('搜索市场') as HTMLInputElement).value).toBe('deliberately');expect(fetcher).toHaveBeenCalledTimes(2);switchMode('newest');expect((screen.getByLabelText('搜索市场') as HTMLInputElement).value).toBe('Other');
 });
 it('never publishes a previous mode response after switching during an in-flight request',async()=>{
  let resolve!:(response:Response)=>void;const fetcher=vi.fn(()=>new Promise<Response>(done=>{resolve=done;}));vi.stubGlobal('fetch',fetcher);await start();switchMode('newest');await act(async()=>resolve(Response.json(reply())));expect(market()).toBeNull();expect(screen.queryByText('25%')).toBeNull();await act(()=>vi.advanceTimersByTimeAsync(30_000));expect(fetcher).toHaveBeenCalledTimes(2);expect(fetcher).toHaveBeenLastCalledWith('/api/v1/polymarket/snapshot?view=newest',expect.any(Object));
 });
 it('rejects newest evidence in the hot response',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json(newestReply())));await start();expect(screen.getByText('响应数据未通过校验，已清空当前模式数据。')).toBeTruthy();expect(screen.queryByText('25%')).toBeNull();
 });
 it.each(['source_gate_unavailable','source_denied'])('clears both warm modes on %s and blocks denial across switches',async(error_code)=>{
  const fetcher=vi.fn(async(url:string)=>Response.json(url.endsWith('hot')?reply():newestReply()));vi.stubGlobal('fetch',fetcher);await start();switchMode('newest');await act(()=>vi.advanceTimersByTimeAsync(30_000));expect(screen.getByText('25%')).toBeTruthy();
  fetcher.mockImplementation(async()=>Response.json({snapshot:null,status:{...reply().status,state:error_code==='source_denied'?'denied':'unavailable',error_code}},{status:503}));await act(()=>vi.advanceTimersByTimeAsync(30_000));switchMode('hot');expect(screen.queryByText('25%')).toBeNull();switchMode('newest');expect(screen.queryByText('25%')).toBeNull();if(error_code==='source_denied'){await act(()=>vi.advanceTimersByTimeAsync(90_000));expect(fetcher).toHaveBeenCalledTimes(3);}
 });
 it('labels a shared source cooldown as waiting rather than a network failure',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({snapshot:null,status:{...reply().status,state:'unavailable',error_code:'source_cooldown',next_retry_at:new Date(at+60_000).toISOString()}},{status:503})));await start();expect(screen.getByText(/等待共享来源冷却结束/)).toBeTruthy();expect(screen.queryByText(/本次检查失败/)).toBeNull();
 });
 it('honors server retry and cache expiry even across mode switches',async()=>{
  const value=reply();value.status.next_retry_at=new Date(at+90_000).toISOString();const fetcher=vi.fn(async()=>Response.json(value));vi.stubGlobal('fetch',fetcher);await start();switchMode('newest');await act(()=>vi.advanceTimersByTimeAsync(60_000));switchMode('hot');expect(fetcher).toHaveBeenCalledTimes(1);expect(market()).toBeTruthy();
  Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});fireEvent(document,new Event('visibilitychange'));await act(()=>vi.advanceTimersByTimeAsync(MAX_CACHE_AGE_MS));switchMode('newest');switchMode('hot');expect(market()).toBeNull();expect(fetcher).toHaveBeenCalledTimes(1);
 });
});
