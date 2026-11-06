// @vitest-environment jsdom
// Synthetic application responses only; no source or production calls.
import React from 'react';
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {useTicResource} from '../components/atlas/useTicResource';
const parse=(v:unknown)=>{if(!(v as {valid?:boolean})?.valid)throw Error('invalid');return v as {valid:true}};
function Probe({status=false}:{status?:boolean}){const r=useTicResource('/tic',parse,status);return <><button onClick={()=>void r.refresh()}>refresh</button><span>{r.data?'verified':'empty'}</span><span>{r.error}</span><span>{r.loading?'loading':'settled'}</span></>}
const result=(body:unknown,status=200,headers:Record<string,string>={})=>({status,ok:status>=200&&status<300,headers:new Headers(headers),json:async()=>body}) as Response;
const tick=(ms=1)=>act(()=>vi.advanceTimersByTimeAsync(ms));
function visible(value:'visible'|'hidden'){Object.defineProperty(document,'visibilityState',{value,configurable:true});fireEvent(document,new Event('visibilitychange'));}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-06T12:00:00Z'));visible('visible');});
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();});
describe.each([false,true])('TIC lifecycle status=%s',status=>{
 it.each([401,403,407,429,451,302])('stops all automatic/manual acquisition after HTTP %s',async code=>{const fetcher=vi.fn(async()=>result({},code));vi.stubGlobal('fetch',fetcher);render(<Probe status={status}/>);await tick();fireEvent.click(screen.getByText('refresh'));await tick(120000);expect(fetcher).toHaveBeenCalledTimes(1);});
 it('rejects redirected success and never follows redirects',async()=>{const fetcher=vi.fn(async()=>({...result({valid:true,state:'available'}),redirected:true}));vi.stubGlobal('fetch',fetcher);render(<Probe status={status}/>);await tick(120001);expect(fetcher).toHaveBeenCalledTimes(1);expect(screen.getByText('empty')).toBeTruthy();expect((fetcher.mock.calls as unknown as [string,RequestInit][])[0][1].redirect).toBe('manual');});
 it.each(['3600', 'Fri, 06 Nov 2026 13:00:00 GMT'])('preserves Retry-After %s across clicks and visibility',async header=>{const fetcher=vi.fn(async()=>result({},503,{'Retry-After':header}));vi.stubGlobal('fetch',fetcher);render(<Probe status={status}/>);await tick();fireEvent.click(screen.getByText('refresh'));visible('hidden');await tick(120000);visible('visible');await tick(3479998);expect(fetcher).toHaveBeenCalledTimes(1);await tick(2);expect(fetcher).toHaveBeenCalledTimes(2);});
 it('does no hidden work and serializes clicks',async()=>{visible('hidden');const fetcher=vi.fn(()=>new Promise<Response>(()=>{}));vi.stubGlobal('fetch',fetcher);render(<Probe status={status}/>);await tick(120001);expect(fetcher).not.toHaveBeenCalled();visible('visible');await tick();fireEvent.click(screen.getByText('refresh'));expect(fetcher).toHaveBeenCalledTimes(1);});
 it.each(['fetch','body'])('bounds abort-ignoring %s and never overlaps a timed-out operation',async stage=>{const fetcher=vi.fn(()=>stage==='fetch'?new Promise<Response>(()=>{}):Promise.resolve({...result({}),json:()=>new Promise(()=>{})}));vi.stubGlobal('fetch',fetcher);render(<Probe status={status}/>);await tick(20001);expect(screen.getByText(/请求超时/)).toBeTruthy();expect(screen.getByText('settled')).toBeTruthy();fireEvent.click(screen.getByText('refresh'));await tick(120000);expect(fetcher).toHaveBeenCalledTimes(1);});
 it.each(['fetch','body'])('stops on rejected %s with an unknown outcome',async stage=>{const fetcher=vi.fn(()=>stage==='fetch'?Promise.reject(new TypeError('network failure')):Promise.resolve({...result({}),json:async()=>{throw new TypeError('body failure');}}));vi.stubGlobal('fetch',fetcher);render(<Probe status={status}/>);await tick();expect(screen.getByText('settled')).toBeTruthy();fireEvent.click(screen.getByText('refresh'));visible('hidden');visible('visible');await tick(120000);expect(fetcher).toHaveBeenCalledTimes(1);});
 it('stops on unsolicited AbortError without retrying',async()=>{const fetcher=vi.fn(async()=>{throw new DOMException('Aborted elsewhere','AbortError');});vi.stubGlobal('fetch',fetcher);render(<Probe status={status}/>);await tick();fireEvent.click(screen.getByText('refresh'));await tick(120000);expect(fetcher).toHaveBeenCalledTimes(1);});
 it('invalidates late completion after unmount',async()=>{let resolve!:(v:Response)=>void;const fetcher=vi.fn(()=>new Promise<Response>(r=>resolve=r));vi.stubGlobal('fetch',fetcher);const view=render(<Probe status={status}/>);await tick();view.unmount();resolve(result({valid:true,state:'available'}));await tick(120000);expect(fetcher).toHaveBeenCalledTimes(1);});
 it('preserves verified data on transient failure',async()=>{let failing=false;vi.stubGlobal('fetch',vi.fn(async(url:string)=>failing?result({},503):result(url.endsWith('/status')?{state:'available'}:{valid:true})));render(<Probe status={status}/>);await tick();expect(screen.getByText('verified')).toBeTruthy();failing=true;fireEvent.click(screen.getByText('refresh'));await tick();expect(screen.getByText('verified')).toBeTruthy();expect(screen.getByText(/503/)).toBeTruthy();});
 it('clears verified data on application refusal',async()=>{let denied=false;vi.stubGlobal('fetch',vi.fn(async(url:string)=>denied?result({},403):result(url.endsWith('/status')?{state:'available'}:{valid:true})));render(<Probe status={status}/>);await tick();denied=true;fireEvent.click(screen.getByText('refresh'));await tick();expect(screen.getByText('empty')).toBeTruthy();});
 it.each(['denied','uncertain','coordination_unavailable'])('displays cached payload once on source %s, then stops',async source=>{const fetcher=vi.fn(async(url:string)=>result(url.endsWith('/status')?{state:'stale',source_status:source}:{valid:true},200,{'X-Source-Status':source}));vi.stubGlobal('fetch',fetcher);render(<Probe status={status}/>);await tick();expect(screen.getByText('verified')).toBeTruthy();fireEvent.click(screen.getByText('refresh'));await tick(120000);expect(fetcher).toHaveBeenCalledTimes(status?2:1);});
});

describe('deferred snapshot acquisition',()=>{
 it.each(['ready','denied'])('does not start a snapshot hidden; resumes cached status once (%s)',async source=>{
  let resolve!:(response:Response)=>void;
  const fetcher=vi.fn((url:string)=>url.endsWith('/status')?new Promise<Response>(r=>resolve=r):Promise.resolve(result({valid:true},200,{'X-Source-Status':source})));
  vi.stubGlobal('fetch',fetcher);render(<Probe status/>);await tick();visible('hidden');
  resolve(result({state:'available',source_status:source,next_retry_at:new Date(Date.now()+3600000).toISOString()}));
  await tick(120000);expect(fetcher).toHaveBeenCalledTimes(1);
  visible('visible');await tick();expect(fetcher).toHaveBeenCalledTimes(2);expect(screen.getByText('verified')).toBeTruthy();
  expect(fetcher.mock.calls.map(call=>call[0])).toEqual(['/tic/status','/tic']);
  fireEvent.click(screen.getByText('refresh'));await tick(120000);expect(fetcher).toHaveBeenCalledTimes(2);
 });
});
