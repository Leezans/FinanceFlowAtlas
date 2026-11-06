import {memoryGate} from './tic-memory-gate';
import {describe,it,expect,vi} from 'vitest';
import {getTic,DAY_MS,FAILURE_BACKOFF_MS,type CacheRepository,type CacheRow} from '../lib/tic/cache';
import {valid,sample} from './tic-fixture';
function memory(){let row:CacheRow|null=null;const repo:CacheRepository={sourceGate:memoryGate(),async ensure(){row||={payload:null,version:null,lastAttemptMs:null,lastSuccessMs:null,error:null,leaseUntilMs:0,leaseToken:null}},async load(){return row&&{...row}},async claim(now,token){if(!row||row.leaseUntilMs>now)return false;const due=row.error?FAILURE_BACKOFF_MS:row.payload?DAY_MS:30000;if(row.lastAttemptMs!==null&&now-row.lastAttemptMs<due)return false;row={...row,lastAttemptMs:now,leaseUntilMs:now+30000,leaseToken:token};return true},async success(token,s,now){if(row?.leaseToken===token)row={...row,payload:JSON.stringify(s),version:s.version,lastSuccessMs:now,error:null,leaseToken:null,leaseUntilMs:0}},async failure(token,error){if(row?.leaseToken===token)row={...row,error,leaseToken:null,leaseUntilMs:0}}};return repo}
const time=Date.parse('2026-11-04T00:00:00Z');
describe('D1 read-through cache policy with isolated fake repository',()=>{
 it('initial read fetches, validates, caches and avoids re-fetch within a day',async()=>{const repo=memory();const fetcher=vi.fn(async()=>new Response(valid())) as unknown as typeof fetch;expect((await getTic(repo,fetcher,time)).status.state).toBe('available');expect((await getTic(repo,fetcher,time+60000)).snapshot?.period).toBe('2026-08');expect(fetcher).toHaveBeenCalledTimes(1);await getTic(repo,fetcher,time+DAY_MS);expect(fetcher).toHaveBeenCalledTimes(2)});
 it('preserves last-good on failed refresh and backs off five minutes',async()=>{const repo=memory();await getTic(repo,async()=>new Response(valid()),time);const failure=vi.fn(async()=>new Response('failed',{status:503})) as unknown as typeof fetch;const stale=await getTic(repo,failure,time+DAY_MS);expect(stale.status.state).toBe('stale');expect(stale.snapshot?.grand_total_net_foreign_purchases_usd).toBe(9000000);await getTic(repo,failure,time+DAY_MS+60000);expect(failure).toHaveBeenCalledTimes(1);await getTic(repo,failure,time+DAY_MS+FAILURE_BACKOFF_MS);expect(failure).toHaveBeenCalledTimes(2)});
 it('advances only from a validated newer source month and refuses later source regression',async()=>{
  const repo=memory();const first=await getTic(repo,async()=>new Response(valid()),time);
  const newer=sample(['Japan\t42609\t2026-09\t8','Grand Total\t99996\t2026-09\t11']);
  const advanced=await getTic(repo,async()=>new Response(newer),time+DAY_MS);
  expect(advanced.snapshot?.period).toBe('2026-09');expect(advanced.snapshot?.version).not.toBe(first.snapshot?.version);
  const reverted=await getTic(repo,async()=>new Response(valid()),time+2*DAY_MS);
  expect(reverted.status.state).toBe('stale');expect(reverted.status.error).toContain('regressed from 2026-09 to 2026-08');
  expect(reverted.snapshot?.version).toBe(advanced.snapshot?.version);
  const recovered=await getTic(repo,async()=>new Response(newer),time+3*DAY_MS);
  expect(recovered.status.state).toBe('available');
 });
 it('retains last-good on a partial newest month, instead of silently presenting the prior month as fresh',async()=>{
  const repo=memory();const first=await getTic(repo,async()=>new Response(valid()),time);
  const incomplete=new TextDecoder().decode(valid()).replace('Definitions:','Japan\t42609\t2026-09\t5\nDefinitions:');
  const result=await getTic(repo,async()=>new Response(incomplete),time+DAY_MS);
  expect(result.status.state).toBe('stale');expect(result.snapshot?.version).toBe(first.snapshot?.version);
 });
 it('initial failure exposes unavailable with no manufactured observations',async()=>{const result=await getTic(memory(),async()=>new Response('bad',{status:502}),time);expect(result.snapshot).toBe(null);expect(result.status.state).toBe('unavailable');expect(result.status.error).toContain('HTTP 502')});
 it('does not overwrite last-good with a malformed source',async()=>{const repo=memory();const first=await getTic(repo,async()=>new Response(valid()),time);const next=await getTic(repo,async()=>new Response('bad data'),time+DAY_MS);expect(next.snapshot?.version).toBe(first.snapshot?.version);expect(next.status.state).toBe('stale')});
 it('concurrent initial reads make only one source request',async()=>{const repo=memory();const fetcher=vi.fn(async()=>new Response(valid())) as unknown as typeof fetch;const results=await Promise.all([getTic(repo,fetcher,time),getTic(repo,fetcher,time)]);expect(fetcher).toHaveBeenCalledTimes(1);expect(results.some(r=>r.status.state==='available')).toBe(true)});

 it('uses Worker-compatible manual redirects and refuses HTTP302 without following',async()=>{const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{expect(init?.redirect).toBe('manual');return new Response(null,{status:302,headers:{Location:'https://example.invalid/redirected'}})}) as unknown as typeof fetch;const result=await getTic(memory(),fetcher,time);expect(fetcher).toHaveBeenCalledTimes(1);expect(result.snapshot).toBeNull();expect(result.status.error).toContain('redirect rejected (HTTP 302)')});

});
