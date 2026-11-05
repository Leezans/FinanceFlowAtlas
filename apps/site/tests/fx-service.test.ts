import {describe,expect,it,vi} from 'vitest';
import {createFxService as createGatedFxService} from '../lib/fx/service';
import {CHECK_INTERVAL_MS,RETRY_INTERVAL_MS,CACHE_TTL_MS} from '../lib/fx/model';
import {FX_NOW,fxXml,fxResponse} from './fx-fixture';
import type {FxGateState} from '../lib/fx/source-gate';
const createFxService=(fetcher:typeof fetch,now:()=>number)=>{
 const state:FxGateState={state:'idle',retryAt:0,nowMs:now(),checkedAt:null,snapshot:null,expired:false,errorCode:null};
 return createGatedFxService(fetcher,now,{
  async inspect(){return {...state,nowMs:now(),expired:!!state.snapshot&&Date.parse(state.snapshot.retrieved_at)+CACHE_TTL_MS<=now()}},
  async acquire(){state.state='busy';return {token:'test-only'}},
  async release(_token,outcome){state.state=outcome.kind==='denied'?'blocked':'idle';state.retryAt=now()+(outcome.kind==='success'?CHECK_INTERVAL_MS:RETRY_INTERVAL_MS);state.checkedAt=new Date(now()).toISOString();state.errorCode=outcome.kind==='temporary_failure'?outcome.error:null;if(outcome.kind==='success')state.snapshot=outcome.snapshot;if(outcome.kind==='denied')state.snapshot=null;},
 });
};
describe('ECB shared-cache service',()=>{
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
 it('does not acquire or fetch when request-lifetime retention cannot be registered',async()=>{
  const inspect=vi.fn(),acquire=vi.fn(),release=vi.fn(),fetcher=vi.fn();
  const service=createGatedFxService(fetcher,()=>FX_NOW,{inspect,acquire,release},()=>{throw new Error('no execution context')});
  expect(await service.read()).toMatchObject({snapshot:null,source_state:'stopped',error_code:'source_gate_unavailable'});
  expect(inspect).not.toHaveBeenCalled();expect(acquire).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();
 });
 it('returns unavailable, never fake zero data, on first failure',async()=>{
  const service=createFxService(async()=>{throw new Error('private error detail')},()=>FX_NOW),result=await service.read();expect(result.snapshot).toBeNull();expect(result.source_state).toBe('unavailable');expect(JSON.stringify(result)).not.toContain('private error detail');
 });
 it.each(['forbidden','legal restriction','redirected response','XHTML challenge'])('clears data and latches %s for the process without retry or bypass',async mode=>{
  const response=mode==='forbidden'?new Response(null,{status:403}):mode==='legal restriction'?new Response(null,{status:451}):mode==='XHTML challenge'?new Response('<html/>',{headers:{'content-type':'application/xhtml+xml'}}):fxResponse();
  if(mode==='redirected response')Object.defineProperty(response,'redirected',{value:true});
  let now=FX_NOW;const fetcher=vi.fn().mockResolvedValueOnce(fxResponse()).mockResolvedValueOnce(response),service=createFxService(fetcher,()=>now);
  await service.read();now+=CHECK_INTERVAL_MS;const denied=await service.read();expect(denied).toMatchObject({snapshot:null,source_state:'stopped',next_check_at:null,error_code:'source_stopped'});now+=10*CHECK_INTERVAL_MS;await service.read();expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('accepts same-day revisions as new acquisitions without inventing a new reference day',async()=>{
  let now=FX_NOW;const fetcher=vi.fn().mockResolvedValueOnce(fxResponse()).mockResolvedValueOnce(fxResponse(fxXml().replace("rate='2.0000'","rate='4.0000'"))),service=createFxService(fetcher,()=>now);await service.read();now+=CHECK_INTERVAL_MS;
  const revised=await service.read();expect(revised.snapshot?.reference_date).toBe('2026-06-08');expect(revised.snapshot?.rates.find(r=>r.currency==='USD')?.per_eur).toBe('4.0000');
 });
});
