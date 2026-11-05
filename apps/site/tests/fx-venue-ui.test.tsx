// @vitest-environment jsdom
import React from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import KrakenFxSpot from '../components/forex/KrakenFxSpot';
import ForexWorkspace from '../components/forex/ForexWorkspace';
import {fxVenueAt,fxVenueReply} from './fx-venue-fixture';
import {fxPayload} from './fx-fixture';
import {MAX_CACHE_AGE_MS} from '../lib/crypto/kraken';
const tick=()=>act(()=>vi.advanceTimersByTimeAsync(1));
const tiles=()=>document.querySelectorAll('[data-id]');
const times=()=>screen.getByRole('region',{name:'外汇成交时戳证据'});
async function start(){const fetcher=vi.fn<typeof fetch>(async()=>Response.json(fxVenueReply()));vi.stubGlobal('fetch',fetcher);render(<KrakenFxSpot/>);await tick();return fetcher;}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(fxVenueAt);Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});});
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();});
describe('venue FX view lifecycle',()=>{
 it('requests only existing gated endpoint with fixed fiat scope and independent timestamps',async()=>{
  const fetcher=await start();expect(fetcher.mock.calls[0][0]).toBe('/api/v1/crypto/kraken/snapshot?pairs=AUD%2FUSD%2CEUR%2FUSD%2CGBP%2FUSD');
  expect(tiles()).toHaveLength(3);expect(screen.queryByText('BTC/USD')).toBeNull();expect(screen.queryByText('USDC/USD')).toBeNull();
  expect(screen.getByText(/仅覆盖这 3 组/)).toBeTruthy();expect(screen.getByText('接口未提供 · 未知')).toBeTruthy();expect(times().textContent).toContain('02:59:50.000 UTC');
  expect(document.querySelector('[data-layout="readable-grid"]')).toBeTruthy();expect(document.querySelector('[data-id="EUR/USD"]')?.getAttribute('data-color')).toBe('zero');
 });
 it('switches all metrics without source calls and never assigns amount area',async()=>{
  const fetcher=await start();fireEvent.click(screen.getByRole('button',{name:'24h 基础币成交量'}));expect(screen.getByText('7.125 AUD')).toBeTruthy();expect(screen.getByText('7.125 EUR')).toBeTruthy();expect(document.querySelectorAll('[data-color=missing]')).toHaveLength(3);
  fireEvent.click(screen.getByRole('button',{name:'24h 成交均价'}));fireEvent.click(screen.getByRole('button',{name:'24h 成交笔数'}));expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('checks again after 60 seconds and renders a newer acquisition without reclassifying quote freshness',async()=>{
  const fetcher=await start();fetcher.mockImplementation(async()=>Response.json(fxVenueReply('5m',fxVenueAt+60_000)));await act(()=>vi.advanceTimersByTimeAsync(60_000));expect(fetcher).toHaveBeenCalledTimes(2);expect(screen.getByText('2026-11-05 03:01:00.000 UTC')).toBeTruthy();expect(screen.getByText('接口未提供 · 未知')).toBeTruthy();
 });
 it('changes evidence window, preserving quote matrix but clearing previous execution times',async()=>{
  const fetcher=await start();fetcher.mockImplementation(async()=>Response.json({...fxVenueReply('1m'),trade_snapshot:null}));fireEvent.click(screen.getByRole('radio',{name:'1 分钟'}));expect(times().textContent).not.toContain('02:59:50');await tick();expect(tiles()).toHaveLength(3);
  expect(fetcher.mock.calls[1][0]).toContain('&window=1m');expect(times().textContent).toContain('成交证据尚未取得');
 });
 it('rejects the wrong requested pair identity rather than showing other scopes',async()=>{
  const fetcher=await start();const wrong=fxVenueReply();wrong.requested_pairs=['BTC/USD'];wrong.trade_snapshot=null;fetcher.mockImplementation(async()=>Response.json(wrong));fireEvent.click(screen.getByRole('button',{name:'检查更新'}));await tick();expect(tiles()).toHaveLength(0);expect(screen.getByText('响应未通过校验，已清空行情。')).toBeTruthy();
 });
 it.each([401,403])('clears all evidence and stops checks on permission failure %s',async status=>{
  const fetcher=await start();fetcher.mockImplementation(async()=>new Response('denied',{status}));fireEvent.click(screen.getByRole('button',{name:'检查更新'}));await tick();expect(tiles()).toHaveLength(0);expect(times().textContent).not.toContain('02:59:50');await act(()=>vi.advanceTimersByTimeAsync(180_000));expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('stops after source denial and does not swap to the ECB fallback',async()=>{
  const fetcher=await start(),reply=fxVenueReply();fetcher.mockImplementation(async()=>Response.json({...reply,snapshot:null,trade_snapshot:null,status:{...reply.status,state:'denied',error_code:'source_denied'}},{status:503}));fireEvent.click(screen.getByRole('button',{name:'检查更新'}));await tick();expect(tiles()).toHaveLength(0);expect(screen.getByText('来源访问已停止')).toBeTruthy();await act(()=>vi.advanceTimersByTimeAsync(180_000));expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('retains original acquisition during a temporary failure, then expires it even in a hidden tab',async()=>{
  const fetcher=await start();fetcher.mockRejectedValue(new Error('offline'));fireEvent.click(screen.getByRole('button',{name:'检查更新'}));await tick();expect(screen.getByText('上次有效快照 · 已陈旧')).toBeTruthy();expect(tiles()).toHaveLength(3);Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});fireEvent(document,new Event('visibilitychange'));await act(()=>vi.advanceTimersByTimeAsync(MAX_CACHE_AGE_MS+10_000));expect(tiles()).toHaveLength(0);expect(times().textContent).not.toContain('02:59:50');
 });
 it('aborts an in-flight request when switching away from venue FX',async()=>{
  const fetcher=vi.fn<typeof fetch>(()=>new Promise(()=>{}));vi.stubGlobal('fetch',fetcher);render(<ForexWorkspace/>);await tick();const signal=fetcher.mock.calls[0][1]?.signal;fireEvent.click(screen.getByRole('button',{name:'ECB 每日参考 · 非实时'}));expect(signal?.aborted).toBe(true);
 });
 it('mounts only the chosen source during repeated view changes',async()=>{
  const fetcher=vi.fn<typeof fetch>(async input=>String(input).includes('/fx/')?Response.json(fxPayload()):Response.json(fxVenueReply()));vi.stubGlobal('fetch',fetcher);render(<ForexWorkspace/>);await tick();expect(fetcher).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls[0][0]).toContain('/crypto/kraken/');
  fireEvent.click(screen.getByRole('button',{name:'ECB 每日参考 · 非实时'}));await tick();expect(fetcher.mock.calls[1][0]).toBe('/api/v1/fx/reference');expect(screen.queryByRole('heading',{name:'Kraken 法币现货矩阵'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'交易所日内行情'}));await tick();expect(fetcher.mock.calls[2][0]).toContain('/crypto/kraken/');expect(screen.getByRole('heading',{name:'Kraken 法币现货矩阵'})).toBeTruthy();
 });
});
