// @vitest-environment jsdom
import React from 'react';
import {afterEach,describe,expect,it} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import KrakenTradeMatrix from '../components/crypto/KrakenTradeMatrix';
import {tradeMatrixGroups,visibleTradeSnapshot} from '../components/crypto/trade-matrix';
import {MAX_CACHE_AGE_MS} from '../lib/crypto/kraken';
import {KRAKEN_TRADES_DOCS,KRAKEN_TAKER_DOCS,type KrakenTradeSnapshot} from '../lib/crypto/trades';

const at=Date.parse('2026-11-05T03:00:00.000Z'),iso=new Date(at).toISOString();
/** Deliberately synthetic executed notional values, never live provider evidence. */
function snapshot():KrakenTradeSnapshot{return {
 schema:'kraken-trades/1',venue:'Kraken',coverage:'selected_usd_pairs_one_venue',window_started_at:new Date(at-300_000).toISOString(),window_ended_at:iso,fetched_at:iso,window_ms:300_000,trade_limit:1000,net_capital_flow:null,missing_pairs:['SOL/USD'],
 rows:[{source_pair:'XXBTZUSD',pair:'BTC/USD',base:'BTC',quote:'USD',coverage:'uncapped_response',returned_count:3,trade_count:2,excluded_after_window_count:1,first_trade_at:new Date(at-240_000).toISOString(),last_trade_at:new Date(at-1_000).toISOString(),fetched_at:iso,cursor:'123',buy_notional_usd:'20.123456789012345678901234',sell_notional_usd:'10.123456789012345678901234',imbalance_usd:'10',imbalance_pct:33.0612},
 {source_pair:'XETHZUSD',pair:'ETH/USD',base:'ETH',quote:'USD',coverage:'capped_response',returned_count:1000,trade_count:1000,excluded_after_window_count:0,first_trade_at:new Date(at-240_000).toISOString(),last_trade_at:new Date(at-1_000).toISOString(),fetched_at:iso,cursor:'456',buy_notional_usd:null,sell_notional_usd:null,imbalance_usd:null,imbalance_pct:null}],
};}
afterEach(cleanup);
describe('bounded Kraken trade matrix',()=>{
 it('keeps equal area, source normalized color and capped rows unknown rather than zero',()=>{
  const items=tradeMatrixGroups(snapshot())[0].items;
  expect(items.map(item=>item.weight)).toEqual([1,1]);expect(items.map(item=>item.colorValue)).toEqual([33.0612,null]);
  expect(items[0].displayValue).toBe('10 USD');expect(items[1].displayValue).toBe('覆盖不完整 · 金额不展示');expect(tradeMatrixGroups(null)).toEqual([]);
 });
 it('reuses shared readable-grid rendering at fixed ±100%, with exact details and source links',()=>{
  const {container}=render(<KrakenTradeMatrix snapshot={snapshot()}/>);
  expect(container.querySelector('[data-layout="readable-grid"]')).toBeTruthy();
  expect(container.querySelector('[data-id="BTC/USD"]')?.getAttribute('data-color')).toBe('positive-1');
  expect(container.querySelector('[data-id="ETH/USD"]')?.getAttribute('data-color')).toBe('missing');
  expect(container.querySelectorAll('[data-id]')).toHaveLength(2);
  fireEvent.click(screen.getByText('逐交易对成交额、时间与覆盖明细'));
  expect(screen.getByText('20.123456789012345678901234 USD')).toBeTruthy();expect(screen.getByText('10.123456789012345678901234 USD')).toBeTruthy();
  expect(screen.getByText(/官方在线 USD 现货目录未纳入：SOL\/USD/)).toBeTruthy();
  expect(screen.getByText(/（不含）/)).toBeTruthy();expect(screen.getByText(/每笔成交始终同时存在买方和卖方/)).toBeTruthy();
  expect(screen.getByText(/返回条数未触及上限：仅统计来源返回的成交/)).toBeTruthy();
  expect(screen.getByText(/REST b\/s 的成交发起方约定未在本页所引 REST 文档中明确/)).toBeTruthy();
  expect(screen.getByRole('heading',{name:'5 分钟来源买卖标记成交额差 · USD'})).toBeTruthy();
  expect(screen.getByText('买标记成交额')).toBeTruthy();expect(screen.getByText('卖标记成交额')).toBeTruthy();
  expect(screen.getByRole('link',{name:'Kraken 官方逐笔成交说明 ↗'}).getAttribute('href')).toBe(KRAKEN_TRADES_DOCS);
  expect(screen.getByRole('link',{name:'对照 WebSocket 字段（非本页采集） ↗'}).getAttribute('href')).toBe(KRAKEN_TAKER_DOCS);
 });
 it('distinguishes genuine zero turnover from missing capped evidence without a directional color',()=>{
  const data=snapshot();data.rows=[{...data.rows[0],returned_count:0,trade_count:0,excluded_after_window_count:0,first_trade_at:null,last_trade_at:null,buy_notional_usd:'0',sell_notional_usd:'0',imbalance_usd:'0',imbalance_pct:null}];
  const item=tradeMatrixGroups(data)[0].items[0];expect(item.displayValue).toBe('0 USD');expect(item.colorValue).toBeNull();expect(item.detail).toContain('无可计算成交额');
 });
 it('removes matrix amounts and details on invalidation, including an open inspector',()=>{
  const {container,rerender}=render(<KrakenTradeMatrix snapshot={snapshot()}/>);
  fireEvent.focus(container.querySelector('[data-id="BTC/USD"]')!);
  rerender(<KrakenTradeMatrix snapshot={null}/>);
  expect(container.querySelectorAll('[data-id]')).toHaveLength(0);expect(screen.queryByText('20.123456789012345678901234 USD')).toBeNull();expect(screen.queryByText('10 USD')).toBeNull();
  expect(screen.getByText('逐笔成交证据暂不可用')).toBeTruthy();
 });
 it('gates by quote visibility and every acquisition clock without rolling the stored window',()=>{
  const data=snapshot();expect(visibleTradeSnapshot(data,true,at+1)).toBe(data);
  expect(visibleTradeSnapshot(data,false,at+1)).toBeNull();expect(visibleTradeSnapshot(undefined,true,at)).toBeNull();
  expect(visibleTradeSnapshot(data,true,at-1)).toBeNull();expect(visibleTradeSnapshot(data,true,at+MAX_CACHE_AGE_MS+1)).toBeNull();
  data.rows[0].fetched_at=new Date(at-1).toISOString();expect(visibleTradeSnapshot(data,true,at+MAX_CACHE_AGE_MS)).toBeNull();
  expect(data.window_ended_at).toBe(iso);
 });
});
