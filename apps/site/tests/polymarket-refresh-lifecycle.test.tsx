// @vitest-environment jsdom
import React from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {useSnapshot} from '../components/polymarket/useSnapshot';
import {parseHotPolymarket} from '../lib/polymarket/adapter';
import {REFRESH_MS,MAX_CACHE_AGE_MS,type PolymarketReply,type PolymarketView} from '../lib/polymarket/model';
import {fixture,NOW} from './polymarket-fixture';
const wait=async(ms=1)=>act(()=>vi.advanceTimersByTimeAsync(ms));
function visibility(value:'visible'|'hidden',emit=true){Object.defineProperty(document,'visibilityState',{value,configurable:true});if(emit)fireEvent(document,new Event('visibilitychange'));}
function sample(at=NOW):PolymarketReply{const time=new Date(at).toISOString();return {snapshot:parseHotPolymarket(fixture(),time,time),status:{state:'available',error_code:null,last_attempt_at:time,fetched_at:time,cache_age_ms:0,refresh_ms:REFRESH_MS,max_cache_age_ms:MAX_CACHE_AGE_MS,next_retry_at:null}};}
function Probe({view='hot'}:{view?:PolymarketView}){const result=useSnapshot(view);return <><button onClick={()=>void result.refresh()}>{result.loading?'pending':'check'}</button><output data-testid="state">{JSON.stringify({error:result.error,denied:result.denied,stale:result.stale,cooling:result.coolingDown,fetched:result.snapshot?.fetched_at??null})}</output></>;}
const state=()=>JSON.parse(screen.getByTestId('state').textContent!);
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(NOW);visibility('visible',false);});
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();visibility('visible',false);});

describe('Polymarket browser refresh lifecycle',()=>{
 it.each(['fetch','body'] as const)('settles a hung %s at the browser deadline and recovers after a full cooldown',async stage=>{
  const never=new Promise<Response>(()=>{}),fetcher=vi.fn<typeof fetch>();
  fetcher.mockImplementationOnce(()=>stage==='fetch'?never:Promise.resolve({status:200,headers:new Headers(),json:()=>new Promise(()=>{})} as Response)).mockImplementation(async()=>Response.json(sample(Date.now())));
  vi.stubGlobal('fetch',fetcher);render(<Probe/>);await wait();expect(screen.getByRole('button',{name:'pending'})).toBeTruthy();
  await wait(20_000);expect(screen.getByRole('button',{name:'check'})).toBeTruthy();expect(state().error).toBe('network');expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'check'}));visibility('hidden');visibility('visible');await wait(29_998);expect(fetcher).toHaveBeenCalledTimes(1);
  await wait(1);expect(fetcher).toHaveBeenCalledTimes(2);expect(state().error).toBeNull();expect(state().fetched).not.toBeNull();
 });
 it('cannot publish an old body after a timeout, mode switch and newer success',async()=>{
  let finish!:(value:unknown)=>void;const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce({status:200,headers:new Headers(),json:()=>new Promise(resolve=>{finish=resolve;})} as Response).mockImplementation(async()=>Response.json(sample(Date.now())));
  vi.stubGlobal('fetch',fetcher);const view=render(<Probe/>);await wait();view.rerender(<Probe view="newest"/>);await wait(20_000);view.rerender(<Probe/>);await wait(30_000);
  const newer=state().fetched;expect(newer).not.toBeNull();await act(async()=>finish(sample()));expect(state().fetched).toBe(newer);expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it.each(['120',new Date(NOW+120_000).toUTCString()])('keeps Retry-After %s even when the temporary response body hangs',async value=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce({status:503,headers:new Headers({'Retry-After':value}),json:()=>new Promise(()=>{})} as Response).mockImplementation(async()=>Response.json(sample(Date.now())));
  vi.stubGlobal('fetch',fetcher);const view=render(<Probe/>);await wait();await wait(20_000);expect(state().error).toBe('network');view.rerender(<Probe view="newest"/>);visibility('hidden');visibility('visible');
  await wait(99_998);expect(fetcher).toHaveBeenCalledTimes(1);expect(state().cooling).toBe(true);await wait(1);expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('honors a temporary HTTP Retry-After across invalid JSON, manual calls and all modes',async()=>{
  const fetcher=vi.fn(async()=>new Response('gateway unavailable',{status:503,headers:{'Retry-After':'3600'}}));vi.stubGlobal('fetch',fetcher);const view=render(<Probe/>);await wait();
  for(const mode of ['newest','interest','hot'] as const){view.rerender(<Probe view={mode}/>);fireEvent.click(screen.getByRole('button',{name:'check'}));visibility('hidden');visibility('visible');await wait(30_000);}
  expect(fetcher).toHaveBeenCalledTimes(1);expect(state().cooling).toBe(true);
 });
 it('clamps timer chunks without shortening a server deadline longer than the browser timer limit',async()=>{
  vi.spyOn(globalThis,'setInterval').mockImplementation((()=>0) as unknown as typeof setInterval);
  const timeout=vi.spyOn(globalThis,'setTimeout'),value=sample();value.status.next_retry_at=new Date(NOW+40*86400_000).toISOString();
  const fetcher=vi.fn(async()=>Response.json(value));vi.stubGlobal('fetch',fetcher);render(<Probe/>);await wait();
  expect(timeout.mock.calls.every(call=>typeof call[1]!=='number'||call[1]<=2_147_483_647)).toBe(true);
  await wait(2_147_483_646);expect(fetcher).toHaveBeenCalledOnce();
  await wait(40*86400_000-2_147_483_647-1);expect(fetcher).toHaveBeenCalledOnce();
  visibility('hidden');visibility('visible');expect(fetcher).toHaveBeenCalledOnce();expect(state().cooling).toBe(true);
  await wait(1);expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it.each([401,403,407,451])('stops HTTP %s without waiting for a hanging body or reviving after mode changes',async status=>{
  const json=vi.fn(()=>new Promise(()=>{})),fetcher=vi.fn(async()=>({status,headers:new Headers(),json}) as unknown as Response);vi.stubGlobal('fetch',fetcher);const view=render(<Probe/>);await wait();
  expect(state().denied).toBe(true);expect(state().error).toBe('permission');expect(json).not.toHaveBeenCalled();view.rerender(<Probe view="interest"/>);visibility('hidden');visibility('visible');await wait(180_000);expect(fetcher).toHaveBeenCalledOnce();
 });
 it('stops a redirect at the response headers instead of following a login path',async()=>{
  const json=vi.fn(()=>new Promise(()=>{})),fetcher=vi.fn(async()=>({status:302,headers:new Headers(),json}) as unknown as Response);vi.stubGlobal('fetch',fetcher);render(<Probe/>);await wait();
  expect(fetcher).toHaveBeenCalledWith(expect.any(String),expect.objectContaining({redirect:'manual'}));expect(state().denied).toBe(true);expect(json).not.toHaveBeenCalled();await wait(60_000);expect(fetcher).toHaveBeenCalledOnce();
 });

 it('ignores a fetch response arriving after its deadline and a newer success',async()=>{
  let finish!:(response:Response)=>void;const json=vi.fn(async()=>sample()),fetcher=vi.fn<typeof fetch>().mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockImplementation(async()=>Response.json(sample(Date.now())));
  vi.stubGlobal('fetch',fetcher);render(<Probe/>);await wait();await wait(50_000);const newer=state().fetched;expect(newer).not.toBeNull();
  await act(async()=>finish({status:200,headers:new Headers(),json} as unknown as Response));expect(state().fetched).toBe(newer);expect(json).not.toHaveBeenCalled();expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('stops the browser opaque manual-redirect shape before reading its body',async()=>{
  const json=vi.fn(()=>new Promise(()=>{})),fetcher=vi.fn(async()=>({status:0,type:'opaqueredirect',headers:new Headers(),json}) as unknown as Response);vi.stubGlobal('fetch',fetcher);render(<Probe/>);await wait();
  expect(state().denied).toBe(true);expect(state().error).toBe('permission');expect(json).not.toHaveBeenCalled();await wait(60_000);expect(fetcher).toHaveBeenCalledOnce();
 });
 it.each(['invalid','hung'] as const)('honors HTTP 429 with a %s body without extending cached evidence',async body=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(sample())).mockImplementation(async()=>body==='invalid'?new Response('rate limited',{status:429,headers:{'Retry-After':'600'}}):{status:429,headers:new Headers({'Retry-After':'600'}),json:()=>new Promise(()=>{})} as Response);
  vi.stubGlobal('fetch',fetcher);render(<Probe/>);await wait();await wait(50_000);expect(state().error).toBe('network');expect(state().stale).toBe(true);expect(state().fetched).toBe(new Date(NOW).toISOString());
  await wait(MAX_CACHE_AGE_MS);expect(state().fetched).toBeNull();fireEvent.click(screen.getByRole('button',{name:'check'}));visibility('hidden');visibility('visible');expect(fetcher).toHaveBeenCalledTimes(2);expect(state().cooling).toBe(true);
 });
 it('lets admitted hidden work finish, starts no hidden successor, and expires retained evidence on its original clock',async()=>{
  let finish!:(response:Response)=>void;const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(sample())).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));vi.stubGlobal('fetch',fetcher);render(<Probe/>);await wait();await wait(REFRESH_MS);visibility('hidden');
  const signal=fetcher.mock.calls[1][1]!.signal!;expect(signal.aborted).toBe(false);await act(async()=>finish(new Response('gateway',{status:503})));
  expect(state().stale).toBe(true);expect(state().fetched).toBe(new Date(NOW).toISOString());await wait(MAX_CACHE_AGE_MS);expect(state().fetched).toBeNull();expect(fetcher).toHaveBeenCalledTimes(2);visibility('visible');await wait();expect(fetcher).toHaveBeenCalledTimes(3);
 });
 it('coalesces repeated switches, manual clicks and hide/show events into one active request',async()=>{
  let finish!:(response:Response)=>void;const fetcher=vi.fn<typeof fetch>(()=>new Promise(resolve=>{finish=resolve;}));vi.stubGlobal('fetch',fetcher);const view=render(<Probe/>);await wait();
  for(const mode of ['newest','hot','interest'] as const){view.rerender(<Probe view={mode}/>);fireEvent.click(screen.getByRole('button',{name:'pending'}));visibility('hidden');visibility('visible');await wait();}
  expect(fetcher).toHaveBeenCalledOnce();await act(async()=>finish(Response.json(sample())));await wait(REFRESH_MS);expect(fetcher).toHaveBeenCalledTimes(2);expect(fetcher.mock.calls[1][0]).toBe('/api/v1/polymarket/snapshot?view=interest');
 });
 it('aborts and releases browser work on unmount without a late timer or response restart',async()=>{
  let finish!:(response:Response)=>void;const fetcher=vi.fn<typeof fetch>(()=>new Promise(resolve=>{finish=resolve;}));vi.stubGlobal('fetch',fetcher);const view=render(<Probe/>);await wait();view.unmount();expect(fetcher.mock.calls[0][1]!.signal!.aborted).toBe(true);await act(async()=>finish(Response.json(sample())));await wait(120_000);visibility('hidden');visibility('visible');expect(fetcher).toHaveBeenCalledOnce();
 });
});
