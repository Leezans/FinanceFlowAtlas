// @vitest-environment jsdom
import React from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import KrakenSpot from '../components/crypto/KrakenSpot';
import KrakenPairSelector from '../components/crypto/KrakenPairSelector';
import {MAX_CACHE_AGE_MS,parseKrakenTicker,parseKrakenUniverse,type KrakenReply} from '../lib/crypto/kraken';
import {parseKrakenTrades,tradeSnapshot} from '../lib/crypto/trades';
import {pairMetadata} from './kraken-fixture';
const at=Date.parse('2026-11-05T03:00:00Z'),iso=new Date(at).toISOString();
function reply():KrakenReply{
 const names=['ADA','BTC','ETH','SOL','XRP'];
 const universe=parseKrakenUniverse({error:[],result:Object.fromEntries(names.map(base=>[base+'USD',pairMetadata(base)]))},iso);
 const snapshot=parseKrakenTicker({error:[],result:Object.fromEntries(names.map(base=>[base+'USD',{c:['10','1'],v:['1','1'],p:['1','10'],t:[1,1]}]))},iso,iso,universe);
 return {snapshot,trade_snapshot:null,status:{state:'available',error_code:null,last_attempt_at:iso,fetched_at:iso,cache_age_ms:0,refresh_ms:60_000,max_cache_age_ms:MAX_CACHE_AGE_MS,next_retry_at:new Date(at+60_000).toISOString()}};
}
function defaultTradesReply():KrakenReply{
 const result=reply();const rows=result.snapshot!.rows.filter(row=>['BTC/USD','ETH/USD','SOL/USD'].includes(row.pair)).map(quote=>parseKrakenTrades({error:[],result:{[quote.source_pair]:[['10','2',(at-1000)/1000,'b','m','',1]],last:'123'}},{pair:quote.pair,source_pair:quote.source_pair,base:quote.base,quote:quote.quote},at-300_000,at,at));
 return {...result,trade_snapshot:tradeSnapshot(rows,at,at)};
}
const tick=()=>act(()=>vi.advanceTimersByTimeAsync(1));
async function start(){render(<KrakenSpot/>);await tick();}
function selectAda(){fireEvent.click(screen.getByRole('checkbox',{name:'SOL/USD'}));fireEvent.click(screen.getByRole('checkbox',{name:'ETH/USD'}));fireEvent.click(screen.getByRole('checkbox',{name:'BTC/USD'}));fireEvent.click(screen.getByRole('checkbox',{name:'ADA/USD'}));fireEvent.click(screen.getByRole('button',{name:'应用选择'}));}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(at);});
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});});
describe('bounded Kraken selection',()=>{
 it('limits drafts to three, canonicalizes Apply, and restores defaults without fetching',()=>{
  const apply=vi.fn();render(<KrakenPairSelector catalog={['ADA/USD','BTC/USD','ETH/USD','SOL/USD','XRP/USD']} selected={['BTC/USD','ETH/USD','SOL/USD']} disabled={false} onApply={apply}/>);
  expect((screen.getByRole('checkbox',{name:'ADA/USD'}) as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox',{name:'ETH/USD'}));fireEvent.click(screen.getByRole('checkbox',{name:'ADA/USD'}));
  fireEvent.click(screen.getByRole('button',{name:'应用选择'}));expect(apply).toHaveBeenCalledWith(['ADA/USD','BTC/USD','SOL/USD']);
  fireEvent.click(screen.getByRole('button',{name:'恢复默认选择'}));expect(apply).toHaveBeenCalledTimes(1);
  expect((screen.getByRole('button',{name:'应用选择'}) as HTMLButtonElement).disabled).toBe(true);
 });
 it('clears the draft while searching so a hidden full selection does not block a new pair',async()=>{
  const fetcher=vi.fn<typeof fetch>(async()=>Response.json(reply()));vi.stubGlobal('fetch',fetcher);await start();
  fireEvent.change(screen.getByRole('searchbox'),{target:{value:'ada'}});expect((screen.getByRole('checkbox',{name:'ADA/USD'}) as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'清空待选'}));expect((screen.getByRole('button',{name:'应用选择'}) as HTMLButtonElement).disabled).toBe(true);expect(fetcher).toHaveBeenCalledTimes(1);
  expect((screen.getByRole('checkbox',{name:'ADA/USD'}) as HTMLInputElement).disabled).toBe(false);fireEvent.click(screen.getByRole('checkbox',{name:'ADA/USD'}));expect(fetcher).toHaveBeenCalledTimes(1);
  fetcher.mockImplementation(async()=>Response.json({...reply(),requested_pairs:['ADA/USD']}));fireEvent.click(screen.getByRole('button',{name:'应用选择'}));await tick();expect(fetcher).toHaveBeenCalledTimes(2);expect(fetcher.mock.calls[1][0]).toBe('/api/v1/crypto/kraken/snapshot?pairs=ADA%2FUSD');
  expect(screen.getByRole('button',{name:'恢复默认选择'})).toBeTruthy();
 });
 it('keeps catalog through shared cooldown, requires Apply, and makes repeat Apply a no-op',async()=>{
  const fetcher=vi.fn<typeof fetch>(async()=>Response.json(reply()));vi.stubGlobal('fetch',fetcher);await start();
  fireEvent.change(screen.getByRole('searchbox'),{target:{value:'ada'}});expect(fetcher).toHaveBeenCalledTimes(1);fireEvent.change(screen.getByRole('searchbox'),{target:{value:''}});
  const cooling={...reply(),requested_pairs:['ADA/USD'],status:{...reply().status,state:'stale',error_code:'source_cooldown'}};
  fetcher.mockImplementation(async()=>Response.json(cooling,{status:503}));selectAda();await tick();
  expect(fetcher.mock.calls[1][0]).toBe('/api/v1/crypto/kraken/snapshot?pairs=ADA%2FUSD');
  expect(screen.getByText(/所选交易对成交证据尚未取得/)).toBeTruthy();expect(screen.getByRole('checkbox',{name:'XRP/USD'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'应用选择'}));expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('renders only the matching explicit v2 evidence and names the applied pair',async()=>{
  const fetcher=vi.fn<typeof fetch>(async()=>Response.json(reply()));vi.stubGlobal('fetch',fetcher);await start();
  const quote=reply().snapshot!.rows.find(row=>row.pair==='ADA/USD')!;
  const row=parseKrakenTrades({error:[],result:{ADAUSD:[['10','2',(at-1000)/1000,'b','m','',1]],last:'123'}},{pair:quote.pair,source_pair:quote.source_pair,base:quote.base,quote:quote.quote},at-300_000,at,at);
  fetcher.mockImplementation(async()=>Response.json({...reply(),requested_pairs:['ADA/USD'],trade_snapshot:tradeSnapshot([row],at,at,['ADA/USD'])}));selectAda();await tick();
  const matrix=screen.getByRole('region',{name:'来源买卖标记成交额差矩阵工作区'});
  expect(matrix.querySelectorAll('details [data-id]')).toHaveLength(1);expect(matrix.textContent).toContain('20 USD');expect(matrix.textContent).toContain('仅 Kraken 的 ADA/USD');expect(matrix.textContent).not.toContain('BTC/USD');
 });
 it('rejects missing selection identity instead of accepting legacy data for explicit selection',async()=>{
  const fetcher=vi.fn<typeof fetch>(async()=>Response.json(reply()));vi.stubGlobal('fetch',fetcher);await start();selectAda();await tick();expect(screen.getByText('响应数据未通过校验，已清空浏览器行情。')).toBeTruthy();expect(screen.queryByRole('checkbox')).toBeNull();
 });
 it('does not abort or replace pending work on Apply and ignores a late prior-scope response',async()=>{
  const fetcher=vi.fn<typeof fetch>(async()=>Response.json(defaultTradesReply()));vi.stubGlobal('fetch',fetcher);await start();
  let resolve!:(r:Response)=>void;fetcher.mockImplementation(()=>new Promise<Response>(done=>{resolve=done;}));
  fireEvent.click(screen.getByRole('button',{name:'检查更新'}));selectAda();expect(fetcher).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('img',{name:/ · BTC\/USD · /})).toBeTruthy();expect(screen.getByRole('region',{name:'来源买卖标记成交额差矩阵工作区'}).querySelectorAll('details [data-id]')).toHaveLength(0);
  await act(async()=>resolve(Response.json(defaultTradesReply())));expect(screen.queryByRole('img',{name:/ · BTC\/USD · /})).toBeTruthy();
  await act(()=>vi.advanceTimersByTimeAsync(60_000));expect(fetcher).toHaveBeenCalledTimes(3);expect(fetcher.mock.calls[2][0]).toContain('pairs=ADA%2FUSD');
 });
 it('does not revive old A trades after switching A to B and back to A in flight',async()=>{
  const fetcher=vi.fn<typeof fetch>(async()=>Response.json(defaultTradesReply()));vi.stubGlobal('fetch',fetcher);await start();
  const trades=()=>screen.getByRole('region',{name:'来源买卖标记成交额差矩阵工作区'}).querySelectorAll('details [data-id]');expect(trades()).toHaveLength(3);
  let resolve!:(r:Response)=>void;fetcher.mockImplementation(()=>new Promise<Response>(done=>{resolve=done;}));fireEvent.click(screen.getByRole('button',{name:'检查更新'}));selectAda();
  fireEvent.click(screen.getByRole('button',{name:'恢复默认选择'}));fireEvent.click(screen.getByRole('button',{name:'应用选择'}));expect(trades()).toHaveLength(0);
  await act(async()=>resolve(Response.json(defaultTradesReply())));expect(trades()).toHaveLength(0);expect(screen.getByRole('img',{name:/ · BTC\/USD · /})).toBeTruthy();expect(fetcher).toHaveBeenCalledTimes(2);
  fetcher.mockImplementation(async()=>Response.json(defaultTradesReply()));await act(()=>vi.advanceTimersByTimeAsync(60_000));expect(trades()).toHaveLength(3);expect(fetcher.mock.calls[2][0]).toBe('/api/v1/crypto/kraken/snapshot');
 });
 it.each([401,403])('clears catalog and stops on HTTP %s even for a previous scope',async status=>{
  const fetcher=vi.fn<typeof fetch>(async()=>Response.json(reply()));vi.stubGlobal('fetch',fetcher);await start();let resolve!:(r:Response)=>void;fetcher.mockImplementation(()=>new Promise<Response>(done=>{resolve=done;}));
  fireEvent.click(screen.getByRole('button',{name:'检查更新'}));selectAda();await act(async()=>resolve(new Response('denied',{status})));
  expect(screen.queryByRole('checkbox')).toBeNull();expect(screen.getByText('展示权限已失效')).toBeTruthy();await act(()=>vi.advanceTimersByTimeAsync(180_000));expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('honors a late old-scope source denial and never resumes polling',async()=>{
  const fetcher=vi.fn<typeof fetch>(async()=>Response.json(reply()));vi.stubGlobal('fetch',fetcher);await start();let resolve!:(r:Response)=>void;fetcher.mockImplementation(()=>new Promise<Response>(done=>{resolve=done;}));
  fireEvent.click(screen.getByRole('button',{name:'检查更新'}));selectAda();await act(async()=>resolve(Response.json({snapshot:null,trade_snapshot:null,status:{...reply().status,state:'denied',error_code:'source_denied'}},{status:503})));
  expect(screen.queryByRole('checkbox')).toBeNull();expect(screen.getByText('来源访问已停止')).toBeTruthy();await act(()=>vi.advanceTimersByTimeAsync(180_000));expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('expires retained catalog while hidden without starting more checks',async()=>{
  const fetcher=vi.fn<typeof fetch>(async()=>Response.json(reply()));vi.stubGlobal('fetch',fetcher);await start();Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});fireEvent(document,new Event('visibilitychange'));
  await act(()=>vi.advanceTimersByTimeAsync(MAX_CACHE_AGE_MS+10_000));expect(screen.queryByRole('checkbox')).toBeNull();expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('clears catalog after a successful response with the wrong requested selection',async()=>{
  const fetcher=vi.fn<typeof fetch>(async()=>Response.json(reply()));vi.stubGlobal('fetch',fetcher);await start();fetcher.mockImplementation(async()=>Response.json({...reply(),requested_pairs:['XRP/USD']}));selectAda();await tick();
  expect(screen.queryByRole('checkbox')).toBeNull();expect(screen.getByText('响应数据未通过校验，已清空浏览器行情。')).toBeTruthy();
 });
});
