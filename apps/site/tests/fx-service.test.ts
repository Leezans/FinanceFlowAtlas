import {describe,expect,it,vi} from 'vitest';
import {createFxService} from '../lib/fx/service';
import {CHECK_INTERVAL_MS,RETRY_INTERVAL_MS} from '../lib/fx/model';
import {FX_NOW,fxXml,fxResponse} from './fx-fixture';
describe('ECB ephemeral service cache',()=>{
 it('coalesces parallel checks and caches successful results for an hour',async()=>{
  let now=FX_NOW;const fetcher=vi.fn(async()=>fxResponse()),service=createFxService(fetcher,()=>now);
  const results=await Promise.all([service.read(),service.read(),service.read()]);expect(fetcher).toHaveBeenCalledTimes(1);expect(results.every(r=>r.snapshot?.rates.length===3)).toBe(true);
  now+=CHECK_INTERVAL_MS-1;await service.read();expect(fetcher).toHaveBeenCalledTimes(1);now+=1;await service.read();expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('retains last validated bytes and acquisition date on transient/invalid/regressed source',async()=>{
  let now=FX_NOW;const fetcher=vi.fn().mockResolvedValueOnce(fxResponse()).mockResolvedValueOnce(fxResponse('bad')).mockResolvedValueOnce(fxResponse(fxXml('2026-06-07'))).mockResolvedValueOnce(fxResponse());
  const service=createFxService(fetcher,()=>now),first=await service.read();now+=CHECK_INTERVAL_MS;
  const stale=await service.read();expect(stale.source_state).toBe('stale');expect(stale.error_code).toBe('invalid_source');expect(stale.snapshot).toEqual(first.snapshot);expect(stale.checked_at).not.toBe(first.checked_at);
  now+=RETRY_INTERVAL_MS-1;await service.read();expect(fetcher).toHaveBeenCalledTimes(2);now+=1;
  expect((await service.read()).error_code).toBe('source_older');now+=RETRY_INTERVAL_MS;expect((await service.read()).source_state).toBe('available');
 });
 it('returns unavailable, never fake zero data, on first failure',async()=>{
  const service=createFxService(async()=>{throw new Error('private error detail')},()=>FX_NOW),result=await service.read();expect(result.snapshot).toBeNull();expect(result.source_state).toBe('unavailable');expect(JSON.stringify(result)).not.toContain('private error detail');
 });
 it('clears data and latches a denial for the process without retry or bypass',async()=>{
  let now=FX_NOW;const fetcher=vi.fn().mockResolvedValueOnce(fxResponse()).mockResolvedValueOnce(new Response(null,{status:403})),service=createFxService(fetcher,()=>now);
  await service.read();now+=CHECK_INTERVAL_MS;const denied=await service.read();expect(denied).toMatchObject({snapshot:null,source_state:'stopped',next_check_at:null,error_code:'source_stopped'});now+=10*CHECK_INTERVAL_MS;await service.read();expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('accepts same-day revisions as new acquisitions without inventing a new reference day',async()=>{
  let now=FX_NOW;const fetcher=vi.fn().mockResolvedValueOnce(fxResponse()).mockResolvedValueOnce(fxResponse(fxXml().replace("rate='2.0000'","rate='4.0000'"))),service=createFxService(fetcher,()=>now);await service.read();now+=CHECK_INTERVAL_MS;
  const revised=await service.read();expect(revised.snapshot?.reference_date).toBe('2026-06-08');expect(revised.snapshot?.rates.find(r=>r.currency==='USD')?.per_eur).toBe('4.0000');
 });
});
