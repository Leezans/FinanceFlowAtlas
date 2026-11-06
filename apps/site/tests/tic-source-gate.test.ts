import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {drizzle} from 'drizzle-orm/sqlite-proxy';
import {getCachedSource,getTic,SOURCE_TIMEOUT_MS,DAY_MS} from '../lib/tic/cache';
import {HISTORY_CACHE_KEY,historySchema,normalizeHistory,type TicHistory} from '../lib/tic/history';
import {TIC_SOURCE_GATE_KEY} from '../lib/tic/source-gate';
import {valid} from './tic-fixture';
const state=vi.hoisted(()=>({db:null as unknown}));
vi.mock('../db',()=>({getDb:()=>state.db}));
import {repository} from '../lib/tic/d1';
let sqlite:DatabaseSync;
let now:number;
beforeEach(()=>{
 now=Date.now();sqlite=new DatabaseSync(':memory:');
 sqlite.exec('CREATE TABLE tic_snapshot_cache(id TEXT PRIMARY KEY, payload TEXT, version TEXT, last_attempt_ms INTEGER, last_success_ms INTEGER, error TEXT, lease_until_ms INTEGER NOT NULL DEFAULT 0, lease_token TEXT)');
 state.db=drizzle(async(sql,params,method)=>{const statement=sqlite.prepare(sql);if(method==='run'){statement.run(...params);return {rows:[]}}return {rows:statement.all(...params).map(row=>Object.values(row))}});
});
afterEach(()=>{vi.useRealTimers();sqlite.close()});
const history=(fetcher:typeof fetch,at:number)=>getCachedSource(repository<TicHistory>(HISTORY_CACHE_KEY),v=>historySchema.parse(v),normalizeHistory,fetcher,at);
const view=()=>sqlite.prepare('SELECT * FROM tic_snapshot_cache WHERE id=?').get(TIC_SOURCE_GATE_KEY)!;
function fail(status:number,headers:Record<string,string>={}){return vi.fn<typeof fetch>(async()=>new Response(null,{status,headers}))}
describe('durable Treasury gate on real isolated SQLite, synthetic upstream only',()=>{
 it.each([401,403,407,429,451,302])('persists HTTP %s across fresh repositories, keys and lease ages',async status=>{
  const fetcher=fail(status,{'Retry-After':'3600'});
  const first=await getTic(repository(),fetcher,now);expect(first.status.source_status).toBe('denied');
  await getTic(repository(),fetcher,now+10*DAY_MS);const second=await history(fetcher,now+10*DAY_MS);
  expect(fetcher).toHaveBeenCalledTimes(1);expect(second.status.source_status).toBe('denied');expect(view().version).toBe('denied');
  expect(fetcher.mock.calls[0][1]?.redirect).toBe('manual');
 });
 it.each(['seconds','date'])('shares a full one-hour Retry-After %s without shortening it to five minutes',async kind=>{
  const fetcher=fail(503,{'Retry-After':kind==='seconds'?'3600':new Date(now+3600_000).toUTCString()});
  const first=await getTic(repository(),fetcher,now);const deadline=Date.parse(first.status.next_retry_at!);
  expect(deadline).toBeGreaterThanOrEqual(now+3599_000);expect(deadline).toBeLessThan(now+3602_000);
  const current=await getTic(repository(),fetcher,now+300_000);const other=await history(fetcher,now+300_000);
  expect(fetcher).toHaveBeenCalledTimes(1);expect(current.status.source_status).toBe('cooldown');expect(other.status.next_retry_at).toBe(first.status.next_retry_at);
  // Advance only the isolated database clock condition, never a real source gate.
  sqlite.prepare('UPDATE tic_snapshot_cache SET lease_until_ms=0 WHERE id=?').run(TIC_SOURCE_GATE_KEY);
  await history(fetcher,now+3600_000);expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('preserves an absolute HTTP-date even when the caller clock is one hour fast',async()=>{
  const target=Date.now()+3600_000,fetcher=fail(503,{'Retry-After':new Date(target).toUTCString()});
  const result=await getTic(repository(),fetcher,now+3600_000);
  expect(Date.parse(result.status.next_retry_at!)).toBeGreaterThanOrEqual(target-1000);
  await history(fetcher,now+2*DAY_MS);expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it.each(['fetch','body'])('keeps a rejected %s transport outcome uncertain across cache keys',async stage=>{
  const fetcher=vi.fn<typeof fetch>(async()=>{
   if(stage==='fetch')throw new TypeError('synthetic network failure');
   return new Response(new ReadableStream({start(controller){controller.error(new TypeError('synthetic body disconnect'))}}));
  });
  expect((await getTic(repository(),fetcher,now)).status.source_status).toBe('uncertain');
  await history(fetcher,now+DAY_MS);expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('stops after zero-row publication instead of reopening the source gate',async()=>{
  const repo=repository(),original=repo.success;
  repo.success=async(...args)=>{sqlite.prepare('UPDATE tic_snapshot_cache SET lease_token=? WHERE id=?').run('unexpected-owner','tic-equity-latest-v2');await original(...args)};
  const fetcher=vi.fn<typeof fetch>(async()=>new Response(valid() as BodyInit));
  const result=await getTic(repo,fetcher,now);expect(result.status.source_status).toBe('coordination_unavailable');
  await history(fetcher,now+DAY_MS);expect(fetcher).toHaveBeenCalledTimes(1);expect(view().version).toBe('checking');
 });
 it('does not use caller clock skew to bypass a database-authoritative cooldown',async()=>{
  const fetcher=fail(503,{'Retry-After':'3600'});await getTic(repository(),fetcher,now);
  await history(fetcher,now+50*DAY_MS);expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('serializes current/history acquisition even while the other cache is empty',async()=>{
  let resolve!:(r:Response)=>void;const fetcher=vi.fn<typeof fetch>(()=>new Promise(r=>{resolve=r}));
  const first=getTic(repository(),fetcher,now);
  await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(1));
  const second=await history(fetcher,now+60_000);expect(second.status.source_status).toBe('checking');expect(fetcher).toHaveBeenCalledTimes(1);
  resolve(new Response(valid() as BodyInit));expect((await first).snapshot).not.toBeNull();
  expect(view().version).toBe('ready');
 });
 it.each(['fetch','body'])('stops an abort-ignoring %s with a deadline and keeps the source locked after late settlement',async stage=>{
  vi.useFakeTimers();let resolve!:(r:Response)=>void;
  const response=()=>new Response(new ReadableStream({start(){}}));
  const fetcher=vi.fn<typeof fetch>(()=>stage==='fetch'?new Promise(r=>{resolve=r}):Promise.resolve(response()));
  const first=getTic(repository(),fetcher,now);await vi.advanceTimersByTimeAsync(0);await vi.advanceTimersByTimeAsync(SOURCE_TIMEOUT_MS+1);
  const result=await first;expect(result.status.source_status).toBe('uncertain');expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  await history(fetcher,now+DAY_MS);expect(fetcher).toHaveBeenCalledTimes(1);
  if(stage==='fetch'){resolve(new Response(valid() as BodyInit));await vi.advanceTimersByTimeAsync(1)}
  expect((await repository().load())?.payload).toBeNull();expect(view().version).toBe('uncertain');
 });
 it.each(['<html><body>Access denied</body></html>','<html>Verify you are human captcha</html>'])('persists an explicit HTML challenge',async body=>{
  const fetcher=vi.fn<typeof fetch>(async()=>new Response(body));
  expect((await getTic(repository(),fetcher,now)).status.source_status).toBe('denied');
  await history(fetcher,now+DAY_MS);expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('refuses a synthetic already-redirected HTTP 200 without accepting its valid data',async()=>{
  const response=new Response(valid() as BodyInit);Object.defineProperty(response,'redirected',{value:true});
  const fetcher=vi.fn<typeof fetch>(async()=>response);const result=await getTic(repository(),fetcher,now);
  expect(result.status.source_status).toBe('denied');expect(result.snapshot).toBeNull();
 });
 it('stops on an unrepresentable Retry-After rather than clipping it',async()=>{
  const fetcher=fail(503,{'Retry-After':'999999999999999999999999'});
  expect((await getTic(repository(),fetcher,now)).status.source_status).toBe('uncertain');
  await history(fetcher,now+DAY_MS);expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it.each(['denial','pending','unknown_retry','unknown_transport'])('seeds a new gate conservatively from legacy %s evidence',async kind=>{
  sqlite.prepare('INSERT INTO tic_snapshot_cache(id,error,lease_token) VALUES(?,?,?)').run(HISTORY_CACHE_KEY,kind==='denial'?'Treasury source HTTP 403':kind==='unknown_retry'?'Treasury source HTTP 503':kind==='unknown_transport'?'fetch failed':null,kind==='pending'?'unknown-owner':null);
  const fetcher=fail(503);const result=await getTic(repository(),fetcher,now);
  expect(result.status.source_status).toBe(kind==='denial'?'denied':'uncertain');expect(fetcher).not.toHaveBeenCalled();
 });
 it('retains validated values with stale/denied metadata and no reacquisition',async()=>{
  await getTic(repository(),async()=>new Response(valid() as BodyInit),now);
  const denied=fail(403),result=await getTic(repository(),denied,now+DAY_MS);
  expect(result.snapshot?.grand_total_net_foreign_purchases_usd).toBe(9000000);expect(result.status.state).toBe('stale');expect(result.status.source_status).toBe('denied');
  await getTic(repository(),denied,now+2*DAY_MS);expect(denied).toHaveBeenCalledTimes(1);
 });
 it('fails closed for unreadable coordination and never recreates an unknown gate as ready',async()=>{
  const repo=repository();await repo.sourceGate.ensure();sqlite.prepare('UPDATE tic_snapshot_cache SET version=? WHERE id=?').run('unexpected',TIC_SOURCE_GATE_KEY);
  const fetcher=fail(503);expect((await getTic(repo,fetcher,now)).status.source_status).toBe('coordination_unavailable');expect(fetcher).not.toHaveBeenCalled();expect(view().version).toBe('unexpected');
 });
 it.each(['claim','finish','publication'])('keeps source stopped after an unconfirmed %s write',async stage=>{
  const repo=repository(),fetcher=vi.fn<typeof fetch>(async()=>new Response(valid() as BodyInit));
  if(stage==='claim'){const original=repo.sourceGate.claim;repo.sourceGate.claim=async(...args)=>{await original(...args);throw new Error('uncertain claim response')}}
  if(stage==='finish'){repo.sourceGate.finish=async()=>{throw new Error('uncertain finish response')}}
  if(stage==='publication'){repo.success=async()=>{throw new Error('uncertain publish response')}}
  const result=await getTic(repo,fetcher,now);expect(['coordination_unavailable','uncertain']).toContain(result.status.source_status);
  await history(fetcher,now+DAY_MS);expect(fetcher).toHaveBeenCalledTimes(stage==='claim'?0:1);expect(['checking','uncertain']).toContain(view().version);
 });
});
