// @vitest-environment jsdom
import React from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import CvmFunds from '../components/cvm/CvmFunds';
import {MAX_CACHE_AGE_MS,REFRESH_MS,type CvmReply} from '../lib/cvm/model';
import {fixtureSnapshot} from './cvm-fixture';
const NOW=Date.parse('2026-11-05T00:01:00Z');let valid:CvmReply;
const tick=(ms=1)=>act(()=>vi.advanceTimersByTimeAsync(ms));
function visibility(value:'visible'|'hidden',emit=true){Object.defineProperty(document,'visibilityState',{value,configurable:true});if(emit)fireEvent(document,new Event('visibilitychange'));}
beforeEach(async()=>{const snapshot=await fixtureSnapshot();valid={snapshot,status:{state:'available',error_code:null,last_attempt_at:snapshot.acquisition_started_at,fetched_at:snapshot.fetched_at,cache_age_ms:0,refresh_ms:REFRESH_MS,max_cache_age_ms:MAX_CACHE_AGE_MS,next_retry_at:new Date(NOW+REFRESH_MS).toISOString()}};vi.useFakeTimers();vi.setSystemTime(NOW);visibility('visible',false);});
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();visibility('visible',false);});
describe('CVM browser lifecycle',()=>{
 it.each(['fetch','body'] as const)('recovers from an ignored-abort %s within its 65-second deadline',async stage=>{
  const f=vi.fn<typeof fetch>().mockImplementationOnce(()=>stage==='fetch'?new Promise(()=>{}):Promise.resolve({status:200,headers:new Headers(),json:()=>new Promise(()=>{})} as Response)).mockImplementation(async()=>Response.json(valid));vi.stubGlobal('fetch',f);render(<CvmFunds/>);await tick(65_001);expect(screen.getByRole('button',{name:'检查月报'})).toBeTruthy();expect(f.mock.calls[0][1]!.signal!.aborted).toBe(true);await tick(59_998);expect(f).toHaveBeenCalledOnce();await tick(1);expect(f).toHaveBeenCalledTimes(2);expect(screen.getByText('已取得可校验的月度交易报告')).toBeTruthy();
 });
 it('starts no hidden initial or manual check',async()=>{visibility('hidden',false);const f=vi.fn(async()=>Response.json(valid));vi.stubGlobal('fetch',f);render(<CvmFunds/>);await tick();fireEvent.click(screen.getByRole('button',{name:'检查月报'}));expect(f).not.toHaveBeenCalled();visibility('visible');await tick();expect(f).toHaveBeenCalledOnce();});
 it('retains the structured daily cooldown on manual checks and visibility wakes',async()=>{const f=vi.fn(async()=>Response.json(valid));vi.stubGlobal('fetch',f);render(<CvmFunds/>);await tick();for(let i=0;i<3;i++){fireEvent.click(screen.getByRole('button',{name:'检查月报'}));visibility('hidden');visibility('visible');await tick(1000);}expect(f).toHaveBeenCalledOnce();});
 it('retains a 40-day HTTP pause even when the body stalls',async()=>{const f=vi.fn(async()=>({status:503,headers:new Headers({'Retry-After':'3456000'}),json:()=>new Promise(()=>{})}) as Response);vi.stubGlobal('fetch',f);render(<CvmFunds/>);await tick(65_001);expect(screen.getByRole('button',{name:'检查月报'})).toHaveProperty('disabled',true);expect(screen.getByText('2026-12-15 00:01:00.000 UTC')).toBeTruthy();visibility('hidden');visibility('visible');await tick(120_000);expect(f).toHaveBeenCalledOnce();});
 it('uses a permitted 60-second coordination retry rather than waiting a day',async()=>{const unavailable={snapshot:null,status:{...valid.status,state:'unavailable',error_code:'source_busy',next_retry_at:new Date(NOW+60_000).toISOString()}};const f=vi.fn(async()=>Response.json(unavailable,{status:503}));vi.stubGlobal('fetch',f);render(<CvmFunds/>);await tick(59_999);expect(f).toHaveBeenCalledOnce();await tick(1);expect(f).toHaveBeenCalledTimes(2);});
 it.each([407,451])('stops HTTP %s before reading a stalled body',async status=>{const json=vi.fn(()=>new Promise(()=>{})),f=vi.fn(async()=>({status,headers:new Headers(),json}) as unknown as Response);vi.stubGlobal('fetch',f);render(<CvmFunds/>);await tick();expect(screen.getByText('展示权限已失效')).toBeTruthy();expect(json).not.toHaveBeenCalled();visibility('hidden');visibility('visible');await tick(180_000);expect(f).toHaveBeenCalledOnce();});
 it('ignores a late body after timeout and a newer successful report',async()=>{
  let finish!:(value:unknown)=>void;const late=structuredClone(valid);late.snapshot!.fetched_at=late.status.fetched_at=new Date(NOW-1000).toISOString();const f=vi.fn<typeof fetch>().mockResolvedValueOnce({status:200,headers:new Headers(),json:()=>new Promise(resolve=>{finish=resolve;})} as Response).mockImplementation(async()=>Response.json(valid));vi.stubGlobal('fetch',f);render(<CvmFunds/>);await tick(125_001);expect(screen.getByText('2026-11-05 00:01:00Z'.replace('Z',' UTC'))).toBeTruthy();await act(async()=>finish(late));expect(screen.queryByText('2026-11-05 00:00:59.000 UTC')).toBeNull();expect(f).toHaveBeenCalledTimes(2);
 });
 it('allows admitted hidden work to finish without admitting another request',async()=>{
  let finish!:(r:Response)=>void;const f=vi.fn<typeof fetch>(()=>new Promise(resolve=>{finish=resolve;}));vi.stubGlobal('fetch',f);render(<CvmFunds/>);await tick();visibility('hidden');expect(f.mock.calls[0][1]!.signal!.aborted).toBe(false);await act(async()=>finish(Response.json(valid)));await tick(REFRESH_MS);expect(f).toHaveBeenCalledOnce();visibility('visible');await tick();expect(f).toHaveBeenCalledTimes(2);
 });
 it('keeps original report expiry and never paints old amounts as fresh while hidden',async()=>{
  const f=vi.fn(async()=>Response.json(valid));vi.stubGlobal('fetch',f);render(<CvmFunds/>);await tick();visibility('hidden');vi.setSystemTime(NOW+REFRESH_MS+1);await tick(30_000);expect(screen.getByText('保留已校验月报 · 请注意陈旧状态')).toBeTruthy();vi.setSystemTime(NOW+MAX_CACHE_AGE_MS+1);await tick(30_000);expect(document.querySelector('g[data-id="Bancos"]')).toBeNull();expect(f).toHaveBeenCalledOnce();
 });
 it('does not loop on an impossible structured UTC offset',async()=>{
  valid.status.next_retry_at='2026-11-06T10:00:00+99:99';const f=vi.fn(async()=>Response.json(valid));vi.stubGlobal('fetch',f);render(<CvmFunds/>);await tick(59_999);expect(f).toHaveBeenCalledOnce();await tick(1);expect(f).toHaveBeenCalledTimes(2);
 });

});
