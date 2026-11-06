// @vitest-environment jsdom
import React from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import CboeQuotes from '../components/cboe/CboeQuotes';
import {reply,NOW} from './cboe-fixture';
import {MAX_CACHE_AGE_MS} from '../lib/cboe/service-model';
const tick=(ms=1)=>act(()=>vi.advanceTimersByTimeAsync(ms));
function visibility(value:'visible'|'hidden',emit=true){Object.defineProperty(document,'visibilityState',{value,configurable:true});if(emit)fireEvent(document,new Event('visibilitychange'));}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(NOW);visibility('visible',false);});
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();visibility('visible',false);});
const price=()=>screen.queryByText('12.3456 GBP');

describe('Cboe browser refresh lifecycle',()=>{
 it.each([401,403,407,451])('stops HTTP %s before a hung body and never retries on visibility or manual requests',async status=>{
  const json=vi.fn(()=>new Promise(()=>{})),f=vi.fn(async()=>({status,headers:new Headers(),json}) as unknown as Response);vi.stubGlobal('fetch',f);render(<CboeQuotes/>);await tick();
  expect(screen.getByText('展示权限已失效')).toBeTruthy();expect(json).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'检查更新'}).hasAttribute('disabled')).toBe(true);
  visibility('hidden');visibility('visible');await tick(180_000);expect(f).toHaveBeenCalledOnce();
 });
 it.each([{status:302},{status:0,type:'opaqueredirect'}])('uses manual redirects and stops response $status/$type without JSON',async shape=>{
  const json=vi.fn(()=>new Promise(()=>{})),f=vi.fn(async()=>({...shape,headers:new Headers(),json}) as unknown as Response);vi.stubGlobal('fetch',f);render(<CboeQuotes/>);await tick();
  expect(f).toHaveBeenCalledWith(expect.any(String),expect.objectContaining({redirect:'manual'}));expect(json).not.toHaveBeenCalled();expect(screen.getByText('展示权限已失效')).toBeTruthy();await tick(180_000);expect(f).toHaveBeenCalledOnce();
 });
 it('does not acquire from an initially hidden mount or manual click, then acquires once on visibility',async()=>{
  visibility('hidden',false);const f=vi.fn(async()=>Response.json(reply()));vi.stubGlobal('fetch',f);render(<CboeQuotes/>);await tick(180_000);fireEvent.click(screen.getByRole('button',{name:'检查更新'}));expect(f).not.toHaveBeenCalled();
  visibility('visible');await tick();expect(f).toHaveBeenCalledOnce();
 });
 it('rechecks visibility at a scheduled callback even before the visibility event',async()=>{
  const f=vi.fn(async()=>Response.json(reply()));vi.stubGlobal('fetch',f);render(<CboeQuotes/>);await tick();visibility('hidden',false);await tick(180_000);expect(f).toHaveBeenCalledOnce();visibility('visible');await tick();expect(f).toHaveBeenCalledTimes(2);
 });
 it('honors a one-hour structured retry across timer, clicks and repeated visibility wakes',async()=>{
  const body=reply();body.status.next_retry_at=new Date(NOW+3600_000).toISOString();const f=vi.fn(async()=>Response.json(body));vi.stubGlobal('fetch',f);render(<CboeQuotes/>);await tick();
  for(let i=0;i<3;i++){visibility('hidden');visibility('visible');fireEvent.click(screen.getByRole('button',{name:'检查更新'}));await tick(60_000);}
  expect(f).toHaveBeenCalledOnce();expect(price()).toBeTruthy();expect(screen.getByText('保留上次快照，尚未成功更新')).toBeTruthy();
 });
 it.each(['3600',new Date(NOW+3600_000).toUTCString()])('honors HTTP Retry-After %s before an invalid body',async value=>{
  const f=vi.fn(async()=>new Response('temporary gateway',{status:503,headers:{'Retry-After':value}}));vi.stubGlobal('fetch',f);render(<CboeQuotes/>);await tick();await tick(180_000);visibility('hidden');visibility('visible');expect(f).toHaveBeenCalledOnce();expect(screen.getByRole('button',{name:'检查更新'}).hasAttribute('disabled')).toBe(true);
 });
 it('preserves Retry-After when the response body stalls past the browser deadline',async()=>{
  const f=vi.fn(async()=>({status:503,headers:new Headers({'Retry-After':'3600'}),json:()=>new Promise(()=>{})}) as unknown as Response);vi.stubGlobal('fetch',f);render(<CboeQuotes/>);await tick();await tick(50_000);expect(screen.getByRole('button',{name:'检查更新'})).toBeTruthy();
  await tick(180_000);visibility('hidden');visibility('visible');expect(f).toHaveBeenCalledOnce();
 });
 it('chunks a 40-day deadline without retrying at the browser timer limit',async()=>{
  vi.spyOn(globalThis,'setInterval').mockImplementation((()=>0) as unknown as typeof setInterval);const timeout=vi.spyOn(globalThis,'setTimeout');
  const body=reply();body.status.next_retry_at=new Date(NOW+40*86400_000).toISOString();const f=vi.fn(async()=>Response.json(body));vi.stubGlobal('fetch',f);render(<CboeQuotes/>);await tick();expect(timeout.mock.calls.every(call=>typeof call[1]!=='number'||call[1]<=2_147_483_647)).toBe(true);
  await tick(2_147_483_646);expect(f).toHaveBeenCalledOnce();await tick(40*86400_000-2_147_483_647-1);expect(f).toHaveBeenCalledOnce();await tick(1);expect(f).toHaveBeenCalledTimes(2);
 });
 it.each(['fetch','body'] as const)('settles an ignored-abort %s, leaves a full cooldown and automatically recovers',async stage=>{
  const f=vi.fn<typeof fetch>().mockImplementationOnce(()=>stage==='fetch'?new Promise(()=>{}):Promise.resolve({status:200,headers:new Headers(),json:()=>new Promise(()=>{})} as Response)).mockImplementation(async()=>Response.json(reply()));vi.stubGlobal('fetch',f);render(<CboeQuotes/>);await tick();
  await tick(50_000);expect(screen.getByRole('button',{name:'检查更新'})).toBeTruthy();expect(f.mock.calls[0][1]!.signal!.aborted).toBe(true);visibility('hidden');visibility('visible');await tick(59_998);expect(f).toHaveBeenCalledOnce();await tick(1);expect(f).toHaveBeenCalledTimes(2);expect(price()).toBeTruthy();
 });
 it('does not allow a late body to publish after timeout and newer success',async()=>{
  let finish!:(value:unknown)=>void;const old=reply();old.snapshot!.rows[0].price='99';
  const f=vi.fn<typeof fetch>().mockResolvedValueOnce({status:200,headers:new Headers(),json:()=>new Promise(resolve=>{finish=resolve;})} as Response).mockImplementation(async()=>Response.json(reply()));vi.stubGlobal('fetch',f);render(<CboeQuotes/>);await tick(110_001);expect(price()).toBeTruthy();await act(async()=>finish(old));expect(price()).toBeTruthy();expect(screen.queryByText('99 GBP')).toBeNull();expect(f).toHaveBeenCalledTimes(2);
 });
 it('leaves admitted work alive while hidden and starts no hidden successor',async()=>{
  let finish!:(response:Response)=>void;const f=vi.fn<typeof fetch>(()=>new Promise(resolve=>{finish=resolve;}));vi.stubGlobal('fetch',f);render(<CboeQuotes/>);await tick();const signal=f.mock.calls[0][1]!.signal!;visibility('hidden');expect(signal.aborted).toBe(false);await act(async()=>finish(Response.json(reply())));await tick(180_000);expect(f).toHaveBeenCalledOnce();visibility('visible');await tick();expect(f).toHaveBeenCalledTimes(2);
 });
 it('marks elapsed cached data stale while hidden, then expires it without changing the source clock',async()=>{
  const body=reply(),f=vi.fn(async()=>Response.json(body));vi.stubGlobal('fetch',f);render(<CboeQuotes/>);await tick();visibility('hidden');await tick(61_000);expect(price()).toBeTruthy();expect(screen.getByText('保留上次快照，尚未成功更新')).toBeTruthy();
  vi.setSystemTime(NOW+MAX_CACHE_AGE_MS+1);await tick(1000);expect(price()).toBeNull();expect(f).toHaveBeenCalledOnce();
 });
 it('keeps filters and original valid price while a transport failure is paused',async()=>{
  const f=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(reply())).mockRejectedValue(new TypeError('offline'));vi.stubGlobal('fetch',f);render(<CboeQuotes/>);await tick();fireEvent.change(screen.getByRole('searchbox'),{target:{value:'GB'}});await tick(60_000);expect(price()).toBeTruthy();expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('GB');expect(screen.getByText('连接中断，显示上次核验快照')).toBeTruthy();
 });
 it.each([[120_000,300_000],[300_000,120_000]])('uses the later HTTP %s and structured %s deadline',async(http,structured)=>{
  const body=reply();body.status.next_retry_at=new Date(NOW+structured).toISOString();const f=vi.fn(async()=>Response.json(body,{headers:{'Retry-After':String(http/1000)}}));vi.stubGlobal('fetch',f);render(<CboeQuotes/>);await tick();
  await tick(Math.max(http,structured)-2);expect(f).toHaveBeenCalledOnce();await tick(1);expect(f).toHaveBeenCalledTimes(2);
 });
 it('stops an unexpected followed redirect before consuming JSON',async()=>{
  const json=vi.fn(()=>new Promise(()=>{})),f=vi.fn(async()=>({status:200,redirected:true,headers:new Headers(),json}) as unknown as Response);vi.stubGlobal('fetch',f);render(<CboeQuotes/>);await tick();expect(screen.getByText('展示权限已失效')).toBeTruthy();expect(json).not.toHaveBeenCalled();await tick(180_000);expect(f).toHaveBeenCalledOnce();
 });
 it('clears an existing price after a stalled received body and retains its header cooldown',async()=>{
  const f=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(reply())).mockResolvedValue({status:503,headers:new Headers({'Retry-After':'600'}),json:()=>new Promise(()=>{})} as Response);vi.stubGlobal('fetch',f);render(<CboeQuotes/>);await tick();expect(price()).toBeTruthy();await tick(110_000);expect(price()).toBeNull();expect(screen.getByText('回复核验失败')).toBeTruthy();await tick(180_000);expect(f).toHaveBeenCalledTimes(2);
 });
 it('clears warm prices immediately on HTTP 403 even when its body never settles',async()=>{
  const json=vi.fn(()=>new Promise(()=>{})),f=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(reply())).mockResolvedValue({status:403,headers:new Headers(),json} as unknown as Response);vi.stubGlobal('fetch',f);render(<CboeQuotes/>);await tick();expect(price()).toBeTruthy();await tick(60_000);expect(price()).toBeNull();expect(screen.getByText('展示权限已失效')).toBeTruthy();expect(json).not.toHaveBeenCalled();await tick(180_000);expect(f).toHaveBeenCalledTimes(2);
 });
 it('clears unverifiable HTTP 429 evidence but honors its longer pause without a request storm',async()=>{
  const f=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(reply())).mockImplementation(async()=>new Response('rate limited',{status:429,headers:{'Retry-After':'3600'}}));vi.stubGlobal('fetch',f);render(<CboeQuotes/>);await tick();await tick(180_000);expect(price()).toBeNull();visibility('hidden');visibility('visible');expect(f).toHaveBeenCalledTimes(2);expect(screen.getByRole('button',{name:'检查更新'}).hasAttribute('disabled')).toBe(true);
 });
 it('aborts a hanging request on unmount and schedules no late work',async()=>{
  let finish!:(response:Response)=>void;const f=vi.fn<typeof fetch>(()=>new Promise(resolve=>{finish=resolve;}));vi.stubGlobal('fetch',f);const view=render(<CboeQuotes/>);await tick();view.unmount();expect(f.mock.calls[0][1]!.signal!.aborted).toBe(true);await act(async()=>finish(Response.json(reply())));await tick(180_000);expect(f).toHaveBeenCalledOnce();
 });
});
