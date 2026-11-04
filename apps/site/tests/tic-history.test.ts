import {describe, it, expect} from 'vitest';
import {normalizeHistory, historySchema, HISTORY_MONTHS} from '../lib/tic/history';
import {sample} from './tic-fixture';
const retrieved = '2026-11-04T12:00:00Z';
const totals = () => HISTORY_MONTHS.map((month, i) => `Grand Total\t99996\t${month}\t${i === 4 ? '-9' : i === 3 ? '0' : String(i + 1)}`);
describe('bounded Treasury Grand Total history', () => {
 it('keeps the 12 calendar months, signs, exact units and one source vintage', async () => {
  const data = await normalizeHistory(sample(totals().reverse()), retrieved);
  expect(data.observations.map(r => r.period)).toEqual(HISTORY_MONTHS);
  expect(data.observations[4].net_foreign_purchases_usd).toBe(-9000000);
  expect(data.observations[3].net_foreign_purchases_usd).toBe(0);
  expect(data.retrieved_at).toBe(retrieved);
  expect(data.observation_release_dates).toBeNull();
  expect(data.scope).toBe('foreign_residents_us_equity_including_fund_shares');
 });
 it('never replaces Grand Total with a sum of countries or regional aggregates', async () => {
  const data = await normalizeHistory(sample([...totals(), 'Japan\t42609\t2026-08\t999999', 'Europe\t99999\t2026-08\t45678']));
  expect(data.observations[11].net_foreign_purchases_usd).toBe(12000000);
 });
 it('keeps omitted, blank and n.a. months missing without collapsing the window', async () => {
  const rows = totals().slice(1); rows[0] = rows[0].replace(/\t\d+$/, '\t'); rows[1] = rows[1].replace(/\t\d+$/, '\tn.a.');
  const data = await normalizeHistory(sample(rows));
  expect(data.observations.slice(0, 3).every(r => r.state === 'not_reported' && r.net_foreign_purchases_usd === null)).toBe(true);
  expect(data.observations).toHaveLength(12);
 });
 it('does not pull outside-month values into missing months, including pre-series rows', async () => {
  const data = await normalizeHistory(sample(['Grand Total\t99996\t2022-12\t100', 'Grand Total\t99996\t2026-09\t500', 'Grand Total\t99996\t2026-08\tn.a.', totals()[0]]));
  expect(data.observations.filter(r => r.state === 'reported')).toHaveLength(1);
  expect(data.observations[11].net_foreign_purchases_usd).toBeNull();
 });
 it('rejects an absent verified endpoint, but retains source-declared missingness', async () => {
  await expect(normalizeHistory(sample(totals().slice(0, -1)))).rejects.toThrow('endpoint month is absent');
  const data = await normalizeHistory(sample([...totals().slice(0, -1), 'Grand Total\t99996\t2026-08\tn.a.']));
  expect(data.observations[11].state).toBe('not_reported');
 });
 it('normalizes negative zero to a reported zero', async () => {
  const data = await normalizeHistory(sample(['Grand Total\t99996\t2026-08\t-0']));
  expect(data.observations[11]).toEqual({period: '2026-08', net_foreign_purchases_usd: 0, state: 'reported'});
  expect(Object.is(data.observations[11].net_foreign_purchases_usd, -0)).toBe(false);
 });
 it.each(['Grand Total\t99996\t2026-08\t1.5', 'Grand Total\t99996\t2026-08\tNaN', 'Grand Total\t99996\t2026-08\t99999999999999', 'Not Total\t99996\t2026-08\t1', 'Grand Total\t99990\t2026-08\t1', 'Grand Total\t99996\t2026-13\t1'])(
  'rejects malformed or renamed totals: %s', async row => {await expect(normalizeHistory(sample([row]))).rejects.toThrow();});
 it('rejects duplicates, truncated responses, HTML, all-missing and unknown units', async () => {
  await expect(normalizeHistory(sample([...totals(), totals()[0]]))).rejects.toThrow('duplicate');
  await expect(normalizeHistory(sample(totals()).slice(0, -12))).rejects.toThrow();
  await expect(normalizeHistory(new TextEncoder().encode('<html>source page</html>'))).rejects.toThrow();
  await expect(normalizeHistory(sample(['Grand Total\t99996\t2026-08\tn.a.']))).rejects.toThrow();
  await expect(normalizeHistory(new TextEncoder().encode(new TextDecoder().decode(sample(totals())).replace('Millions of dollars', 'Dollars')))).rejects.toThrow();
 });
 it('rejects invalid cached periods, unit, scope, missing states and unsafe numbers', async () => {
  const data = await normalizeHistory(sample(totals()));
  expect(() => historySchema.parse({...data, scope: 'us_market_inflows'})).toThrow();
  expect(() => historySchema.parse({...data, output_unit: 'USD billions'})).toThrow();
  for (const changes of [{period: '2026-08'}, {net_foreign_purchases_usd: null}, {net_foreign_purchases_usd: 1e30}]) {
   expect(() => historySchema.parse({...data, observations: [{...data.observations[0], ...changes}, ...data.observations.slice(1)]})).toThrow();
  }
 });
 it('changes version with source revisions, not just the chart month', async () => {
  const first = await normalizeHistory(sample(totals()));
  const revised = await normalizeHistory(sample([...totals(), 'Japan\t42609\t2026-08\t2']));
  expect(revised.version).not.toBe(first.version);
  expect(revised.raw_sha256).not.toBe(first.raw_sha256);
 });
});
