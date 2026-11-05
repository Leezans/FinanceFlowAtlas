// @vitest-environment jsdom
import React from 'react';
import {afterEach, describe, expect, it} from 'vitest';
import {cleanup, render} from '@testing-library/react';
import KrakenTradeMatrix from '../components/crypto/KrakenTradeMatrix';
import {tradeMatrixGroups} from '../components/crypto/trade-matrix';
import {parseKrakenTrades, tradeSnapshot} from '../lib/crypto/trades';
import {tradeSnapshotSchema} from '../lib/crypto/trade-validation';

const end = Date.parse('2026-11-05T03:00:00.000Z'), start = end - 300_000;

/** Synthetic trades exercise the same exact-decimal and validation paths as source evidence. */
function evidence(base: 'BTC' | 'EUR', direction: 'b' | 's' | null, tiny = false) {
  const pair = {pair: `${base}/USD`, source_pair: base === 'BTC' ? 'XXBTZUSD' : 'ZEURZUSD', base, quote: 'USD' as const};
  const trades: unknown[][] = [
    ['1', '1000000', (start + 1000) / 1000, 'b', 'l', '', 1],
    ['1', '1000000', (start + 2000) / 1000, 's', 'l', '', 2],
  ];
  if (direction) trades.push([tiny ? '0.000000000001' : '1', tiny ? '0.000000000001' : '1', (start + 3000) / 1000, direction, 'l', '', 3]);
  const row = parseKrakenTrades({error: [], result: {[pair.source_pair]: trades, last: '123'}}, pair, start, end, end);
  return tradeSnapshotSchema.parse(tradeSnapshot([row], end, end, [pair.pair]));
}

afterEach(cleanup);

describe('nonzero trade imbalance direction below percentage precision', () => {
  it.each([
    ['BTC', 'b', 'positive-1', '+'], ['BTC', 's', 'negative-1', '−'],
    ['EUR', 'b', 'positive-1', '+'], ['EUR', 's', 'negative-1', '−'],
  ] as const)('preserves %s %s direction without relabeling it as reported zero', (base, direction, color, sign) => {
    const snapshot = evidence(base, direction), row = snapshot.rows[0];
    // The API/cache contract deliberately truncates this field to four decimals.
    expect(row.imbalance_pct).toBe(0);
    expect(row.imbalance_usd).toBe(direction === 'b' ? '1' : '-1');
    const item = tradeMatrixGroups(snapshot)[0].items[0];
    expect(Math.sign(item.colorValue!)).toBe(direction === 'b' ? 1 : -1);
    expect(item.detail).toContain(`${sign}<0.0001%`);
    const {container} = render(<KrakenTradeMatrix snapshot={snapshot} selected={[row.pair]}/>);
    expect(container.querySelector('svg [data-id]')?.getAttribute('data-color')).toBe(color);
    expect(container.querySelector('svg [data-id]')?.getAttribute('data-share')).toBe('1');
    expect(row.imbalance_pct).toBe(0);
  });

  it.each(['b', 's'] as const)('preserves %s direction at the exact notional precision floor', direction => {
    const snapshot = evidence('BTC', direction, true), item = tradeMatrixGroups(snapshot)[0].items[0];
    expect(snapshot.rows[0].imbalance_pct).toBe(0);
    expect(item.amount?.value).toBe(direction === 'b' ? 1e-24 : -1e-24);
    expect(Math.sign(item.colorValue!)).toBe(direction === 'b' ? 1 : -1);
    expect(Math.abs(item.colorValue!)).toBeLessThan(0.0001);
  });

  it('keeps a genuine balanced amount neutral and area-free', () => {
    const snapshot = evidence('BTC', null), item = tradeMatrixGroups(snapshot)[0].items[0];
    expect(item.amount?.value).toBe(0);
    expect(item.colorValue).toBe(0);
    expect(item.detail).toContain('买卖差额比 0%');
    const {container} = render(<KrakenTradeMatrix snapshot={snapshot} selected={['BTC/USD']}/>);
    expect(container.querySelector('svg [data-id]')).toBeNull();
    expect(container.querySelector('details [data-id]')?.getAttribute('data-color')).toBe('zero');
  });
});
