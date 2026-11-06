// @vitest-environment jsdom
import React from 'react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import Page from '../app/ashare/page';
import {consumeReply,emptyState} from '../components/ashare/client';
const start=Date.parse('2026-11-05T12:00:00Z');
const row={f12:'BK0001',f14:'合成行业',f2:1,f3:1,f62:-10,f184:1,f66:1,f69:1,f72:1,f75:1,f78:1,f81:1,f84:1,f87:1};
const scope={kind:'industry_rank',fs:'m:90+s:2+f:!50',classification_level:'eastmoney_level_1'} as const;
const evidence={schema:'ashare-provider-evidence/1',rows:[row],source_total:1,fetched_at:'2026-11-05T12:00:00Z',scope,page_count:1,source_observed_at:null,trade_date:null,metric_kind:'provider_order_flow_proxy',metric_field:'f62',unit:'CNY',field_units:{f62:'CNY',f3:'percent',f2:'index_points'},delay_status:'not_provided',classification_exclusivity:'not_established',notice:'合成测试，非真实行情',stale:false,has_error:false};
const partial=(retry='3')=>new Response('{}',{status:503,headers:{'x-ashare-error-code':'collection_in_progress','x-ashare-recovery':'retry','retry-after':retry}});
const ready=()=>new Response(JSON.stringify(evidence),{headers:{etag:'"complete"','x-ashare-refresh-after':'60'}});
async function advance(ms:number){await act(async()=>{await vi.advanceTimersByTimeAsync(ms);});}
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});
describe('page uses the same bounded batch contract',()=>{
 it('ends after 20 requests, then waits the ordinary minute before a new cycle',async()=>{
  vi.useFakeTimers();vi.setSystemTime(start);const fetcher=vi.fn(async()=>partial());vi.stubGlobal('fetch',fetcher);render(<Page/>);await advance(62000);expect(fetcher).toHaveBeenCalledTimes(20);expect(screen.getByRole('button',{name:'重试当前来源'}).hasAttribute('disabled')).toBe(true);fireEvent.click(screen.getByRole('button',{name:'重试当前来源'}));fireEvent.focus(window);expect(fetcher).toHaveBeenCalledTimes(20);await advance(56899);expect(fetcher).toHaveBeenCalledTimes(20);await advance(1);expect(fetcher).toHaveBeenCalledTimes(21);
 });
 it('aborts an unsettled last request at the original 180-second window, not 35 seconds later',async()=>{
  vi.useFakeTimers();vi.setSystemTime(start);const fetcher=vi.fn().mockResolvedValueOnce(partial('156')).mockImplementation(()=>new Promise(()=>{}));vi.stubGlobal('fetch',fetcher);render(<Page/>);
  await advance(179999);expect(fetcher).toHaveBeenCalledTimes(2);expect(fetcher.mock.calls[1][1].signal.aborted).toBe(false);
  await advance(1);expect(fetcher.mock.calls[1][1].signal.aborted).toBe(true);expect(screen.getByText(/browser_timeout/)).toBeTruthy();await advance(59999);expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('does not restart an expired cycle on focus after browser suspension',async()=>{
  vi.useFakeTimers();vi.setSystemTime(start);vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');const fetcher=vi.fn().mockResolvedValueOnce(partial()).mockResolvedValue(ready());vi.stubGlobal('fetch',fetcher);render(<Page/>);await advance(1);
  vi.setSystemTime(start+180000);fireEvent.focus(window);fireEvent(window,new Event('pageshow'));expect(fetcher).toHaveBeenCalledOnce();await advance(59999);expect(fetcher).toHaveBeenCalledOnce();await advance(1);expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('an early manual retry preserves the existing buffer and does not reset the batch',async()=>{
  vi.useFakeTimers();vi.setSystemTime(start);const fetcher=vi.fn().mockResolvedValueOnce(partial()).mockResolvedValue(ready());vi.stubGlobal('fetch',fetcher);render(<Page/>);await advance(3000);
  fireEvent.click(screen.getByRole('button',{name:'重试当前来源'}));expect(fetcher).toHaveBeenCalledOnce();await advance(99);expect(fetcher).toHaveBeenCalledOnce();await advance(1);expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('unmount cancels the continuation timer',async()=>{
  vi.useFakeTimers();vi.setSystemTime(start);const fetcher=vi.fn(async()=>partial());vi.stubGlobal('fetch',fetcher);const view=render(<Page/>);await advance(1);view.unmount();await advance(180000);expect(fetcher).toHaveBeenCalledOnce();
 });
 it.each(['','bad','900'])('does not turn Retry-After %s into a shorter batch wait',async retry=>{
  vi.useFakeTimers();vi.setSystemTime(start);const fetcher=vi.fn().mockResolvedValueOnce(partial(retry)).mockResolvedValue(ready());vi.stubGlobal('fetch',fetcher);render(<Page/>);await advance(59999);expect(fetcher).toHaveBeenCalledOnce();
  await advance(1);expect(fetcher).toHaveBeenCalledTimes(retry==='900'?1:2);
 });
});
describe('validated 200 and conditional 304 continuation',()=>{
 const hint={errorCode:'collection_in_progress',recoveryMode:'retry',retryAfter:'3'};
 it('continues with a validated stale 200 while retaining the complete prior evidence',()=>{
  const result=consumeReply(emptyState(),{status:200,payload:{...evidence,stale:true},...hint},scope,start);expect(result.snapshot?.rows).toHaveLength(1);expect(result.continuationAt).toBe(start+3000);
 });
 it('rejects a new 200 body error flag that conflicts with the progress hint',()=>{
  const result=consumeReply(emptyState(),{status:200,payload:{...evidence,stale:true,has_error:true},...hint},scope,start);expect(result.snapshot?.rows).toHaveLength(1);expect(result.continuationAt).toBeUndefined();
 });
 it('can continue on 304 with a matching historical error cache without mutating its bytes',()=>{
  const previous=consumeReply(emptyState(),{status:200,etag:'"historical"',payload:{...evidence,stale:true,has_error:true}},scope,start);
  const next=consumeReply(previous,{status:304,...hint},scope,start+60000);expect(next.snapshot).toBe(previous.snapshot);expect(next.etag).toBe('"historical"');expect(next.continuationAt).toBe(start+63000);
 });
 it('clears a retained hint on a later failure even if a complete old snapshot exists',()=>{
  const previous=consumeReply(emptyState(),{status:200,payload:{...evidence,stale:true},...hint},scope,start);
  const next=consumeReply(previous,{status:503,errorCode:'upstream_http',retryAfter:'900'},scope,start+3000);expect(next.snapshot).toBe(previous.snapshot);expect(next.continuationAt).toBeUndefined();expect(next.recovery?.retryAt).toBe(start+903000);
 });
});
