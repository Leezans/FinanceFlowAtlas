// @vitest-environment jsdom
import React from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import TpexInstitutional from '../components/tpex/TpexInstitutional';
import {MAX_CACHE_AGE_MS,REFRESH_MS} from '../lib/tpex/model';
import {reply,NOW} from './tpex-fixture';
const tick=(ms=1)=>act(()=>vi.advanceTimersByTimeAsync(ms));
const button=()=>screen.getByRole('button',{name:'检查报告'});
const visibility=(state:'visible'|'hidden')=>{
 Object.defineProperty(document,'visibilityState',{value:state,configurable:true});
 fireEvent(document,new Event('visibilitychange'));
};
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve};}
async function start(){const view=render(<TpexInstitutional/>);await tick();return view;}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(NOW);Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});});
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();});
describe('TPEx uses the shared bounded browser lifecycle',()=>{
 it.each([
  {header:'180',body:120,wait:180_000},
  {header:'120',body:180,wait:180_000},
  {header:new Date(NOW+180_000).toUTCString(),body:120,wait:180_000},
  {header:'1',body:1,wait:60_000},
 ])('honors the maximum header/body/browser deadline: $header / $body',async({header,body,wait})=>{
  const result=reply();result.snapshot=null;result.status.state='unavailable';result.status.next_retry_at=new Date(NOW+body*1000).toISOString();
  const fetcher=vi.fn(async()=>Response.json(result,{status:503,headers:{'Retry-After':header}}));vi.stubGlobal('fetch',fetcher);await start();
  expect(button()).toHaveProperty('disabled',true);fireEvent.click(button());visibility('hidden');visibility('visible');fireEvent(window,new Event('focus'));await tick(wait-2);
  expect(fetcher).toHaveBeenCalledTimes(1);expect(screen.getByText(/下次允许检查/)).toBeTruthy();
  await tick(1);expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('does not overflow an extremely long Retry-After or allow early manual/focus checks',async()=>{
  const fetcher=vi.fn(async()=>Response.json({snapshot:null,status:{...reply().status,state:'unavailable'}},{status:503,headers:{'Retry-After':'999999999999999999999'}}));vi.stubGlobal('fetch',fetcher);await start();
  expect(screen.getByText(/服务器指定的等待期结束后/)).toBeTruthy();expect(button()).toHaveProperty('disabled',true);fireEvent.click(button());visibility('hidden');visibility('visible');await tick(60_000);expect(fetcher).toHaveBeenCalledOnce();
 });
 it('keeps selected industry/company/participant across cooldown and a newer report',async()=>{
  const fetcher=vi.fn(async()=>Response.json(reply()));vi.stubGlobal('fetch',fetcher);await start();
  fireEvent.change(screen.getByRole('combobox'),{target:{value:'24'}});fireEvent.click(screen.getByRole('button',{name:'投信'}));fireEvent.click(screen.getByRole('button',{name:/测试1001.*\+10 股/}));
  const next=reply();next.snapshot!.rows[0].name='更新公司';fetcher.mockImplementation(async()=>Response.json(next));
  fireEvent.click(button());visibility('hidden');visibility('visible');await tick(REFRESH_MS-2);expect(fetcher).toHaveBeenCalledOnce();
  await tick(1);expect(fetcher).toHaveBeenCalledTimes(2);expect(screen.getByRole('combobox')).toHaveProperty('value','24');expect(screen.getByRole('button',{name:'投信'}).getAttribute('aria-pressed')).toBe('true');expect(screen.getByRole('region',{name:'选中公司详情'}).textContent).toContain('更新公司');
 });
 it.each(['fetch','body'] as const)('bounds an uncooperative %s, ignores its late denial, and recovers only after cooldown',async stage=>{
  const pending=deferred<Response>(),body=deferred<unknown>();
  const fetcher=vi.fn<(url:string,init?:RequestInit)=>Promise<Response>>(()=>stage==='fetch'?pending.promise:Promise.resolve({status:200,headers:new Headers(),json:()=>body.promise} as Response));
  vi.stubGlobal('fetch',fetcher);await start();await tick(29_999);
  expect(screen.getByText('连接失败，仅保留仍在展示期限内的已校验报告。')).toBeTruthy();expect(fetcher.mock.calls[0][1]!.signal!.aborted).toBe(true);expect(button()).toHaveProperty('disabled',true);
  const denied={snapshot:null,status:{...reply().status,state:'denied'}};
  await act(async()=>{pending.resolve(Response.json(denied));body.resolve(denied);});
  expect(screen.queryByText('来源访问已停止')).toBeNull();
  fetcher.mockImplementation(async()=>Response.json(reply()));fireEvent.click(button());visibility('hidden');visibility('visible');await tick(59_999);expect(fetcher).toHaveBeenCalledOnce();await tick(1);expect(fetcher).toHaveBeenCalledTimes(2);expect(screen.getByText('已取得可校验报告')).toBeTruthy();
 });
 it.each(['fetch','body'] as const)('aborts %s on unmount and discards a late result across remount',async stage=>{
  const pending=deferred<Response>(),body=deferred<unknown>();
  const fetcher=vi.fn<(url:string,init?:RequestInit)=>Promise<Response>>(()=>stage==='fetch'?pending.promise:Promise.resolve({status:200,headers:new Headers(),json:()=>body.promise} as Response));vi.stubGlobal('fetch',fetcher);
  const view=await start();view.unmount();await tick();expect(fetcher.mock.calls[0][1]!.signal!.aborted).toBe(true);expect(vi.getTimerCount()).toBe(0);
  fetcher.mockImplementation(async()=>Response.json({snapshot:null,status:{...reply().status,state:'unavailable'}},{status:503}));await start();
  await act(async()=>{pending.resolve(Response.json(reply()));body.resolve(reply());});expect(screen.queryByRole('combobox')).toBeNull();expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('preserves validated evidence and its original expiry during a hanging body',async()=>{
  const fetcher=vi.fn(async()=>Response.json(reply()));vi.stubGlobal('fetch',fetcher);await start();
  fetcher.mockImplementation(async()=>({status:200,headers:new Headers(),json:()=>new Promise(()=>{})}) as Response);
  await tick(REFRESH_MS+30_000);expect(screen.getByText('已保留报告 · 请注意陈旧状态')).toBeTruthy();visibility('hidden');await tick(MAX_CACHE_AGE_MS);
  expect(screen.queryByRole('combobox')).toBeNull();expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it.each([407,451])('clears evidence and blocks all subsequent attempts for HTTP %s',async status=>{
  const fetcher=vi.fn(async()=>Response.json(reply()));vi.stubGlobal('fetch',fetcher);await start();fetcher.mockImplementation(async()=>new Response(null,{status}));await tick(REFRESH_MS);
  expect(screen.getByText('展示权限已失效')).toBeTruthy();expect(screen.queryByRole('combobox')).toBeNull();fireEvent.click(button());visibility('hidden');visibility('visible');await tick(REFRESH_MS*2);expect(fetcher).toHaveBeenCalledTimes(2);
 });
});
