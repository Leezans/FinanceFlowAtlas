import {parseTicker as parseKrakenTicker} from './kraken-fixture';
// @vitest-environment jsdom
import React from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import KrakenSpot,{visibleSnapshot,validateKrakenReply} from '../components/crypto/KrakenSpot';
import {MAX_CACHE_AGE_MS,type KrakenReply} from '../lib/crypto/kraken';
const at=Date.parse('2026-11-05T03:00:00Z'),iso=new Date(at).toISOString();
function reply():KrakenReply{return {snapshot:parseKrakenTicker({error:[],result:{XXBTZUSD:{c:['12.34567890','0.1'],v:['999','3.125'],p:['999','12.1'],t:[999,8]},XETHZUSD:{c:['2.5','1'],v:['999','0'],p:['999','2.4'],t:[999,0]}}},iso,iso),status:{state:'available',error_code:null,last_attempt_at:iso,fetched_at:iso,cache_age_ms:0,refresh_ms:60_000,max_cache_age_ms:MAX_CACHE_AGE_MS,next_retry_at:iso}};}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(at);});
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();});
async function start(){render(<KrakenSpot/>);await act(()=>vi.advanceTimersByTimeAsync(1));}
describe('Kraken view',()=>{
 it('shows venue, base-volume units and missing flow/OI without a fabricated aggregate',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>Response.json(reply())));await start();expect(screen.getByRole('img',{name:/ · BTC\/USD · /})).toBeTruthy();expect(screen.getByText('12.3456789 USD')).toBeTruthy();expect(screen.getByText(/资金净流入：此来源不提供/)).toBeTruthy();expect(screen.getByText(/未平仓量（OI）：现货不适用/)).toBeTruthy();expect(screen.getByText(/接口未提供 · 延迟未知/)).toBeTruthy();expect(screen.getByRole('link',{name:'A 股优先入口'}).getAttribute('href')).toBe('/ashare');expect(screen.getByText(/不是全球虚拟货币市场总量/)).toBeTruthy();});
 it('shows empty state on initial 503, not zeroes or examples',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>Response.json({snapshot:null,status:{...reply().status,state:'unavailable',error_code:'upstream_http'}},{status:503})));await start();expect(screen.queryByRole('img',{name:/ · BTC\/USD · /})).toBeNull();expect(screen.getByText(/交易对目录与行情通过校验后展示/)).toBeTruthy();});
 it('keeps a network failure visibly stale, then hides expired rows while hidden',async()=>{const fetcher=vi.fn(async()=>Response.json(reply()));vi.stubGlobal('fetch',fetcher);await start();fetcher.mockRejectedValue(new Error('offline'));fireEvent.click(screen.getByRole('button',{name:'检查更新'}));await act(()=>vi.advanceTimersByTimeAsync(1));expect(screen.getByText('上次有效快照 · 已陈旧')).toBeTruthy();Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});await act(()=>vi.advanceTimersByTimeAsync(MAX_CACHE_AGE_MS+10_000));expect(screen.queryByRole('img',{name:/ · BTC\/USD · /})).toBeNull();expect(screen.getByText(/交易对目录与行情通过校验后展示/)).toBeTruthy();Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});});
 it('prevents repeated concurrent clicks, stops polling on denial, and clears rows',async()=>{const denied={snapshot:null,status:{...reply().status,state:'denied',error_code:'source_denied'}};let resolve:(r:Response)=>void=()=>{};const fetcher=vi.fn(()=>new Promise<Response>(r=>{resolve=r;}));vi.stubGlobal('fetch',fetcher);await start();fireEvent.click(screen.getByRole('button',{name:'正在检查…'}));expect(fetcher).toHaveBeenCalledTimes(1);await act(async()=>resolve(Response.json(denied,{status:503})));expect(screen.getByText('来源访问已停止')).toBeTruthy();expect((screen.getByRole('button',{name:'检查更新'}) as HTMLButtonElement).disabled).toBe(true);await act(()=>vi.advanceTimersByTimeAsync(180_000));expect(fetcher).toHaveBeenCalledTimes(1);});
 it('schedules the next check 60 seconds after a completed fetch instead of skipping a gate window',async()=>{
  let resolve!:(value:Response)=>void;const fetcher=vi.fn(()=>new Promise<Response>(done=>{resolve=done;}));vi.stubGlobal('fetch',fetcher);await start();await act(()=>vi.advanceTimersByTimeAsync(5_000));await act(async()=>resolve(Response.json(reply())));
  await act(()=>vi.advanceTimersByTimeAsync(59_999));expect(fetcher).toHaveBeenCalledTimes(1);await act(()=>vi.advanceTimersByTimeAsync(1));expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('aborts requests on unmount',async()=>{const fetcher=vi.fn(()=>new Promise<Response>(()=>{}));vi.stubGlobal('fetch',fetcher);const result=render(<KrakenSpot/>);await act(()=>vi.advanceTimersByTimeAsync(1));const init=(fetcher.mock.calls as unknown as [string,RequestInit][])[0][1];result.unmount();expect(init.signal?.aborted).toBe(true);});
 it('rejects future and expired observation cache, independently of server status',()=>{expect(visibleSnapshot(reply(),at-1)).toBeNull();expect(visibleSnapshot(reply(),at+MAX_CACHE_AGE_MS+1)).toBeNull();expect(visibleSnapshot(reply(),at+1)).not.toBeNull();});
});

describe('Kraken response trust boundary',()=>{
 it.each([401,403])('clears evidence and stops checks after HTTP %s',async status=>{
  const fetcher=vi.fn(async()=>Response.json(reply()));vi.stubGlobal('fetch',fetcher);await start();
  expect(screen.getByRole('img',{name:/ · BTC\/USD · /})).toBeTruthy();
  fetcher.mockImplementation(async()=>new Response('<html>Sign in</html>',{status}));
  fireEvent.click(screen.getByRole('button',{name:'检查更新'}));await act(()=>vi.advanceTimersByTimeAsync(1));
  expect(screen.queryByRole('img',{name:/ · BTC\/USD · /})).toBeNull();expect(screen.getByText('展示权限已失效')).toBeTruthy();
  expect((screen.getByRole('button',{name:'检查更新'}) as HTMLButtonElement).disabled).toBe(true);
  await act(()=>vi.advanceTimersByTimeAsync(180_000));fireEvent(document,new Event('visibilitychange'));expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it.each(['json','html'])('clears old evidence after malformed successful %s and recovers',async kind=>{
  const fetcher=vi.fn(async()=>Response.json(reply()));vi.stubGlobal('fetch',fetcher);await start();
  fetcher.mockImplementation(async()=>kind==='html'?new Response('<html>not evidence</html>'):Response.json({...reply(),snapshot:{...reply().snapshot,rows:[]}}));
  fireEvent.click(screen.getByRole('button',{name:'检查更新'}));await act(()=>vi.advanceTimersByTimeAsync(1));
  expect(screen.queryByRole('img',{name:/ · BTC\/USD · /})).toBeNull();expect(screen.getByText('响应数据未通过校验，已清空浏览器行情。')).toBeTruthy();
  fetcher.mockImplementation(async()=>Response.json(reply()));fireEvent.click(screen.getByRole('button',{name:'检查更新'}));await act(()=>vi.advanceTimersByTimeAsync(1));expect(screen.getByRole('img',{name:/ · BTC\/USD · /})).toBeTruthy();
 });
 it('retains validated evidence on a temporary non-JSON 502',async()=>{
  const fetcher=vi.fn(async()=>Response.json(reply()));vi.stubGlobal('fetch',fetcher);await start();fetcher.mockImplementation(async()=>new Response('Temporary gateway error',{status:502}));
  fireEvent.click(screen.getByRole('button',{name:'检查更新'}));await act(()=>vi.advanceTimersByTimeAsync(1));expect(screen.getByRole('img',{name:/ · BTC\/USD · /})).toBeTruthy();expect(screen.getByText('上次有效快照 · 已陈旧')).toBeTruthy();
 });
 it('validates pair evidence, semantics, precision and status consistency',()=>{
  expect(validateKrakenReply(reply())).toEqual(reply());
  const mutations:Array<(value:KrakenReply)=>void>=[
   value=>{value.snapshot!.rows[1]=value.snapshot!.rows[0];},
   value=>{value.snapshot!.rows[0].base='ETH';},
   value=>{value.snapshot!.rows[0].last_price_usd='-1';},
   value=>{value.snapshot!.rows[0].trades_24h=1.5;},
   value=>{value.snapshot!.acquisition_started_at='2026-11-06T00:00:00Z';},
   value=>{value.status.fetched_at=null;},
   value=>{value.status.state='denied';},
   value=>{Object.assign(value.snapshot!,{window:'today',extra:'untrusted'});},
   value=>{Object.assign(value.snapshot!.rows[0],{net_capital_flow:1});},
  ];
  for(const mutate of mutations){const value=reply();mutate(value);expect(()=>validateKrakenReply(value)).toThrow();}
 });
});
