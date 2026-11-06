// @vitest-environment jsdom
import React from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {useReport} from '../components/markets/useReport';
import JapanMoney from '../components/markets/JapanMoney';
import TaiwanMoney from '../components/markets/TaiwanMoney';
import {replySchema as japanSchema,REFRESH_MS as JAPAN_REFRESH,MAX_CACHE_AGE_MS as JAPAN_CACHE} from '../lib/japan/model';
import {SUMMARY_REFRESH_MS,SUMMARY_CACHE_AGE_MS} from '../lib/national/tpex-summary-view';
import {japanFixture,JAPAN_TEST_NOW as NOW} from './japan-mof-ui-fixture';
import {summaryFixture} from './national-summary-fixture';
const parseJapan=(value:unknown)=>japanSchema.parse(value);
const tick=(ms=1)=>act(()=>vi.advanceTimersByTimeAsync(ms));
function visibility(value:'visible'|'hidden',emit=true){Object.defineProperty(document,'visibilityState',{value,configurable:true});if(emit)fireEvent(document,new Event('visibilitychange'));}
function Probe(){const r=useReport('/api/v1/japan/mof/snapshot',parseJapan,JAPAN_REFRESH);return <><button onClick={()=>void r.refresh()}>{r.loading?'pending':'check'}</button><output>{JSON.stringify({failure:r.failure,stamp:r.reply?.snapshot?.fetched_at??null})}</output></>;}
const result=()=>JSON.parse(screen.getByRole('status').textContent!);
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(NOW);visibility('visible',false);});
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();visibility('visible',false);});

describe('shared Japan/Taiwan report browser lifecycle',()=>{
 it.each(['fetch','body'] as const)('ends a hung %s wait and automatically recovers after a bounded browser pause',async stage=>{
  const f=vi.fn<typeof fetch>().mockImplementationOnce(()=>stage==='fetch'?new Promise(()=>{}):Promise.resolve({status:200,headers:new Headers(),json:()=>new Promise(()=>{})} as Response)).mockImplementation(async()=>Response.json(japanFixture()));vi.stubGlobal('fetch',f);render(<Probe/>);await tick();await tick(30_000);
  expect(screen.getByRole('button',{name:'check'})).toBeTruthy();expect(result().failure).toBe('network');expect(f.mock.calls[0][1]!.signal!.aborted).toBe(true);
  visibility('hidden');visibility('visible');fireEvent.click(screen.getByRole('button',{name:'check'}));await tick(59_998);expect(f).toHaveBeenCalledOnce();await tick(1);expect(f).toHaveBeenCalledTimes(2);expect(result().failure).toBeNull();
 });
 it('does not start an initial hidden request or hidden manual request',async()=>{
  visibility('hidden',false);const f=vi.fn(async()=>Response.json(japanFixture()));vi.stubGlobal('fetch',f);render(<Probe/>);await tick();fireEvent.click(screen.getByRole('button',{name:'check'}));expect(f).not.toHaveBeenCalled();visibility('visible');await tick();expect(f).toHaveBeenCalledOnce();
 });
 it('enforces the six-hour server pause on repeated manual and visibility calls',async()=>{
  const f=vi.fn(async()=>Response.json(japanFixture()));vi.stubGlobal('fetch',f);render(<Probe/>);await tick();for(let i=0;i<3;i++){fireEvent.click(screen.getByRole('button',{name:'check'}));visibility('hidden');visibility('visible');await tick(1000);}expect(f).toHaveBeenCalledOnce();
 });
 it.each(['3600',new Date(NOW+3600_000).toUTCString()])('keeps Retry-After %s even when the response body hangs',async header=>{
  const f=vi.fn(async()=>({status:503,headers:new Headers({'Retry-After':header}),json:()=>new Promise(()=>{})}) as unknown as Response);vi.stubGlobal('fetch',f);render(<Probe/>);await tick();await tick(30_000);expect(result().failure).toBe('network');await tick(180_000);visibility('hidden');visibility('visible');fireEvent.click(screen.getByRole('button',{name:'check'}));expect(f).toHaveBeenCalledOnce();
 });
 it('honors a shorter structured coordination pause instead of waiting the normal six hours',async()=>{
  const body=japanFixture();body.snapshot=null;body.status={...body.status,state:'unavailable',error_code:'source_busy',next_retry_at:new Date(NOW+120_000).toISOString()};const f=vi.fn(async()=>Response.json(body,{status:503}));vi.stubGlobal('fetch',f);render(<Probe/>);await tick();await tick(119_998);expect(f).toHaveBeenCalledOnce();await tick(1);expect(f).toHaveBeenCalledTimes(2);
 });
 it('chunks a 40-day server deadline and never retries at the timer overflow boundary',async()=>{
  vi.spyOn(globalThis,'setInterval').mockImplementation((()=>0) as unknown as typeof setInterval);const timers=vi.spyOn(globalThis,'setTimeout'),body=japanFixture();body.status.next_retry_at=new Date(NOW+40*86400_000).toISOString();const f=vi.fn(async()=>Response.json(body));vi.stubGlobal('fetch',f);render(<Probe/>);await tick();expect(timers.mock.calls.every(call=>typeof call[1]!=='number'||call[1]<=2_147_483_647)).toBe(true);await tick(2_147_483_646);expect(f).toHaveBeenCalledOnce();await tick(40*86400_000-2_147_483_647-1);expect(f).toHaveBeenCalledOnce();await tick(1);expect(f).toHaveBeenCalledTimes(2);
 });
 it.each([401,403,407,451])('stops HTTP %s before body parsing and keeps the stop on wakes',async status=>{
  const json=vi.fn(()=>new Promise(()=>{})),f=vi.fn(async()=>({status,headers:new Headers(),json}) as unknown as Response);vi.stubGlobal('fetch',f);render(<Probe/>);await tick();expect(result().failure).toBe('permission');expect(json).not.toHaveBeenCalled();visibility('hidden');visibility('visible');await tick(180_000);expect(f).toHaveBeenCalledOnce();
 });
 it('ignores a body arriving after timeout and a newer successful check',async()=>{
  let finish!:(value:unknown)=>void;const late=japanFixture();late.snapshot!.fetched_at=late.status.fetched_at=new Date(NOW-1000).toISOString();late.snapshot!.acquisition_started_at=late.snapshot!.fetched_at;
  const f=vi.fn<typeof fetch>().mockResolvedValueOnce({status:200,headers:new Headers(),json:()=>new Promise(resolve=>{finish=resolve;})} as Response).mockImplementation(async()=>Response.json(japanFixture()));vi.stubGlobal('fetch',f);render(<Probe/>);await tick(90_001);expect(result().stamp).toBe(new Date(NOW).toISOString());await act(async()=>finish(late));expect(result().stamp).toBe(new Date(NOW).toISOString());expect(f).toHaveBeenCalledTimes(2);
 });
 it('lets admitted hidden work finish, then starts no successor until visible and due',async()=>{
  let finish!:(response:Response)=>void;const f=vi.fn<typeof fetch>(()=>new Promise(resolve=>{finish=resolve;}));vi.stubGlobal('fetch',f);render(<Probe/>);await tick();visibility('hidden');expect(f.mock.calls[0][1]!.signal!.aborted).toBe(false);await act(async()=>finish(Response.json(japanFixture())));await tick(JAPAN_REFRESH);expect(f).toHaveBeenCalledOnce();visibility('visible');await tick();expect(f).toHaveBeenCalledTimes(2);
 });
 it.each([['Japan',JapanMoney,JAPAN_REFRESH,JAPAN_CACHE],['Taiwan',TaiwanMoney,SUMMARY_REFRESH_MS,SUMMARY_CACHE_AGE_MS]] as const)('%s marks an old report stale and hides original cache expiry while hidden',async(name,Component,interval,cache)=>{
  const body=name==='Japan'?japanFixture():summaryFixture();if(name==='Taiwan'){body.snapshot!.fetched_at=body.snapshot!.acquisition_started_at=new Date(NOW).toISOString();body.status.fetched_at=new Date(NOW).toISOString();}
  const f=vi.fn(async()=>Response.json(body));vi.stubGlobal('fetch',f);render(<Component/>);await tick();visibility('hidden');vi.setSystemTime(NOW+interval+1);await tick(30_000);expect(screen.getByText(name==='Japan'?'保留最近已核验周报 · 注意时效':'保留最近已核验报告 · 注意时效')).toBeTruthy();vi.setSystemTime(NOW+cache+1);await tick(30_000);expect(screen.queryByText(name==='Japan'?'+5 亿 JPY':'+100 TWD',{selector:'strong'})).toBeNull();expect(f).toHaveBeenCalledOnce();
 });
 it('aborts on unmount without admitting or publishing a late result',async()=>{
  let finish!:(response:Response)=>void;const f=vi.fn<typeof fetch>(()=>new Promise(resolve=>{finish=resolve;}));vi.stubGlobal('fetch',f);const view=render(<Probe/>);await tick();view.unmount();expect(f.mock.calls[0][1]!.signal!.aborted).toBe(true);await act(async()=>finish(Response.json(japanFixture())));await tick(120_000);expect(f).toHaveBeenCalledOnce();
 });
 it.each([{status:302},{status:200,redirected:true},{status:0,type:'opaqueredirect'}])('stops a redirect response %j before its stalled body',async response=>{
  const json=vi.fn(()=>new Promise(()=>{})),f=vi.fn(async()=>({...response,headers:new Headers(),json}) as unknown as Response);vi.stubGlobal('fetch',f);render(<Probe/>);await tick();expect(result().failure).toBe('permission');expect(json).not.toHaveBeenCalled();visibility('hidden');visibility('visible');fireEvent.click(screen.getByRole('button',{name:'check'}));await tick(180_000);expect(f).toHaveBeenCalledOnce();
 });
 it('keeps a structured source denial terminal despite manual checks and wakes',async()=>{
  const body=japanFixture();body.snapshot=null;body.status={...body.status,state:'denied',error_code:'source_denied',next_retry_at:null};const f=vi.fn(async()=>Response.json(body,{status:503}));vi.stubGlobal('fetch',f);render(<Probe/>);await tick();visibility('hidden');visibility('visible');fireEvent.click(screen.getByRole('button',{name:'check'}));await tick(180_000);expect(f).toHaveBeenCalledOnce();expect(result().stamp).toBeNull();
 });
 it('uses the normal six-hour cadence for success without a server deadline',async()=>{
  const body=japanFixture();body.status.next_retry_at=null;const f=vi.fn(async()=>Response.json(body));vi.stubGlobal('fetch',f);render(<Probe/>);await tick(JAPAN_REFRESH-1);expect(f).toHaveBeenCalledOnce();await tick(1);expect(f).toHaveBeenCalledTimes(2);
 });
 it.each([[120,300],[300,120]])('retains the longer pause when header %s and body %s seconds disagree',async(header,bodySeconds)=>{
  const body=japanFixture();body.status.next_retry_at=new Date(NOW+bodySeconds*1000).toISOString();const f=vi.fn(async()=>Response.json(body,{headers:{'Retry-After':String(header)}}));vi.stubGlobal('fetch',f);render(<Probe/>);await tick(299_999);expect(f).toHaveBeenCalledOnce();await tick(1);expect(f).toHaveBeenCalledTimes(2);
 });

});
