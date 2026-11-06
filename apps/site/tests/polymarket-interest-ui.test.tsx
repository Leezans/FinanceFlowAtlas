// @vitest-environment jsdom
import React from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import Polymarket from '../components/polymarket/Polymarket';
import OpenInterest from '../components/polymarket/OpenInterest';
import {parseHotPolymarket} from '../lib/polymarket/adapter';
import {parseOpenInterest} from '../lib/polymarket/interest';
import {type PolymarketReply} from '../lib/polymarket/model';
import {market,NOW,ISO} from './polymarket-fixture';
const id=(n:number)=>`0x${String(n).padStart(64,'0')}`;
const discovery=()=>parseHotPolymarket([market('4',{conditionId:id(4),question:'Synthetic large open interest?',volume24hr:40}),market('3',{conditionId:id(3),question:'Synthetic small open interest?',volume24hr:30}),market('2',{conditionId:id(2),question:'Synthetic zero open interest?',volume24hr:20}),market('1',{conditionId:id(1),question:'Synthetic missing open interest?',volume24hr:10})],ISO,ISO);
const oi=()=>parseOpenInterest({data:[{condition_id:id(3),value:10},{condition_id:id(4),value:90},{condition_id:id(2),value:0}]},discovery(),ISO,ISO);
function reply(interest:boolean):PolymarketReply{
 const time=new Date(Date.now()).toISOString(),base=interest?oi():discovery();
 const snapshot=interest?{...oi(),acquisition_started_at:time,oi_request_started_at:time,fetched_at:time,discovery:{...discovery(),acquisition_started_at:time,fetched_at:time}}:{...base,acquisition_started_at:time,fetched_at:time};
 return {snapshot,status:{state:'available',error_code:null,last_attempt_at:time,fetched_at:time,cache_age_ms:0,refresh_ms:interest?300_000:30_000,max_cache_age_ms:interest?600_000:300_000,next_retry_at:new Date(Date.now()+(interest?300_000:30_000)).toISOString(),source_next_retry_at:new Date(Date.now()+30_000).toISOString()}};
}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(NOW);Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});});
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();});
async function start(){const result=render(<Polymarket/>);await act(()=>vi.advanceTimersByTimeAsync(1));return result;}
describe('optional USDC open-interest amount view',()=>{
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
 it('treats OI-wide source denial as terminal for hot and newest too',async()=>{
  let denied=false;const fetcher=vi.fn(async(url:string)=>{if(url.endsWith('interest')){denied=true;const value=reply(true);return Response.json({snapshot:null,status:{...value.status,state:'denied',error_code:'source_denied',next_retry_at:null,source_next_retry_at:null}},{status:503});}return Response.json(reply(false));});vi.stubGlobal('fetch',fetcher);await start();fireEvent.click(screen.getByRole('button',{name:'金额 · 未平仓持仓'}));await act(()=>vi.advanceTimersByTimeAsync(30_000));expect(denied).toBe(true);fireEvent.click(screen.getByRole('button',{name:'热门 · 24 小时成交量'}));await act(()=>vi.advanceTimersByTimeAsync(600_000));expect(screen.getByText('来源访问已停止')).toBeTruthy();expect(fetcher).toHaveBeenCalledTimes(2);
 });
});
