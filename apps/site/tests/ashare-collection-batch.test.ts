import {afterEach,describe,expect,it,vi} from 'vitest';
import {collectionContinuationAt,createCollectionBatch,runCollectionBatch,COLLECTION_WINDOW_MS,COLLECTION_REQUEST_BUDGET_MS,COLLECTION_TRANSPORT_TIMEOUT_MS} from '../lib/ashare/collection-batch';
import {STAGE_MAX_AGE_MS} from '../lib/ashare/stage';
import {ACQUISITION_BUDGET_MS} from '../lib/ashare/ashare';
import {BROWSER_REQUEST_TIMEOUT_MS} from '../components/ashare/session';
import {consumeReply,emptyState} from '../components/ashare/client';
import {parseScope} from '../lib/ashare/snapshot';
const start=Date.parse('2026-11-05T12:00:00Z');
const partial={status:503,errorCode:'collection_in_progress',recoveryMode:'retry',retryAfter:'3'};
const scope=parseScope(new URL('https://offline.invalid/?scope=BK1216'));
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
describe('strict continuation eligibility',()=>{
 it.each([200,304,503])('accepts explicit pending %s with a numeric retry deadline',status=>expect(collectionContinuationAt({...partial,status},start)).toBe(start+3000));
 it('accepts an unambiguous body code or canonical HTTP date',()=>{
  expect(collectionContinuationAt({...partial,errorCode:undefined,payload:{error_code:'collection_in_progress'}},start)).toBe(start+3000);
  expect(collectionContinuationAt({...partial,retryAfter:new Date(start+6000).toUTCString()},start)).toBe(start+6000);
 });
 it.each([undefined,'','oops','1.5','-1','Infinity','9007199254740992','9999999999999','2026-11-05',' 3','3 '])('rejects missing, ambiguous or overflowing Retry-After %s',retryAfter=>expect(collectionContinuationAt({...partial,retryAfter},start)).toBeUndefined());
 it.each([201,401,403,429,500,502,504])('rejects HTTP %s',status=>expect(collectionContinuationAt({...partial,status},start)).toBeUndefined());
 it.each(['source_busy','source_cooldown','source_denied','source_outcome_unconfirmed','source_gate_release_unconfirmed','unknown_error'])('does not turn %s into a continuation',code=>{
  expect(collectionContinuationAt({...partial,errorCode:code,payload:{error_code:'collection_in_progress'}},start)).toBeUndefined();
  expect(collectionContinuationAt({...partial,payload:{error_code:code}},start)).toBeUndefined();
 });
 it.each(['stopped','unknown'])('rejects recovery mode %s',recoveryMode=>expect(collectionContinuationAt({...partial,recoveryMode},start)).toBeUndefined());
 it('does not authorize invalid 200 evidence or a 304 without matching cache',()=>{
  for(const status of [200,304])expect(consumeReply(emptyState(),{...partial,status,payload:{}},scope,start).continuationAt).toBeUndefined();
 });
 it('does not preserve a continuation through a subsequent failure',()=>{
  const previous=consumeReply(emptyState(),partial,scope,start);expect(previous.continuationAt).toBe(start+3000);
  for(const errorCode of ['source_busy','source_cooldown','source_denied','source_outcome_unconfirmed','upstream_http']){
   expect(consumeReply(previous,{status:503,errorCode,retryAfter:'3'},scope,start+3000).continuationAt).toBeUndefined();
  }
 });
});
describe('one finite batch, not a minute scheduler',()=>{
 it('keeps client bounds aligned with the unchanged server and browser limits',()=>{expect(COLLECTION_WINDOW_MS).toBe(STAGE_MAX_AGE_MS);expect(COLLECTION_REQUEST_BUDGET_MS).toBe(ACQUISITION_BUDGET_MS);expect(COLLECTION_TRANSPORT_TIMEOUT_MS).toBe(BROWSER_REQUEST_TIMEOUT_MS);});
 it('bounds a waiting job even if the application clock moves backward',async()=>{
  vi.useFakeTimers();vi.setSystemTime(start);const request=vi.fn(async()=>({continuationAt:Date.now()+3000}));const pending=runCollectionBatch({request});await vi.advanceTimersByTimeAsync(1);vi.setSystemTime(start-3600000);await vi.advanceTimersByTimeAsync(180000);expect(await pending).toMatchObject({requests:1,reason:'limit'});expect(request).toHaveBeenCalledOnce();
 });
 it('counts the first call and permits at most 20 requests',()=>{
  const cycle=createCollectionBatch(start);let now=start;
  for(let i=0;i<20;i++){expect(cycle.start(now)).toBe(true);expect(cycle.requests).toBe(i+1);const next=cycle.next(now+3000,now);if(i<19){expect(next).toBe(now+3100);now=next!;}else expect(next).toBeUndefined();}
  expect(cycle.start(now+60000)).toBe(false);
 });
 it('reserves the full server invocation budget and rejects delayed or regressed clocks',()=>{
  const cycle=createCollectionBatch(start);expect(cycle.start(start)).toBe(true);expect(cycle.next(start+159900,start)).toBeUndefined();
  const delayed=createCollectionBatch(start);delayed.start(start);delayed.next(start+3000,start);expect(delayed.start(start+180000)).toBe(false);
  const backwards=createCollectionBatch(start);backwards.start(start);expect(backwards.next(start+3000,start-1)).toBeUndefined();
 });
 it('never shortens a long Retry-After to fit the window',()=>{
  const cycle=createCollectionBatch(start);cycle.start(start);expect(cycle.next(start+900000,start)).toBeUndefined();expect(cycle.start(start+3000)).toBe(false);
 });
 it('serially follows a partial result, then ends on an ordinary result',async()=>{
  vi.useFakeTimers();vi.setSystemTime(start);const request=vi.fn().mockImplementationOnce(async()=>({continuationAt:Date.now()+3000})).mockResolvedValue({complete:true});
  const pending=runCollectionBatch({request});await vi.advanceTimersByTimeAsync(3099);expect(request).toHaveBeenCalledOnce();await vi.advanceTimersByTimeAsync(1);
  expect(await pending).toMatchObject({requests:2,reason:'response',value:{complete:true}});expect(request).toHaveBeenCalledTimes(2);
 });
 it('stops a malicious/non-progressing response after exactly 20 calls',async()=>{
  vi.useFakeTimers();vi.setSystemTime(start);const request=vi.fn(async()=>({continuationAt:Date.now()+3000}));const pending=runCollectionBatch({request});await vi.runAllTimersAsync();expect(await pending).toMatchObject({requests:20,reason:'limit'});expect(request).toHaveBeenCalledTimes(20);
 });
 it('cancels a pending wait without another request',async()=>{
  vi.useFakeTimers();vi.setSystemTime(start);const controller=new AbortController(),request=vi.fn(async()=>({continuationAt:Date.now()+3000}));const pending=runCollectionBatch({request,signal:controller.signal});await vi.advanceTimersByTimeAsync(1000);controller.abort();expect(await pending).toMatchObject({requests:1,reason:'cancelled'});await vi.runAllTimersAsync();expect(request).toHaveBeenCalledOnce();
 });
 it('does not issue a first request when already cancelled',async()=>{
  const controller=new AbortController();controller.abort();const request=vi.fn();expect(await runCollectionBatch({request,signal:controller.signal})).toMatchObject({requests:0,reason:'cancelled'});expect(request).not.toHaveBeenCalled();
 });
 it('bounds an unsettled response and ignores its later completion',async()=>{
  vi.useFakeTimers();vi.setSystemTime(start);let finish!:(value:{continuationAt:number})=>void;
  const request=vi.fn(()=>new Promise<{continuationAt:number}>(resolve=>{finish=resolve;}));const pending=runCollectionBatch({request});await vi.advanceTimersByTimeAsync(35000);expect(await pending).toMatchObject({requests:1,reason:'unconfirmed'});expect(request.mock.calls[0]).toBeTruthy();finish({continuationAt:Date.now()+3000});await vi.runAllTimersAsync();expect(request).toHaveBeenCalledOnce();
 });
 it('does not retry a rejected or uncertain request',async()=>{
  const request=vi.fn().mockRejectedValue(new Error('unknown outcome'));expect(await runCollectionBatch({request})).toMatchObject({requests:1,reason:'unconfirmed'});expect(request).toHaveBeenCalledOnce();
 });
});
