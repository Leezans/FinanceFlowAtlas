// @vitest-environment jsdom
import React from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import Polymarket from '../components/polymarket/Polymarket';
import OpenInterest from '../components/polymarket/OpenInterest';
import {parseHotPolymarket} from '../lib/polymarket/adapter';
import {parseOpenInterest} from '../lib/polymarket/interest';
import {batchedInterestSnapshotSchema,snapshotCacheTime,type PolymarketInterestSnapshot,type PolymarketReply} from '../lib/polymarket/model';
import {market,NOW,ISO} from './polymarket-fixture';
const id=(n:number)=>`0x${String(n).padStart(64,'0')}`;
const discovery=()=>parseHotPolymarket([market('4',{conditionId:id(4),question:'Synthetic large open interest?',volume24hr:40}),market('3',{conditionId:id(3),question:'Synthetic small open interest?',volume24hr:30}),market('2',{conditionId:id(2),question:'Synthetic zero open interest?',volume24hr:20}),market('1',{conditionId:id(1),question:'Synthetic missing open interest?',volume24hr:10})],ISO,ISO);
const oi=()=>parseOpenInterest({data:[{condition_id:id(3),value:10},{condition_id:id(4),value:90},{condition_id:id(2),value:0}]},discovery(),ISO,ISO);
const iso=(at:number)=>new Date(at).toISOString();
function largeDiscovery(count=45,fetched=NOW){
 return parseHotPolymarket(Array.from({length:count},(_,index)=>market(String(count-index),{conditionId:id(count-index),question:`Synthetic OI condition ${count-index}?`,volume24hr:count-index})),iso(fetched-8_000),iso(fetched-7_000));
}
function batchedOi(count=45,fetched=NOW){
 const hot=largeDiscovery(count,fetched),rows=hot.rows.slice(0,40);
 const values=rows.flatMap((row,index)=>index===9||index===29?[]:[{condition_id:row.condition_id!,value:index===19?0:index+1}]);
 const batches=Array.from({length:Math.ceil(rows.length/20)},(_,index)=>{
  const condition_ids=rows.slice(index*20,(index+1)*20).map(row=>row.condition_id!);
  return {condition_ids,returned_condition_ids:values.filter(value=>condition_ids.includes(value.condition_id)).map(value=>value.condition_id),requested_at:iso(fetched-(index===0?6_000:3_000)),fetched_at:iso(fetched-(index===0&&rows.length>20?4_000:0))};
 });
 return batchedInterestSnapshotSchema.parse({...oi(),schema:'polymarket-open-interest/2',sample_limit:40,batch_size:20,discovery:hot,rows,values,batches,acquisition_started_at:hot.acquisition_started_at,oi_request_started_at:batches[0].requested_at,fetched_at:iso(fetched)});
}
function legacyOi(fetched=NOW){
 const hot=largeDiscovery(45,fetched);
 return parseOpenInterest({data:hot.rows.slice(0,20).map(row=>({condition_id:row.condition_id!,value:1}))},hot,iso(fetched-6_000),iso(fetched));
}
function interestReply(snapshot:PolymarketInterestSnapshot):PolymarketReply{
 return {snapshot,status:{state:'available',error_code:null,last_attempt_at:snapshot.acquisition_started_at,fetched_at:snapshot.fetched_at,cache_age_ms:Date.now()-snapshotCacheTime(snapshot),refresh_ms:300_000,max_cache_age_ms:600_000,next_retry_at:iso(Date.now()+300_000),source_next_retry_at:iso(Date.now()+30_000)}};
}
function reply(interest:boolean):PolymarketReply{
 const time=new Date(Date.now()).toISOString(),base=interest?oi():discovery();
 const snapshot=interest?{...oi(),acquisition_started_at:time,oi_request_started_at:time,fetched_at:time,discovery:{...discovery(),acquisition_started_at:time,fetched_at:time}}:{...base,acquisition_started_at:time,fetched_at:time};
 return {snapshot,status:{state:'available',error_code:null,last_attempt_at:time,fetched_at:time,cache_age_ms:0,refresh_ms:interest?300_000:30_000,max_cache_age_ms:interest?600_000:300_000,next_retry_at:new Date(Date.now()+(interest?300_000:30_000)).toISOString(),source_next_retry_at:new Date(Date.now()+30_000).toISOString()}};
}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(NOW);Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('Unexpected offline fixture request');}));});
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();});
async function start(){const result=render(<Polymarket/>);await act(()=>vi.advanceTimersByTimeAsync(1));return result;}
describe('optional USDC open-interest amount view',()=>{
 it('labels all 40 selected conditions, two completed batches and their distinct acquisition intervals truthfully',()=>{
  const snapshot=batchedOi(),view=render(<OpenInterest snapshot={snapshot}/>);
  expect(screen.getByText(/最多 40 个市场，分为最多 2 个顺序批次，每批最多 20 个条件/)).toBeTruthy();
  expect(screen.getByText(/最多 100 条.*冻结本次候选范围.*前 40 个.*不是全站 OI 排名.*全站市场总数未知/)).toBeTruthy();
  expect(screen.getByText(/受 40 个上限影响未选 5 个/)).toBeTruthy();
  expect(screen.getByText(/本次已完成 2 批请求：请求 40 个不同条件，返回金额 38 个，未返回 2 个/)).toBeTruthy();
  expect(screen.getByText(/持仓金额正值 37 个、零 1 个、缺失 2 个/)).toBeTruthy();
  const batches=within(screen.getByRole('list',{name:'持仓金额批次采集明细'}));
  expect(batches.getAllByRole('listitem')).toHaveLength(2);
  expect(batches.getByText('第 1 批：请求 20 个条件，返回金额 19 个，未返回 1 个；请求始于 2026-11-05 11:59:54.000 UTC，响应接收于 2026-11-05 11:59:56.000 UTC。')).toBeTruthy();
  expect(batches.getByText('第 2 批：请求 20 个条件，返回金额 19 个，未返回 1 个；请求始于 2026-11-05 11:59:57.000 UTC，响应接收于 2026-11-05 12:00:00.000 UTC。')).toBeTruthy();
  expect(screen.getByText(/完整采集区间：2026-11-05 11:59:52.000 UTC 至 2026-11-05 12:00:00.000 UTC/)).toBeTruthy();
  expect(screen.getByText('OI 采集区间：2026-11-05 11:59:54.000 UTC 至 2026-11-05 12:00:00.000 UTC（首批请求开始至末批响应接收）。')).toBeTruthy();
  expect(screen.getByText(/Gamma 与 OI、不同 OI 批次之间都不是同一时点的原子快照.*来源未提供逐市场估值时间/)).toBeTruthy();
  expect(screen.getByText(/快照年龄从首批 OI 请求开始时间起算，不因后续批次完成而重置/)).toBeTruthy();
  expect(screen.queryByText(/同一次批量取得/)).toBeNull();
  expect(view.container.querySelectorAll('g[data-share]')).toHaveLength(37);
  expect(screen.getByText(/全部 40 项（含 1 个零值、2 个缺失）/)).toBeTruthy();
 });
 it('reports one actual batch for a small v2 sample without claiming two batches ran',()=>{
  render(<OpenInterest snapshot={batchedOi(4)}/>);
  expect(screen.getByText(/本次已完成 1 批请求：请求 4 个不同条件，返回金额 4 个，未返回 0 个/)).toBeTruthy();
  expect(within(screen.getByRole('list',{name:'持仓金额批次采集明细'})).getAllByRole('listitem')).toHaveLength(1);
  expect(screen.queryByText(/第 2 批：/)).toBeNull();
 });
 it('keeps the legacy 20-market bound, actual single batch and original clock rather than relabeling it as 40',()=>{
  render(<OpenInterest snapshot={legacyOi()}/>);
  expect(screen.getByText(/当前显示旧版最多 20 个市场的单批快照/)).toBeTruthy();
  expect(screen.getByText(/再选其中前 20 个/)).toBeTruthy();
  expect(screen.getByText(/受 20 个上限影响未选 25 个/)).toBeTruthy();
  expect(screen.getByText(/本次已完成 1 批请求：请求 20 个不同条件，返回金额 20 个，未返回 0 个/)).toBeTruthy();
  expect(screen.getByText(/旧版快照年龄从原始响应接收时间起算/)).toBeTruthy();
  expect(screen.queryByText(/最多 40 个市场/)).toBeNull();
  expect(screen.queryByText(/受 40 个上限/)).toBeNull();
  expect(screen.queryByText(/第 2 批：/)).toBeNull();
 });
 it('shows monetary area, complete values and explicit zero/missing coverage without flow claims',()=>{
  const view=render(<OpenInterest snapshot={oi()}/>);expect(screen.getByText('未平仓持仓金额（USDC）')).toBeTruthy();expect(view.container.querySelector('[data-layout="treemap"]')).toBeTruthy();expect(view.container.querySelectorAll('g[data-share]')).toHaveLength(2);
  expect(screen.getByText(/持仓金额正值 2 个、零 1 个、缺失 1 个/)).toBeTruthy();expect(screen.getByText(/不是全站 OI 排名/)).toBeTruthy();expect(screen.getByText(/来源未提供逐市场估值时间/)).toBeTruthy();expect(screen.getByText(/全部 4 项（含 1 个零值、1 个缺失）/)).toBeTruthy();expect(screen.getAllByText('0 USDC').length).toBeGreaterThan(0);expect(screen.getAllByText('来源未返回').length).toBeGreaterThan(0);
 });
 it('preserves search and reconciles amount shares without inventing group totals',()=>{
  const view=render(<OpenInterest snapshot={oi()}/>);fireEvent.change(screen.getByLabelText('搜索持仓金额样本'),{target:{value:'large'}});expect(view.container.querySelectorAll('g[data-share]')).toHaveLength(1);expect(view.container.querySelector('g[data-share]')?.getAttribute('data-share')).toBe('1');view.rerender(<OpenInterest snapshot={oi()}/>);expect((screen.getByLabelText('搜索持仓金额样本') as HTMLInputElement).value).toBe('large');
 });
 it('keeps hot refresh at 30 seconds after OI and remembers the separate five-minute OI cooldown',async()=>{
  const fetcher=vi.fn(async(url:string)=>Response.json(reply(url.endsWith('interest'))));vi.stubGlobal('fetch',fetcher);const view=await start();expect(fetcher).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button',{name:'金额 · 未平仓持仓'}));await act(()=>vi.advanceTimersByTimeAsync(30_000));expect(fetcher).toHaveBeenCalledTimes(2);expect(fetcher).toHaveBeenLastCalledWith('/api/v1/polymarket/snapshot?view=interest',expect.anything());expect(view.container.querySelector('[data-layout="treemap"]')).toBeTruthy();expect(screen.queryByText(/等待共享来源冷却结束后检查当前模式/)).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'热门 · 24 小时成交量'}));await act(()=>vi.advanceTimersByTimeAsync(30_000));expect(fetcher).toHaveBeenCalledTimes(3);expect(fetcher).toHaveBeenLastCalledWith('/api/v1/polymarket/snapshot?view=hot',expect.anything());expect(view.container.querySelector('[data-layout="readable-grid"]')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'金额 · 未平仓持仓'}));await act(()=>vi.advanceTimersByTimeAsync(120_000));expect(fetcher).toHaveBeenCalledTimes(3);
 });
 it('hides OI after ten minutes when hidden and does not reuse it for probability',async()=>{
  const fetcher=vi.fn(async(url:string)=>Response.json(reply(url.endsWith('interest'))));vi.stubGlobal('fetch',fetcher);const view=await start();fireEvent.click(screen.getByRole('button',{name:'金额 · 未平仓持仓'}));await act(()=>vi.advanceTimersByTimeAsync(30_000));Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});fireEvent(document,new Event('visibilitychange'));
  await act(()=>vi.advanceTimersByTimeAsync(301_000));expect(screen.getByText('上次有效快照 · 已陈旧')).toBeTruthy();expect(view.container.querySelectorAll('g[data-share]')).toHaveLength(2);
  await act(()=>vi.advanceTimersByTimeAsync(301_000));expect(screen.getByText('暂无可核验的持仓金额')).toBeTruthy();expect(view.container.querySelectorAll('g[data-share]')).toHaveLength(0);fireEvent.click(screen.getByRole('button',{name:'热门 · 24 小时成交量'}));expect(screen.queryByText('65%')).toBeNull();expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it.each(['batched','legacy'] as const)('uses the original %s age clock for the displayed age, five-minute stale flag and ten-minute expiry',async kind=>{
  const fetcher=vi.fn(async(url:string)=>Response.json(url.endsWith('interest')?interestReply(kind==='batched'?batchedOi(45,Date.now()):legacyOi(Date.now())):reply(false)));
  vi.stubGlobal('fetch',fetcher);const view=await start();fireEvent.click(screen.getByRole('button',{name:'金额 · 未平仓持仓'}));await act(()=>vi.advanceTimersByTimeAsync(30_000));
  const batched=kind==='batched';
  expect(screen.getByText(batched?'快照年龄（自首批 OI 请求起）：6 秒':'快照年龄（旧版自响应接收起）：0 秒')).toBeTruthy();
  expect(screen.getByText(/持仓估值时间：接口未提供 · 延迟未知/)).toBeTruthy();
  expect(view.container.querySelectorAll('g[data-share]')).toHaveLength(batched?37:20);
  Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});fireEvent(document,new Event('visibilitychange'));
  await act(()=>vi.advanceTimersByTimeAsync(295_000));
  expect(screen.getByText(batched?'上次有效快照 · 已陈旧':'已获取来源快照')).toBeTruthy();
  await act(()=>vi.advanceTimersByTimeAsync(6_000));expect(screen.getByText('上次有效快照 · 已陈旧')).toBeTruthy();
  await act(()=>vi.advanceTimersByTimeAsync(294_000));
  expect(view.container.querySelectorAll('g[data-share]')).toHaveLength(batched?0:20);
  if(batched)expect(screen.getByText('暂无可核验的持仓金额')).toBeTruthy();
  await act(()=>vi.advanceTimersByTimeAsync(6_000));expect(view.container.querySelectorAll('g[data-share]')).toHaveLength(0);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls.every(([url])=>url.startsWith('/api/v1/polymarket/snapshot?view='))).toBe(true);
 });
 it('treats OI-wide source denial as terminal for hot and newest too',async()=>{
  let denied=false;const fetcher=vi.fn(async(url:string)=>{if(url.endsWith('interest')){denied=true;const value=reply(true);return Response.json({snapshot:null,status:{...value.status,state:'denied',error_code:'source_denied',next_retry_at:null,source_next_retry_at:null}},{status:503});}return Response.json(reply(false));});vi.stubGlobal('fetch',fetcher);await start();fireEvent.click(screen.getByRole('button',{name:'金额 · 未平仓持仓'}));await act(()=>vi.advanceTimersByTimeAsync(30_000));expect(denied).toBe(true);fireEvent.click(screen.getByRole('button',{name:'热门 · 24 小时成交量'}));await act(()=>vi.advanceTimersByTimeAsync(600_000));expect(screen.getByText('来源访问已停止')).toBeTruthy();expect(fetcher).toHaveBeenCalledTimes(2);
 });
});
