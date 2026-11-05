// @vitest-environment jsdom
import React from 'react';
import {afterEach,describe,expect,it} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {fxReferenceGroups} from '../components/forex/matrix';
import {cryptoColorMaximum,cryptoMatrixGroups,formatCryptoNumber,priceVwapDeviation} from '../components/crypto/matrix';
import KrakenMatrix from '../components/crypto/KrakenMatrix';
import {parseKrakenTicker,type KrakenRow} from '../lib/crypto/kraken';
import {fxPayload} from './fx-fixture';

// Synthetic source evidence only. These are deliberately not market quotes.
const at='2026-11-05T03:00:00.000Z';
const snapshot=()=>parseKrakenTicker({error:[],result:{
 XXBTZUSD:{c:['12.50000000','1'],v:['999','3.125'],p:['999','10.0000'],t:[999,8]},
 XETHZUSD:{c:['1.5000','1'],v:['999','0'],p:['999','2.0000'],t:[999,0]},
}},at,at);
afterEach(cleanup);

describe('FX reference matrix adapter',()=>{
 it('keeps source precision, equal area and neutral color for incomparable currency denominations',()=>{
  const groups=fxReferenceGroups(fxPayload().snapshot);
  expect(groups[0].items).toHaveLength(3);
  expect(groups[0].items.find(item=>item.id==='USD')?.displayValue).toBe('2.0000 USD');
  expect(groups[0].items.every(item=>item.weight===1&&item.colorValue===null)).toBe(true);
  expect(groups[0].items.some(item=>item.id==='EUR')).toBe(false);
 });
 it('filters observed currencies by code or name without introducing missing values',()=>{
  expect(fxReferenceGroups(fxPayload().snapshot,'人民币')[0].items.map(item=>item.id)).toEqual(['CNY']);
  expect(fxReferenceGroups(fxPayload().snapshot,' usd ')[0].items[0].id).toBe('USD');
  expect(fxReferenceGroups(fxPayload().snapshot,'not-covered')).toEqual([]);
  expect(fxReferenceGroups(null)).toEqual([]);
 });
});

describe('Kraken metric matrix adapter',()=>{
 it('colors only the explicitly calculated price/VWAP deviation, not prices or flows',()=>{
  const data=snapshot(),items=cryptoMatrixGroups(data,'last_price_usd')[0].items;
  expect(items.map(item=>item.colorValue)).toEqual([25,-25]);
  expect(items.map(item=>item.weight)).toEqual([1,1]);
  expect(cryptoColorMaximum(data)).toBe(25);
  expect(items[0].detail).toContain('相对 24h 成交均价 +25%');
  expect(cryptoMatrixGroups(data,'vwap_usd_24h')[0].items.every(item=>item.colorValue===null)).toBe(true);
 });
 it('preserves native volume units and reported zero without fabricating an aggregate',()=>{
  const data=snapshot();
  expect(cryptoMatrixGroups(data,'volume_base_24h')[0].items.map(item=>item.displayValue)).toEqual(['3.125 BTC','0 ETH']);
  expect(cryptoMatrixGroups(data,'trades_24h')[0].items.map(item=>item.displayValue)).toEqual(['8 笔','0 笔']);
  expect(cryptoMatrixGroups(null,'last_price_usd')).toEqual([]);
  expect(formatCryptoNumber('99999999999999.123456789012')).toBe('99,999,999,999,999.123456789012');
 });
 it('does not convert invalid or nonfinite comparison values into zero',()=>{
  const row=snapshot().rows[0];
  for(const value of ['0','NaN','Infinity','-1'])expect(priceVwapDeviation({...row,vwap_usd_24h:value} as KrakenRow)).toBeNull();
  expect(priceVwapDeviation({...row,last_price_usd:'10',vwap_usd_24h:'10'})).toBe(0);
 });
 it('switches every original metric in the same matrix and clears all tiles when evidence disappears',()=>{
  const {container,rerender}=render(<KrakenMatrix snapshot={snapshot()}/>);
  expect(container.querySelectorAll('[data-id]')).toHaveLength(2);
  expect(container.querySelector('[data-id="BTC/USD"]')?.getAttribute('data-color')).toBe('positive-3');
  expect(container.querySelector('[data-id="ETH/USD"]')?.getAttribute('data-color')).toBe('negative-3');
  fireEvent.click(screen.getByRole('button',{name:'24h 成交量'}));
  expect(screen.getByText('3.125 BTC')).toBeTruthy();expect(screen.getByText('0 ETH')).toBeTruthy();
  expect(container.querySelectorAll('[data-color=missing]')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button',{name:'24h 成交笔数'}));expect(screen.getByText('8 笔')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'24h 成交均价'}));expect(screen.getByText('10 USD')).toBeTruthy();
  expect(screen.queryByRole('table')).toBeNull();
  rerender(<KrakenMatrix snapshot={null}/>);expect(container.querySelectorAll('[data-id]')).toHaveLength(0);
 });
});
