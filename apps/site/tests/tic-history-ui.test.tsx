// @vitest-environment jsdom
import React from 'react';
import {afterEach, describe, it, expect, vi} from 'vitest';
import {render, screen, waitFor, fireEvent, cleanup} from '@testing-library/react';
import TicHistory from '../components/atlas/TicHistory';
import {trailingMonths} from '../lib/tic/history';
const HISTORY_MONTHS = trailingMonths('2026-08');
const fixture = {
 version: 'a'.repeat(20), concept: 'reported_net_transactions', scope: 'foreign_residents_us_equity_including_fund_shares',
 aggregation: 'published_grand_total', source_field: 'for_lt_eqty_net',
 source_url: 'https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt_table1.txt',
 source_unit: 'USD millions', output_unit: 'USD', frequency: 'monthly', is_live: false,
 start_period: '2025-09', end_period: '2026-08', retrieved_at: '2026-11-04T12:00:00Z', raw_sha256: 'b'.repeat(64),
 vintage_note: 'Single retrieved source vintage; historical observations may be revised.', observation_release_dates: null,
 observations: HISTORY_MONTHS.map((period, i) => ({period, net_foreign_purchases_usd: i === 2 ? null : i === 3 ? 0 : i % 2 ? -2000000 : 1000000, state: i === 2 ? 'not_reported' : 'reported'})),
};
function response(data: unknown, status = 200, state = 'available') {
 return {ok: status < 300, status, headers: new Headers({'ETag': '"history-test"', 'X-Data-Status': state}), json: async () => data};
}
afterEach(() => {cleanup(); vi.unstubAllGlobals();});
describe('foreign-resident US equity historical chart', () => {
 it('renders signed bars, zero, missing gap and accessible values without general-market claims', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => response(fixture)));
  const {container} = render(<TicHistory/>);
  await screen.findByRole('img', {name: /境外居民对美国股权/});
  expect(container.querySelectorAll('rect[data-sign]')).toHaveLength(10);
  expect(container.querySelectorAll('.history-zero')).toHaveLength(1);
  expect(container.querySelector('[data-period="2025-11"]')?.getAttribute('data-state')).toBe('not_reported');
  expect(screen.getByText(/不是美国全市场资金流/)).toBeTruthy();
  fireEvent.click(screen.getByText('历史数值与来源证据'));
  expect(screen.getByRole('table', {name: '美国股权境外净交易历史数值'})).toBeTruthy();
  expect(container.querySelectorAll('tbody tr')).toHaveLength(12);
  expect(screen.getByText('未报告，不是零')).toBeTruthy();
 });
 it('shows actual rolling bounds after refresh without retaining the old August caption',async()=>{
  let newer=false;
  const advanced={...fixture,start_period:'2025-10',end_period:'2026-09',observations:trailingMonths('2026-09').map(period=>({period,state:'reported',net_foreign_purchases_usd:1000000}))};
  vi.stubGlobal('fetch',vi.fn(async()=>response(newer?advanced:fixture)));
  render(<TicHistory/>);await screen.findByText(/2025-09 至 2026-08/);newer=true;
  fireEvent.click(screen.getByRole('button',{name:'刷新美国历史数据'}));await screen.findByText(/2025-10 至 2026-09/);
  expect(screen.queryByText(/2025-09 至 2026-08/)).toBeNull();expect(screen.queryByText(/窗口固定/)).toBeNull();
 });
 it('reuses 304 with a visible stale warning, clears invalid data, and recovers', async () => {
  let step = 0;
  vi.stubGlobal('fetch', vi.fn(async (_url, init: RequestInit) => {
   if (step === 1) {expect(init.headers).toEqual({'If-None-Match': '"history-test"'}); return response(null, 304, 'stale');}
   return response(step === 2 ? {...fixture, output_unit: 'USD millions'} : fixture);
  }));
  const {container} = render(<TicHistory/>);
  await screen.findByRole('img'); step = 1;
  fireEvent.click(screen.getByRole('button', {name: '刷新美国历史数据'}));
  await screen.findByText(/显示最后核验快照/);
  expect(container.querySelectorAll('rect')).toHaveLength(10); step = 2;
  fireEvent.click(screen.getByRole('button', {name: '刷新美国历史数据'}));
  await screen.findByText(/历史快照未通过核验/); expect(screen.queryByRole('img')).toBeNull();
  step = 3; fireEvent.click(screen.getByRole('button', {name: '刷新美国历史数据'}));
  await screen.findByRole('img'); expect(screen.queryByText(/历史快照未通过核验/)).toBeNull();
 });
 it('never manufactures values on unavailable response', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => response({}, 503)));
  render(<TicHistory/>); await screen.findByText(/HTTP 503/);
  expect(screen.queryByRole('img')).toBeNull(); expect(screen.queryByRole('table')).toBeNull();
 });
 it('serializes repeated clicks and aborts the active request on unmount', async () => {
  const pending: {resolve: (value: unknown) => void; signal: AbortSignal}[] = [];
  vi.stubGlobal('fetch', vi.fn((_url, init: RequestInit) => new Promise(resolve => pending.push({resolve, signal: init.signal as AbortSignal}))));
  const mounted = render(<TicHistory/>);
  await waitFor(() => expect(pending).toHaveLength(1));
  fireEvent.click(screen.getByRole('button', {name: '刷新美国历史数据'}));
  expect(pending).toHaveLength(1);
  expect(pending[0].signal.aborted).toBe(false);
  mounted.unmount(); expect(pending[0].signal.aborted).toBe(true);
  pending[0].resolve(response(fixture));
 });
 it('clears delayed startup and polling on immediate unmount', () => {
  vi.useFakeTimers(); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  try {const mounted = render(<TicHistory/>); mounted.unmount(); vi.runOnlyPendingTimers(); expect(fetcher).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);}
  finally {vi.useRealTimers();}
 });
});
