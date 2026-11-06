// @vitest-environment jsdom
import React from 'react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import Page from '../app/ashare/page';
const row={f12:'BK0001',f14:'合成行业',f2:1,f3:1,f62:-10,f184:1,f66:1,f69:1,f72:1,f75:1,f78:1,f81:1,f84:1,f87:1};
const evidence={schema:'ashare-provider-evidence/1',rows:[row],source_total:1,fetched_at:'2026-11-05T12:00:00Z',scope:{kind:'industry_rank',fs:'m:90+s:2+f:!50',classification_level:'eastmoney_level_1'},page_count:1,source_observed_at:null,trade_date:null,metric_kind:'provider_order_flow_proxy',metric_field:'f62',unit:'CNY',field_units:{f62:'CNY',f3:'percent',f2:'index_points'},delay_status:'not_provided',classification_exclusivity:'not_established',notice:'合成测试，非真实数据',stale:false,has_error:false};
const start=Date.parse('2026-11-05T12:00:00Z');
const fresh=()=>new Response(JSON.stringify(evidence),{headers:{etag:'"verified"','x-ashare-refresh-after':'60'}});
async function advance(ms:number){await act(async()=>{await vi.advanceTimersByTimeAsync(ms);});}
function freezePast(ms:number){vi.setSystemTime(start+ms);}
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});
describe('honest access-driven A-share refresh',()=>{
 it('states that closing the page does not leave a background collector running',async()=>{
  vi.useFakeTimers();vi.stubGlobal('fetch',vi.fn().mockResolvedValue(fresh()));render(<Page/>);await advance(1);
  expect(screen.getByLabelText('采集触发方式').textContent).toContain('关闭后不会继续后台更新');
  expect(screen.getByText('页面打开时约每分钟检查；不代表行情更新')).toBeTruthy();
 });
 it.each(['focus','pageshow','visibilitychange'] as const)('checks overdue evidence once after %s without waiting for a suspended timer',async event=>{
  vi.useFakeTimers();vi.setSystemTime(start);vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');
  let finish!:(response:Response)=>void;const fetcher=vi.fn().mockResolvedValueOnce(fresh()).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));vi.stubGlobal('fetch',fetcher);
  const view=render(<Page/>);await advance(1);freezePast(180000);
  const target=event==='visibilitychange'?document:window;fireEvent(target,new Event(event));fireEvent(target,new Event(event));
  expect(fetcher).toHaveBeenCalledTimes(2);expect(fetcher.mock.calls[1][1].headers).toEqual({'If-None-Match':'"verified"'});
  await act(async()=>finish(fresh()));await advance(59000);expect(fetcher).toHaveBeenCalledTimes(2);
  view.unmount();freezePast(600000);fireEvent.focus(window);fireEvent(document,new Event('visibilitychange'));expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('does not turn early focus or a hidden visibility change into a new request',async()=>{
  vi.useFakeTimers();vi.setSystemTime(start);let visibility:DocumentVisibilityState='visible';vi.spyOn(document,'visibilityState','get').mockImplementation(()=>visibility);
  const fetcher=vi.fn().mockImplementation(async()=>fresh());vi.stubGlobal('fetch',fetcher);render(<Page/>);await advance(1);
  freezePast(30000);fireEvent.focus(window);expect(fetcher).toHaveBeenCalledOnce();visibility='hidden';freezePast(180000);fireEvent(document,new Event('visibilitychange'));fireEvent.focus(window);expect(fetcher).toHaveBeenCalledOnce();
  visibility='visible';fireEvent(document,new Event('visibilitychange'));expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it.each(['focus','pageshow','visibilitychange'] as const)('preserves short 200/304 hint deadlines across %s',async event=>{
  vi.useFakeTimers();vi.setSystemTime(start);vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');
  const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(evidence),{headers:{etag:'\"short\"','x-ashare-refresh-after':'1'}})).mockResolvedValueOnce(new Response(null,{status:304,headers:{'x-ashare-refresh-after':'2'}})).mockImplementationOnce(()=>new Promise(()=>{}));vi.stubGlobal('fetch',fetcher);
  render(<Page/>);await advance(1);const target=event==='visibilitychange'?document:window;
  freezePast(1099);fireEvent(target,new Event(event));expect(fetcher).toHaveBeenCalledOnce();freezePast(1100);await act(async()=>{fireEvent(target,new Event(event));});expect(fetcher).toHaveBeenCalledTimes(2);expect(fetcher.mock.calls[1][1].headers).toEqual({'If-None-Match':'\"short\"'});
  freezePast(3199);fireEvent(target,new Event(event));expect(fetcher).toHaveBeenCalledTimes(2);freezePast(3200);fireEvent(target,new Event(event));expect(fetcher).toHaveBeenCalledTimes(3);
 });
 it.each(['focus','pageshow','visibilitychange'] as const)('does not shorten staged Retry-After on %s',async event=>{
  vi.useFakeTimers();vi.setSystemTime(start);vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');
  const fetcher=vi.fn().mockResolvedValueOnce(new Response('{}',{status:503,headers:{'x-ashare-error-code':'collection_in_progress','retry-after':'3'}})).mockResolvedValue(fresh());vi.stubGlobal('fetch',fetcher);
  render(<Page/>);await advance(1);const target=event==='visibilitychange'?document:window;
  freezePast(3099);fireEvent(target,new Event(event));expect(fetcher).toHaveBeenCalledOnce();freezePast(3100);fireEvent(target,new Event(event));expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('deduplicates mixed wake events and aborts a pending resumed request on unmount',async()=>{
  vi.useFakeTimers();vi.setSystemTime(start);vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');let finish!:(response:Response)=>void;
  const fetcher=vi.fn().mockResolvedValueOnce(fresh()).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));vi.stubGlobal('fetch',fetcher);
  const view=render(<Page/>);await advance(1);freezePast(180000);fireEvent.focus(window);fireEvent(window,new Event('pageshow'));fireEvent(document,new Event('visibilitychange'));expect(fetcher).toHaveBeenCalledTimes(2);
  await advance(10000);expect(fetcher).toHaveBeenCalledTimes(2);view.unmount();expect(fetcher.mock.calls[1][1].signal.aborted).toBe(true);
  await act(async()=>finish(fresh()));freezePast(600000);fireEvent.focus(window);fireEvent(window,new Event('pageshow'));fireEvent(document,new Event('visibilitychange'));await advance(120000);expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('clears the replaced timer rather than allowing an extra check before the new deadline',async()=>{
  vi.useFakeTimers();vi.setSystemTime(start);vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');
  const fetcher=vi.fn().mockImplementation(async()=>fresh());vi.stubGlobal('fetch',fetcher);render(<Page/>);await advance(30001);
  freezePast(180000);await act(async()=>{fireEvent.focus(window);});expect(fetcher).toHaveBeenCalledTimes(2);
  // The original timer had about 30s left. A replacement has over 60s left.
  await advance(31000);expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('uses only the selected scope after navigation, with its own refresh deadline',async()=>{
  vi.useFakeTimers();vi.setSystemTime(start);vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');
  const stock={...evidence,scope:{kind:'industry_stocks',fs:'b:BK0001',classification_level:'unknown_may_mix_levels'},rows:[{...row,f12:'000001',f14:'合成股票'}],field_units:{...evidence.field_units,f2:'CNY'}};
  const fetcher=vi.fn<(url:string,init:RequestInit)=>Promise<Response>>().mockResolvedValueOnce(new Response(JSON.stringify(evidence),{headers:{'x-ashare-refresh-after':'1'}})).mockImplementation(async()=>new Response(JSON.stringify(stock),{headers:{'x-ashare-refresh-after':'60'}}));vi.stubGlobal('fetch',fetcher);
  render(<Page/>);await advance(1);fireEvent.click(screen.getByRole('button',{name:/合成行业.*BK0001/}));await advance(1);expect(fetcher).toHaveBeenCalledTimes(2);
  freezePast(2000);fireEvent.focus(window);fireEvent(window,new Event('pageshow'));fireEvent(document,new Event('visibilitychange'));expect(fetcher).toHaveBeenCalledTimes(2);
  freezePast(61000);fireEvent.focus(window);expect(fetcher).toHaveBeenCalledTimes(3);expect(fetcher.mock.calls[2][0]).toBe('/api/v1/ashare/snapshot?scope=BK0001');
 });
 it('preserves a full source cooldown across page resume',async()=>{
  vi.useFakeTimers();vi.setSystemTime(start);vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');
  const fetcher=vi.fn().mockResolvedValueOnce(new Response('{}',{status:503,headers:{'x-ashare-error-code':'upstream_http','retry-after':'900'}})).mockResolvedValue(fresh());vi.stubGlobal('fetch',fetcher);
  render(<Page/>);await advance(1);freezePast(899999);fireEvent.focus(window);expect(fetcher).toHaveBeenCalledOnce();
  freezePast(900100);fireEvent.focus(window);expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it.each(['source_denied','source_outcome_unconfirmed'])('does not resume stopped %s even after a long absence',async code=>{
  vi.useFakeTimers();vi.setSystemTime(start);vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');
  const fetcher=vi.fn().mockResolvedValue(new Response('{}',{status:503,headers:{'x-ashare-error-code':code,'x-ashare-recovery':'stopped'}}));vi.stubGlobal('fetch',fetcher);
  render(<Page/>);await advance(1);freezePast(86400000);fireEvent.focus(window);fireEvent(window,new Event('pageshow'));fireEvent(document,new Event('visibilitychange'));expect(fetcher).toHaveBeenCalledOnce();
 });
});
