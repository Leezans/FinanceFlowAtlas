import {describe, it, expect} from 'vitest';
import {normalize} from '../lib/tic/adapter';
import {normalizeHistory, historySchema, trailingMonths} from '../lib/tic/history';
import {latestPeriod, readTable} from '../lib/tic/table';
import {sample, valid} from './tic-fixture';
const retrieved = '2026-11-05T03:00:00Z';
const month = (period: string, value = '7') => [`Japan\t42609\t${period}\t${value}`, `Grand Total\t99996\t${period}\t${value}`];
describe('automatic official TIC observation discovery', () => {
 it('selects a newer unsorted source month, preserving source semantics and unknown release dates', async () => {
  const raw = sample([...month('2026-07'), ...month('2026-09', '-7'), ...month('2026-08')]);
  const data = await normalize(raw, undefined, retrieved);
  expect(data.period).toBe('2026-09'); expect(data.country_flows[0].net_foreign_purchases_usd).toBe(-7000000);
  expect(data.observation_release_date).toBeNull(); expect(data.release_url).toBeNull();
  expect(data.source_revision_published_at).toBeNull(); expect(data.is_live).toBe(false);
  expect(data.frequency).toBe('monthly'); expect(data.retrieved_at).toBe(retrieved);
  const history = await normalizeHistory(raw, retrieved);
  expect(history.end_period).toBe(data.period); expect(history.start_period).toBe('2025-10');
  expect(history.observations.at(-1)?.net_foreign_purchases_usd).toBe(data.grand_total_net_foreign_purchases_usd);
 });
 it('does not advance the month because time passed, and keeps explicit historical selection', async () => {
  expect((await normalize(valid(), undefined, '2027-01-04T00:00:00Z')).period).toBe('2026-08');
  const raw = sample([...month('2026-08'), ...month('2026-09')]);
  expect((await normalize(raw, '2026-08', retrieved)).period).toBe('2026-08');
 });
 it.each(['2026-11', '2026-12', '2099-01'])('rejects incomplete-current/future source months: %s', async period => {
  const raw = sample([...month('2026-08'), ...month(period)]);
  await expect(normalize(raw, undefined, retrieved)).rejects.toThrow('current or future');
  await expect(normalizeHistory(raw, retrieved)).rejects.toThrow('current or future');
  await expect(normalize(raw, period, retrieved)).rejects.toThrow('Unsupported');
 });
 it.each(['', 'n.a.', '1.2', 'NaN', '99999999999999999'])('rejects invalid latest totals rather than silently returning the prior month: %s', async value => {
  const raw = sample([...month('2026-08'), ...month('2026-09', value)]);
  await expect(normalize(raw, undefined, retrieved)).rejects.toThrow('no valid published');
 });
 it('rejects newer country-only rows, duplicate totals, and new months without country observations', async () => {
  await expect(normalize(sample([...month('2026-08'), 'Japan\t42609\t2026-09\t1']), undefined, retrieved)).rejects.toThrow('one valid Grand Total');
  await expect(normalize(sample([...month('2026-09'), 'Grand Total\t99996\t2026-09\t8']), undefined, retrieved)).rejects.toThrow();
  await expect(normalize(sample([...month('2026-08'), 'Grand Total\t99996\t2026-09\t8']), undefined, retrieved)).rejects.toThrow('country observations');
 });
 it('handles year boundaries and excludes pre-SLT observations without zero filling', async () => {
  expect(trailingMonths('2027-01')).toEqual(['2026-02','2026-03','2026-04','2026-05','2026-06','2026-07','2026-08','2026-09','2026-10','2026-11','2026-12','2027-01']);
  const history = await normalizeHistory(sample([...month('2023-01'), ...month('2023-02')]), retrieved);
  expect(history.observations.slice(0, 11).every(r => r.net_foreign_purchases_usd === null)).toBe(true);
  expect(history.end_period).toBe('2023-02');
  expect(historySchema.safeParse({...history, observations: history.observations.map((r, i) => i === 0 ? {...r, state:'reported', net_foreign_purchases_usd:1} : r)}).success).toBe(false);
  expect(() => latestPeriod(readTable(sample(month('2023-01'))), retrieved)).toThrow('No supported');
 });
 it('validates calendar windows and retrieval timestamps in cache payloads', async () => {
  const history = await normalizeHistory(valid(), retrieved);
  for (const changes of [{start_period:'2025-08'}, {end_period:'2026-13'}, {end_period:'2026-07'}, {retrieved_at:'not-a-date'}, {retrieved_at:'2026-08-31T00:00:00Z'}]) {
   expect(historySchema.safeParse({...history, ...changes}).success).toBe(false);
  }
 });
 it('uses UTC for the completed-month boundary rather than a string-local date', () => {
  const rows = readTable(sample(month('2026-10')));
  expect(() => latestPeriod(rows, '2026-11-01T00:30:00+02:00')).toThrow('current or future');
  expect(latestPeriod(rows, '2026-10-31T23:30:00-02:00')).toBe('2026-10');
 });
});
