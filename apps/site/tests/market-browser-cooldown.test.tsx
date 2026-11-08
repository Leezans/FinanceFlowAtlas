// @vitest-environment jsdom
import React from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import Cftc from '../components/futures/FuturesPositioning';
import Asean from '../components/asean/AseanFdi';
import Deribit from '../components/options/DeribitOptions';
import * as cftc from '../lib/futures/model';
import * as asean from '../lib/asean/model';
import * as options from '../lib/options/model';
const NOW=Date.parse('2026-11-08T10:00:00Z');
const tick=(ms=1)=>act(()=>vi.advanceTimersByTimeAsync(ms));
const visibility=(value:string)=>{Object.defineProperty(document,'visibilityState',{value,configurable:true});fireEvent(document,new Event('visibilitychange'));};
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve};}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(NOW);visibility('visible');});
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();});
for(const [name,Component,model,button,timeout] of [['CFTC',Cftc,cftc,'检查报告',20_000],['ASEAN',Asean,asean,'检查报告',30_000],['Deribit',Deribit,options,'检查更新',20_000]] as const){
 const reply=(seconds=0)=>model.replySchema.parse({snapshot:null,status:{state:'unavailable',error_code:'source_cooldown',last_attempt_at:null,fetched_at:null,cache_age_ms:null,refresh_ms:model.REFRESH_MS,max_cache_age_ms:model.MAX_CACHE_AGE_MS,next_retry_at:seconds?new Date(NOW+seconds*1000).toISOString():null}});
 describe(`${name} bounded browser cooldown`,()=>{
  it.each([{header:'86400',body:120,wait:86400},{header:'120',body:86400,wait:86400},{header:new Date(NOW+180_000).toUTCString(),body:120,wait:180},{header:'1',body:1,wait:60}])('honors maximum header/body/browser floor $header / $body',async({header,body,wait})=>{
   const fetcher=vi.fn(async()=>Response.json(reply(body),{status:503,headers:{'Retry-After':header}}));vi.stubGlobal('fetch',fetcher);render(<Component/>);await tick();
   expect(screen.getByRole('button',{name:button})).toHaveProperty('disabled',true);fireEvent.click(screen.getByRole('button',{name:button}));visibility('hidden');visibility('visible');fireEvent(window,new Event('focus'));
   // Suspend the tab clock without running thousands of source-independent UI ticks.
   vi.setSystemTime(NOW+wait*1000-1);fireEvent(window,new Event('focus'));await tick(0);expect(fetcher).toHaveBeenCalledOnce();
   vi.setSystemTime(NOW+wait*1000);fireEvent(window,new Event('focus'));await tick(0);expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each(['manual','timer','visibility'] as const)('recovers through %s only once the window opens',async trigger=>{
   const fetcher=vi.fn(async()=>Response.json(reply(),{status:503}));vi.stubGlobal('fetch',fetcher);render(<Component/>);await tick();
   if(trigger==='timer')await tick(59_999);
   else{visibility('hidden');vi.setSystemTime(NOW+60_000);if(trigger==='manual'){Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});await tick(30_000);fireEvent.click(screen.getByRole('button',{name:button}));}else visibility('visible');await tick(0);}
   expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each(['fetch','body'] as const)('bounds hanging %s and ignores late denied data',async stage=>{
   const pending=deferred<Response>(),body=deferred<unknown>();
   const fetcher=vi.fn(()=>stage==='fetch'?pending.promise:Promise.resolve({status:200,headers:new Headers(),json:()=>body.promise} as Response));vi.stubGlobal('fetch',fetcher);render(<Component/>);await tick();await tick(timeout-1);
   expect(screen.getByRole('button',{name:button})).toHaveProperty('disabled',true);
   const denied={...reply(),status:{...reply().status,state:'denied'}};await act(async()=>{pending.resolve(Response.json(denied));body.resolve(denied);});expect(screen.queryByText('来源访问已停止')).toBeNull();
   fetcher.mockImplementation(async()=>Response.json(reply(),{status:503}));await tick(59_999);expect(fetcher).toHaveBeenCalledOnce();await tick();expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each(['fetch','body'] as const)('cancels %s on unmount without applying late results',async stage=>{
   const pending=deferred<Response>(),body=deferred<unknown>();let signal:AbortSignal|undefined;
   vi.stubGlobal('fetch',vi.fn((_url,init)=>{signal=init.signal;return stage==='fetch'?pending.promise:Promise.resolve({status:200,headers:new Headers(),json:()=>body.promise});}));const view=render(<Component/>);await tick();view.unmount();await tick();expect(signal?.aborted).toBe(true);expect(vi.getTimerCount()).toBe(0);await act(async()=>{pending.resolve(Response.json(reply()));body.resolve(reply());});expect(vi.getTimerCount()).toBe(0);
  });
 });
}
