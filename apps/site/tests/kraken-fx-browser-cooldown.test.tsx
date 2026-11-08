// @vitest-environment jsdom
import React from 'react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {useKrakenEvidence} from '../components/crypto/useKrakenEvidence';
import Forex from '../components/forex/Forex';
import {REFRESH_MS,MAX_CACHE_AGE_MS} from '../lib/crypto/contract';
import {CHECK_INTERVAL_MS} from '../lib/fx/model';
const now=Date.parse('2026-11-08T10:00:00Z');
const tick=async(ms=1)=>act(()=>vi.advanceTimersByTimeAsync(ms));
function Probe(){const v=useKrakenEvidence();return <><button onClick={()=>void v.refresh()}>refresh</button><button onClick={()=>v.applyScope(['BTC/USD'],'1m')}>scope</button><output>{v.loading?'pending':'idle'}</output></>}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(now);Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});});
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();});
function kraken(){return Response.json({snapshot:null,trade_snapshot:null,status:{state:'unavailable',error_code:'source_cooldown',last_attempt_at:null,fetched_at:null,cache_age_ms:null,refresh_ms:REFRESH_MS,max_cache_age_ms:MAX_CACHE_AGE_MS,next_retry_at:new Date(now+86400000).toISOString()}},{status:503,headers:{'Retry-After':'86400'}})}
it.each(['manual','scope','visibility','focus','automatic'])('Kraken honors 24h deadline via %s',async trigger=>{
 const fetcher=vi.fn(async()=>kraken());vi.stubGlobal('fetch',fetcher);render(<Probe/>);await tick();expect(fetcher).toHaveBeenCalledOnce();
 if(trigger==='manual')fireEvent.click(screen.getByRole('button',{name:'refresh'}));
 if(trigger==='scope')fireEvent.click(screen.getByRole('button',{name:'scope'}));
 if(trigger==='visibility')fireEvent(document,new Event('visibilitychange'));
 if(trigger==='focus')fireEvent(window,new Event('focus'));
 await tick(trigger==='automatic'?REFRESH_MS:1);expect(fetcher).toHaveBeenCalledTimes(1);expect(Date.now()).toBeLessThan(now+86400000);
 await tick(now+86400000-Date.now());expect(fetcher).toHaveBeenCalledTimes(2);
});
it('ECB automatic hourly check honors future next_check_at and Retry-After',async()=>{
 const fetcher=vi.fn(async()=>Response.json({snapshot:null,source_state:'unavailable',checked_at:new Date(now).toISOString(),next_check_at:new Date(now+86400000).toISOString(),error_code:'source_cooldown'},{status:503,headers:{'Retry-After':'86400'}}));
 vi.stubGlobal('fetch',fetcher);render(<Forex/>);await tick();expect(fetcher).toHaveBeenCalledOnce();
 await tick(CHECK_INTERVAL_MS);expect(fetcher).toHaveBeenCalledTimes(1);expect(Date.now()).toBeLessThan(now+86400000);
 await tick(now+86400000-Date.now());expect(fetcher).toHaveBeenCalledTimes(2);
});
it.each(['Kraken','ECB'])('%s keeps the stricter header deadline with a malformed body',async kind=>{
 const fetcher=vi.fn(async()=>new Response('bad gateway',{status:503,headers:{'Retry-After':new Date(now+86400000).toUTCString()}}));vi.stubGlobal('fetch',fetcher);
 render(kind==='Kraken'?<Probe/>:<Forex/>);await tick();await tick(86400000-2);expect(fetcher).toHaveBeenCalledOnce();await tick();expect(fetcher).toHaveBeenCalledTimes(2);
});
it.each(['Kraken','ECB'])('%s keeps the stricter body deadline over a short header',async kind=>{
 const fetcher=vi.fn(async()=>kind==='Kraken'?Response.json(await kraken().json(),{status:503,headers:{'Retry-After':'60'}}):Response.json({snapshot:null,source_state:'unavailable',checked_at:new Date(now).toISOString(),next_check_at:new Date(now+86400000).toISOString(),error_code:'source_cooldown'},{status:503,headers:{'Retry-After':'60'}}));vi.stubGlobal('fetch',fetcher);
 render(kind==='Kraken'?<Probe/>:<Forex/>);await tick();await tick(86400000-2);expect(fetcher).toHaveBeenCalledOnce();await tick();expect(fetcher).toHaveBeenCalledTimes(2);
});
it.each(['Kraken','ECB'])('%s never revives permission denial at cooldown expiry',async kind=>{
 const fetcher=vi.fn(async()=>new Response('denied',{status:403,headers:{'Retry-After':'3600'}}));vi.stubGlobal('fetch',fetcher);
 render(kind==='Kraken'?<Probe/>:<Forex/>);await tick();await tick(86400000);fireEvent(document,new Event('visibilitychange'));expect(fetcher).toHaveBeenCalledOnce();
});
it.each(['Kraken','ECB'])('%s cancels its deferred check on unmount',async kind=>{
 const fetcher=vi.fn(async()=>new Response('bad gateway',{status:503,headers:{'Retry-After':'86400'}}));vi.stubGlobal('fetch',fetcher);
 const view=render(kind==='Kraken'?<Probe/>:<Forex/>);await tick();view.unmount();await tick(86400000);expect(fetcher).toHaveBeenCalledOnce();
});

it('carries a late old-scope Kraken cooldown into the latest selection',async()=>{
 let resolve!:(response:Response)=>void;
 const fetcher=vi.fn<typeof fetch>(()=>new Promise<Response>(done=>{resolve=done;}));vi.stubGlobal('fetch',fetcher);render(<Probe/>);await tick();
 fireEvent.click(screen.getByRole('button',{name:'scope'}));await act(async()=>resolve(kraken()));
 fireEvent.click(screen.getByRole('button',{name:'refresh'}));await tick(86400000-2);expect(fetcher).toHaveBeenCalledOnce();
 await tick(2);expect(fetcher).toHaveBeenCalledTimes(2);expect(fetcher.mock.calls[1][0]).toContain('pairs=BTC%2FUSD');expect(fetcher.mock.calls[1][0]).toContain('window=1m');
});
it('keeps an out-of-Date-range ECB header wait without crashing or shortening it',async()=>{
 const fetcher=vi.fn(async()=>new Response('bad gateway',{status:503,headers:{'Retry-After':'9999999999999'}}));vi.stubGlobal('fetch',fetcher);
 render(<Forex/>);await tick();expect(screen.getByText(/等待服务器允许后再检查/)).toBeTruthy();await tick(CHECK_INTERVAL_MS);expect(fetcher).toHaveBeenCalledOnce();
});
