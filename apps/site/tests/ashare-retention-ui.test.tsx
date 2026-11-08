// @vitest-environment jsdom
import React from 'react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import AshareWorkspace from '../components/ashare/AshareWorkspace';
import {ashareReportFixture,ASHARE_REPORT_NOW as now} from './organized-ashare-fixture';
import {ashareSnapshotExpiresAt} from '../lib/ashare/retention';
const snapshot=ashareReportFixture(),expiry=ashareSnapshotExpiresAt(snapshot);
const fresh=(payload=snapshot)=>new Response(JSON.stringify(payload),{headers:{etag:'old'}});
const tile=()=>screen.queryByRole('button',{name:/合成证据0.*BK9000/});
async function advance(ms:number){await act(async()=>{await vi.advanceTimersByTimeAsync(ms);});}
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});
describe('workspace local expiry',()=>{
 it('removes all visible evidence at the exact deadline without a new request or losing cooldown',async()=>{
  vi.useFakeTimers();vi.setSystemTime(expiry-60001);
  const fetcher=vi.fn().mockResolvedValueOnce(fresh()).mockResolvedValue(new Response('{}',{status:503,headers:{'retry-after':'172800','x-ashare-error-code':'upstream_http'}}));
  vi.stubGlobal('fetch',fetcher);render(<AshareWorkspace/>);await advance(1);expect(tile()).not.toBeNull();
  await advance(60000);expect(tile()).toBeNull();expect(fetcher).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('link',{name:/下载/})).toBeNull();expect((screen.getByRole('button',{name:'重试当前来源'}) as HTMLButtonElement).disabled).toBe(true);
 });
 it.each(['focus','pageshow','visibilitychange'])('evicts on %s during a long cooldown without requesting',async event=>{
  vi.useFakeTimers();vi.setSystemTime(now);vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');
  const fetcher=vi.fn().mockResolvedValueOnce(fresh()).mockResolvedValue(new Response('{}',{status:503,headers:{'retry-after':'172800','x-ashare-error-code':'upstream_http'}}));
  vi.stubGlobal('fetch',fetcher);render(<AshareWorkspace/>);await advance(60001);expect(tile()).not.toBeNull();
  vi.setSystemTime(expiry);fireEvent(event==='visibilitychange'?document:window,new Event(event));expect(tile()).toBeNull();expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('clears while a resumed request is in flight and accepts fresh late evidence',async()=>{
  vi.useFakeTimers();vi.setSystemTime(now);vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');
  let finish!:(reply:Response)=>void;
  const fetcher=vi.fn().mockResolvedValueOnce(fresh()).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));vi.stubGlobal('fetch',fetcher);
  render(<AshareWorkspace/>);await advance(1);vi.setSystemTime(expiry-1);fireEvent.focus(window);expect(tile()).not.toBeNull();expect(fetcher).toHaveBeenCalledTimes(2);
  vi.setSystemTime(expiry);fireEvent(window,new Event('pageshow'));expect(tile()).toBeNull();expect(fetcher).toHaveBeenCalledTimes(2);
  await act(async()=>finish(fresh(ashareReportFixture({now:expiry}))));expect(tile()).not.toBeNull();expect(fetcher).toHaveBeenCalledTimes(2);
 });
});
