// @vitest-environment jsdom
import React from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import KrakenSpot from '../components/crypto/KrakenSpot';
import KrakenTradeMatrix from '../components/crypto/KrakenTradeMatrix';
import {MAX_CACHE_AGE_MS,parseKrakenTicker,parseKrakenUniverse,type KrakenReply} from '../lib/crypto/kraken';
import {parseKrakenTrades,tradeSnapshot} from '../lib/crypto/trades';
import {pairMetadata} from './kraken-fixture';
const at=Date.parse('2026-11-05T03:00:00Z'),iso=new Date(at).toISOString();
function reply(window:'1m'|'5m'='5m'):KrakenReply{
 const names=['ADA','BTC','ETH','SOL'];
 const universe=parseKrakenUniverse({error:[],result:Object.fromEntries(names.map(base=>[base+'USD',pairMetadata(base)]))},iso);
 const snapshot=parseKrakenTicker({error:[],result:Object.fromEntries(names.map(base=>[base+'USD',{c:['10','1'],v:['1','1'],p:['1','10'],t:[1,1]}]))},iso,iso,universe);
 const rows=snapshot.rows.filter(row=>row.pair!=='ADA/USD').map(quote=>parseKrakenTrades({error:[],result:{[quote.source_pair]:[['10','2',(at-1000)/1000,'b','m','',1]],last:'123'}},{pair:quote.pair,source_pair:quote.source_pair,base:quote.base,quote:quote.quote},at-300_000,at,at));
 const trades=tradeSnapshot(rows,at,at);
 if(window==='1m'){trades.window_ms=60_000;trades.window_started_at=new Date(at-60_000).toISOString();}
 return {snapshot,trade_snapshot:trades,...(window==='1m'?{requested_window:window}:{}),status:{state:'available',error_code:null,last_attempt_at:iso,fetched_at:iso,cache_age_ms:0,refresh_ms:60_000,max_cache_age_ms:MAX_CACHE_AGE_MS,next_retry_at:new Date(at+60_000).toISOString()}};
}
const tick=()=>act(()=>vi.advanceTimersByTimeAsync(1));
const matrix=()=>screen.getByRole('region',{name:'来源买卖标记成交额差矩阵工作区'});
const evidence=()=>matrix().querySelectorAll('details [data-id]');
async function start(fetcher=vi.fn<typeof fetch>(async()=>Response.json(reply()))){vi.stubGlobal('fetch',fetcher);render(<KrakenSpot/>);await tick();return fetcher;}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(at);});
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();});
describe('Kraken trade timeframe controls',()=>{
 it('defaults to 5m and requests 1m without changing the ticker universe',async()=>{
  const fetcher=await start();expect((screen.getByRole('radio',{name:'5 分钟'}) as HTMLInputElement).checked).toBe(true);
  expect(fetcher.mock.calls[0][0]).toBe('/api/v1/crypto/kraken/snapshot');
  fetcher.mockImplementation(async()=>Response.json(reply('1m')));
  fireEvent.click(screen.getByRole('radio',{name:'1 分钟'}));expect(evidence()).toHaveLength(0);expect(screen.getByRole('checkbox',{name:'ADA/USD'})).toBeTruthy();await tick();
  expect(fetcher.mock.calls[1][0]).toBe('/api/v1/crypto/kraken/snapshot?window=1m');
  expect(screen.getByRole('heading',{name:'1 分钟来源买卖标记成交额差 · USD'})).toBeTruthy();expect(evidence()).toHaveLength(3);
  expect(matrix().textContent).toContain('共同统计区间（1 分钟）：2026-11-05 02:59:00.000 UTC');
  expect(matrix().textContent).toContain('面积按同一 1 分钟区间');
 });
 it('keeps the selected window and quotes but no previous trades during cooldown',async()=>{
  const fetcher=await start();fetcher.mockImplementation(async()=>Response.json({...reply('1m'),trade_snapshot:null,status:{...reply().status,state:'stale',error_code:'source_cooldown'}},{status:503}));
  fireEvent.click(screen.getByRole('radio',{name:'1 分钟'}));await tick();expect(evidence()).toHaveLength(0);
  expect(screen.getByRole('heading',{name:'1 分钟来源买卖标记成交额差 · USD'})).toBeTruthy();expect(screen.getByText(/当前选择 1 分钟/)).toBeTruthy();expect(screen.getByRole('checkbox',{name:'ADA/USD'})).toBeTruthy();
 });
 it('keeps the selected window without previous trades after network failure',async()=>{
  const fetcher=await start();fetcher.mockRejectedValue(new Error('offline'));fireEvent.click(screen.getByRole('radio',{name:'1 分钟'}));await tick();expect(evidence()).toHaveLength(0);expect(screen.getByRole('heading',{name:'1 分钟来源买卖标记成交额差 · USD'})).toBeTruthy();expect(screen.getByRole('checkbox',{name:'ADA/USD'})).toBeTruthy();
 });
 it.each(['missing identity','wrong duration'])('rejects %s on an explicit timeframe',async failure=>{
  const fetcher=await start();const result=reply('1m');if(failure==='missing identity')delete result.requested_window;else result.trade_snapshot=reply().trade_snapshot;
  fetcher.mockImplementation(async()=>Response.json(result));fireEvent.click(screen.getByRole('radio',{name:'1 分钟'}));await tick();expect(evidence()).toHaveLength(0);expect(screen.getByText('响应数据未通过校验，已清空浏览器行情。')).toBeTruthy();
 });
 it('ignores stale in-flight responses across a window round trip without aborting acquisition',async()=>{
  const fetcher=await start();let resolve!:(r:Response)=>void;fetcher.mockImplementation(()=>new Promise<Response>(done=>{resolve=done;}));fireEvent.click(screen.getByRole('button',{name:'检查更新'}));
  const signal=fetcher.mock.calls[1][1]?.signal;fireEvent.click(screen.getByRole('radio',{name:'1 分钟'}));fireEvent.click(screen.getByRole('radio',{name:'5 分钟'}));expect(signal?.aborted).toBe(false);expect(fetcher).toHaveBeenCalledTimes(2);expect(evidence()).toHaveLength(0);
  await act(async()=>resolve(Response.json(reply())));expect(evidence()).toHaveLength(0);
  fetcher.mockImplementation(async()=>Response.json(reply()));await act(()=>vi.advanceTimersByTimeAsync(60_000));expect(evidence()).toHaveLength(3);expect(fetcher.mock.calls[2][0]).toBe('/api/v1/crypto/kraken/snapshot');
 });
 it('retains current timeframe when pairs change and combines query scope',async()=>{
  const fetcher=await start();fetcher.mockImplementation(async()=>Response.json({...reply('1m'),trade_snapshot:null}));fireEvent.click(screen.getByRole('radio',{name:'1 分钟'}));await tick();
  fireEvent.click(screen.getByRole('button',{name:'清空待选'}));fireEvent.click(screen.getByRole('checkbox',{name:'ADA/USD'}));
  fetcher.mockImplementation(async()=>Response.json({...reply('1m'),requested_pairs:['ADA/USD'],trade_snapshot:null}));fireEvent.click(screen.getByRole('button',{name:'应用选择'}));await tick();expect(fetcher.mock.calls[2][0]).toBe('/api/v1/crypto/kraken/snapshot?pairs=ADA%2FUSD&window=1m');expect(evidence()).toHaveLength(0);
 });
 it('honors a previous-window permission denial and stops polling',async()=>{
  const fetcher=await start();let resolve!:(r:Response)=>void;fetcher.mockImplementation(()=>new Promise<Response>(done=>{resolve=done;}));fireEvent.click(screen.getByRole('button',{name:'检查更新'}));fireEvent.click(screen.getByRole('radio',{name:'1 分钟'}));await act(async()=>resolve(new Response('denied',{status:403})));
  expect(screen.getByText('展示权限已失效')).toBeTruthy();expect((screen.getByRole('group',{name:'成交统计区间'}) as HTMLFieldSetElement).disabled).toBe(true);await act(()=>vi.advanceTimersByTimeAsync(180_000));expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('shows pagination counts while keeping final capped evidence unknown and uncolored',()=>{
  const data=reply('1m').trade_snapshot!;data.page_limit=2;data.rows=[{...data.rows[0],page_count:2,last_page_count:1000,returned_count:2000,trade_count:2000,coverage:'capped_response',buy_notional_usd:null,sell_notional_usd:null,imbalance_usd:null,imbalance_pct:null}];render(<KrakenTradeMatrix snapshot={data} timeframe="1m"/>);
  expect(matrix().textContent).toContain('已获取 2 页 / 最多 2 页；累计返回 2000 笔；每页上限 1000 笔；末页返回 1000 笔');expect(matrix().textContent).toContain('区间覆盖未知');expect(matrix().querySelector('g[data-id]')).toBeNull();expect(matrix().querySelector('[data-id]')?.getAttribute('data-color')).toBe('missing');
 });
});
