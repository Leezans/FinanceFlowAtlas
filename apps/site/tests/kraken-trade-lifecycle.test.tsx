// @vitest-environment jsdom
import React from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import KrakenSpot from '../components/crypto/KrakenSpot';
import {MAX_CACHE_AGE_MS,type KrakenReply} from '../lib/crypto/kraken';
import {parseKrakenTrades,tradeSnapshot} from '../lib/crypto/trades';
import {parseTicker,universe} from './kraken-fixture';
const at=Date.parse('2026-11-05T03:00:00.000Z'),iso=new Date(at).toISOString();
function reply():KrakenReply{
 const quotes=parseTicker({error:[],result:{XXBTZUSD:{c:['12.5','1'],v:['1','1'],p:['1','10'],t:[1,1]},XETHZUSD:{c:['2','1'],v:['1','1'],p:['1','2'],t:[1,1]}}},iso,iso);
 const rows=universe(iso).pairs.map(pair=>parseKrakenTrades({error:[],result:{[pair.source_pair]:[['10','2',(at-1000)/1000,'b','m','',1]],last:'123'}},pair,at-300_000,at,at));
 return {snapshot:quotes,trade_snapshot:tradeSnapshot(rows,at,at),status:{state:'available',error_code:null,last_attempt_at:iso,fetched_at:iso,cache_age_ms:0,refresh_ms:60_000,max_cache_age_ms:MAX_CACHE_AGE_MS,next_retry_at:iso}};
}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(at);});
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});});
describe('Kraken trade view lifecycle',()=>{
 it('shares stale status on a failed refresh and hides all trade evidence after expiry while hidden',async()=>{
  const fetcher=vi.fn(async()=>Response.json(reply()));vi.stubGlobal('fetch',fetcher);const {container}=render(<KrakenSpot/>);await act(()=>vi.advanceTimersByTimeAsync(1));
  const trade=()=>container.querySelector('[aria-label="来源买卖标记成交额差矩阵工作区"]')!;
  expect(trade().querySelectorAll('details [data-id]')).toHaveLength(2);expect(trade().textContent).toContain('20 USD');
  fetcher.mockRejectedValue(new Error('offline'));fireEvent.click(screen.getByRole('button',{name:'检查更新'}));await act(()=>vi.advanceTimersByTimeAsync(1));
  expect(screen.getByText('上次有效快照 · 已陈旧')).toBeTruthy();expect(trade().querySelectorAll('details [data-id]')).toHaveLength(2);
  Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});await act(()=>vi.advanceTimersByTimeAsync(MAX_CACHE_AGE_MS+10_000));
  expect(trade().querySelectorAll('details [data-id]')).toHaveLength(0);expect(trade().textContent).not.toContain('20 USD');
 });
 it.each([401,403])('clears trade amounts and stops polling after HTTP %s',async status=>{
  const fetcher=vi.fn(async()=>Response.json(reply()));vi.stubGlobal('fetch',fetcher);const {container}=render(<KrakenSpot/>);await act(()=>vi.advanceTimersByTimeAsync(1));
  expect(container.querySelectorAll('[data-layout=readable-grid] [data-id], details [data-id]')).toHaveLength(4);
  fetcher.mockImplementation(async()=>new Response('denied',{status}));fireEvent.click(screen.getByRole('button',{name:'检查更新'}));await act(()=>vi.advanceTimersByTimeAsync(1));
  expect(container.querySelectorAll('[data-id]')).toHaveLength(0);expect(screen.queryByText('20 USD')).toBeNull();
  await act(()=>vi.advanceTimersByTimeAsync(180_000));expect(fetcher).toHaveBeenCalledTimes(2);
 });
});
