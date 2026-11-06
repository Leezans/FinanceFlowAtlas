import {beforeEach, describe, it, expect, vi} from 'vitest';
import {normalizeHistory, HISTORY_CACHE_KEY} from '../lib/tic/history';
import {sample} from './tic-fixture';
const fake = vi.hoisted(() => ({read: vi.fn(), repository: vi.fn(() => ({}))}));
vi.mock('../lib/tic/cache', () => ({getCachedSource: fake.read}));
vi.mock('../lib/tic/d1', () => ({repository: fake.repository}));
import {serveTicHistory} from '../lib/tic/history-route';
beforeEach(() => {fake.read.mockReset(); fake.repository.mockClear();});
describe('independent US history endpoint', () => {
 it('uses a separate cache key and returns 503 without substitutes', async () => {
  fake.read.mockResolvedValue({snapshot: null, status: {state: 'unavailable'}});
  const response = await serveTicHistory(new Request('https://example.test/history'));
  expect(response.status).toBe(503); expect(fake.repository).toHaveBeenCalledWith(HISTORY_CACHE_KEY);
 });
 it('invalidates ETag on stale transition and preserves the validated source version', async () => {
  const snapshot = await normalizeHistory(sample(['Grand Total\t99996\t2026-08\t12']));
  fake.read.mockResolvedValue({snapshot, status: {state: 'available'}});
  const first = await serveTicHistory(new Request('https://example.test/history'));
  const headers = {'If-None-Match': first.headers.get('ETag')!};
  expect((await serveTicHistory(new Request('https://example.test/history', {headers}))).status).toBe(304);
  fake.read.mockResolvedValue({snapshot, status: {state: 'stale'}});
  const stale = await serveTicHistory(new Request('https://example.test/history', {headers}));
  expect(stale.status).toBe(200); expect(stale.headers.get('Warning')).toContain('Last validated');
  expect(stale.headers.get('X-Data-Status')).toBe('stale'); expect(((await stale.json()) as {version:string}).version).toBe(snapshot.version);
 });
 it('does not expose internal cache errors or source bodies', async () => {
  fake.read.mockRejectedValue(new Error('private backend detail'));
  const response = await serveTicHistory(new Request('https://example.test/history'));
  expect(response.status).toBe(503); expect(await response.text()).not.toContain('private');
 });
});

describe('TIC historical source stop headers',()=>{
 it('preserves long retry metadata on 503',async()=>{
  const deadline=new Date(Date.now()+3600_000).toISOString();fake.read.mockResolvedValue({snapshot:null,status:{state:'unavailable',source_status:'cooldown',next_retry_at:deadline}});
  const response=await serveTicHistory(new Request('https://example.test/history'));expect(response.status).toBe(503);expect(response.headers.get('X-Next-Retry-At')).toBe(deadline);expect(Number(response.headers.get('Retry-After'))).toBeGreaterThanOrEqual(3599);
 });
 it('preserves denied metadata when reusing a cached historical ETag',async()=>{
  const snapshot=await normalizeHistory(sample(['Grand Total\t99996\t2026-08\t12']));fake.read.mockResolvedValue({snapshot,status:{state:'stale',source_status:'denied',next_retry_at:null}});
  const first=await serveTicHistory(new Request('https://example.test/history'));const second=await serveTicHistory(new Request('https://example.test/history',{headers:{'If-None-Match':first.headers.get('ETag')!}}));expect(second.status).toBe(304);expect(second.headers.get('X-Source-Status')).toBe('denied');
 });
});
