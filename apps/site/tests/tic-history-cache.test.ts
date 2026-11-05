import {describe, it, expect} from 'vitest';
import {getCachedSource, DAY_MS, type CacheRepository, type CacheRow} from '../lib/tic/cache';
import {normalizeHistory, historySchema, trailingMonths, type TicHistory} from '../lib/tic/history';
const HISTORY_MONTHS = trailingMonths('2026-08');
import {sample} from './tic-fixture';
function memory(): CacheRepository<TicHistory> {
 let row: CacheRow = {payload: null, version: null, lastAttemptMs: null, lastSuccessMs: null, error: null, leaseUntilMs: 0, leaseToken: null};
 return {
  async ensure() {}, async load() {return {...row};},
  async claim(now, token) {if (row.leaseUntilMs > now) return false; row = {...row, lastAttemptMs: now, leaseToken: token, leaseUntilMs: now + 30000}; return true;},
  async success(token, snapshot, now) {if (row.leaseToken === token) row = {...row, payload: JSON.stringify(snapshot), version: snapshot.version, lastSuccessMs: now, error: null, leaseUntilMs: 0, leaseToken: null};},
  async failure(token, error) {if (row.leaseToken === token) row = {...row, error, leaseUntilMs: 0, leaseToken: null};},
 };
}
const totals = HISTORY_MONTHS.map(month => `Grand Total\t99996\t${month}\t12`);
const now = Date.parse('2026-11-04T12:00:00Z');
const read = (repo: CacheRepository<TicHistory>, bytes: Uint8Array, time: number) =>
 getCachedSource(repo, value => historySchema.parse(value), normalizeHistory, async () => new Response(bytes as BodyInit), time);
describe('history cache integration', () => {
 it.each([() => sample(totals.slice(0, -1)), () => new TextEncoder().encode('<html>failure</html>')])('retains last-good history as stale when refreshed source regresses or is malformed', async invalid => {
  const repo = memory(); const first = await read(repo, sample(totals), now);
  expect(first.status.state).toBe('available');
  const stale = await read(repo, invalid(), now + DAY_MS);
  expect(stale.status.state).toBe('stale'); expect(stale.snapshot?.version).toBe(first.snapshot?.version);
  const recovered = await read(repo, sample(totals), now + DAY_MS * 2);
  expect(recovered.status.state).toBe('available');
 });
 it('rolls the history window forward after a new release with missing interior months intact',async()=>{
  const repo=memory();const first=await read(repo,sample(totals),now);
  const newer=await read(repo,sample([...totals,'Grand Total\t99996\t2026-09\t-4']),now+DAY_MS);
  expect(newer.status.state).toBe('available');expect(newer.snapshot?.start_period).toBe('2025-10');
  expect(newer.snapshot?.end_period).toBe('2026-09');expect(newer.snapshot?.version).not.toBe(first.snapshot?.version);
  expect(newer.snapshot?.observations.at(-1)?.net_foreign_purchases_usd).toBe(-4000000);
 });
 it('refuses an incomplete latest month without manufacturing zero', async () => {
  const result = await read(memory(), sample([...totals.slice(0, -1), 'Grand Total\t99996\t2026-08\tn.a.']), now);
  expect(result.status.state).toBe('unavailable'); expect(result.snapshot).toBeNull();
 });
});
