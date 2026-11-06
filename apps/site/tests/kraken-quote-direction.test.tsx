// @vitest-environment jsdom
import React from 'react';
import {afterEach, describe, expect, it} from 'vitest';
import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import KrakenMatrix from '../components/crypto/KrakenMatrix';
import {cryptoColorMaximum, cryptoMatrixGroups, formatDeviation, priceVwapDeviation} from '../components/crypto/matrix';
import {krakenSnapshotSchema} from '../lib/crypto/validation';
import {parseTicker} from './kraken-fixture';

const at = '2026-11-06T03:00:00.000Z';
/** Synthetic decimals pass the real ticker and snapshot validation boundaries. */
function evidence(price: string, vwap: string) {
  const ticker = (last: string, average: string) => ({c: [last, '1'], v: ['9', '2'], p: ['9', average], t: [9, 2]});
  return krakenSnapshotSchema.parse(parseTicker({error: [], result: {
    XXBTZUSD: ticker(price, vwap), XETHZUSD: ticker('125', '100'),
  }}, at, at));
}

afterEach(cleanup);

describe('exact decimal quote direction', () => {
  it.each([
    ['1000000.000000000001', '1000000', 1, '+'],
    ['1000000', '1000000.000000000001', -1, '−'],
    ['999999999999999.999999999999', '999999999999999.999999999998', 1, '+'],
    ['999999999999999.999999999998', '999999999999999.999999999999', -1, '−'],
  ] as const)('preserves the direction of %s relative to %s', (price, vwap, sign, label) => {
    expect(Number(price)).toBe(Number(vwap)); // Reproduces the old cancellation.
    const snapshot = evidence(price, vwap), row = snapshot.rows[0];
    const deviation = priceVwapDeviation(row)!;
    expect(Math.sign(deviation)).toBe(sign);
    expect(Math.abs(deviation)).toBeGreaterThan(0);
    expect(Math.abs(deviation)).toBeLessThan(0.0001);
    expect(formatDeviation(deviation)).toBe(`${label}<0.0001%`);
    const item = cryptoMatrixGroups(snapshot, 'last_price_usd')[0].items[0];
    expect(item.colorValue).toBe(deviation);
    expect(item.detail).toContain(`${label}<0.0001%`);
    expect(item.amount).toBeUndefined();
    expect(row.last_price_usd).toBe(price);
    expect(row.vwap_usd_24h).toBe(vwap);
  });

  it.each([
    ['0.000000000002', '0.000000000001', 100],
    ['0.000000000001', '0.000000000002', -50],
    ['12.500000000000', '10', 25],
    ['10', '12.5', -20],
    ['1000000.000000000001', '1000000.000000000001', 0],
    ['10.000000000000', '10', 0],
  ] as const)('keeps the correct ratio for %s / %s', (price, vwap, expected) => {
    expect(priceVwapDeviation(evidence(price, vwap).rows[0])).toBe(expected);
  });

  it.each(['0', 'NaN', 'Infinity', '-1', '+1', '1e3', '01', ' 1', '.1', '0.0000000000001', '1000000000000000'])('does not coerce non-contract decimal %s into a valid comparison', invalid => {
    const row = evidence('12.5', '10').rows[0];
    expect(priceVwapDeviation({...row, last_price_usd: invalid})).toBeNull();
    expect(priceVwapDeviation({...row, vwap_usd_24h: invalid})).toBeNull();
  });

  it('keeps finite nonzero comparisons at both supported decimal extremes', () => {
    for (const [price, vwap, sign] of [
      ['999999999999999.999999999999', '0.000000000001', 1],
      ['0.000000000001', '999999999999999.999999999999', -1],
    ] as const) {
      const value = priceVwapDeviation(evidence(price, vwap).rows[0])!;
      expect(Number.isFinite(value)).toBe(true);
      expect(Math.sign(value)).toBe(sign);
    }
  });

  it.each([
    ['1000000.000000000001', '1000000', 'positive-1', '+'],
    ['1000000', '1000000.000000000001', 'negative-1', '−'],
  ])('renders the exact direction through search, metric switches and refresh', (price, vwap, color, sign) => {
    const snapshot = evidence(price, vwap);
    expect(cryptoColorMaximum(snapshot)).toBe(25);
    const {container, rerender} = render(<KrakenMatrix snapshot={snapshot}/>);
    const colorOfBtc = () => container.querySelector('[data-id="BTC/USD"]')?.getAttribute('data-color');
    expect(colorOfBtc()).toBe(color);
    expect(screen.getByText(new RegExp(`相对 24h 成交均价 \\${sign}<0.0001%`))).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', {name: '查找加密货币交易对'}), {target: {value: 'BTC'}});
    expect(colorOfBtc()).toBe(color); // Search must retain the full-snapshot scale.
    fireEvent.click(screen.getByRole('button', {name: '24h 成交均价'}));
    expect(colorOfBtc()).toBe('missing');
    fireEvent.click(screen.getByRole('button', {name: '最近成交价格'}));
    expect(colorOfBtc()).toBe(color);
    rerender(<KrakenMatrix snapshot={evidence('10', '10.000000000000')}/>);
    expect(colorOfBtc()).toBe('zero');
    rerender(<KrakenMatrix snapshot={null}/>);
    expect(colorOfBtc()).toBeUndefined();
  });
});
