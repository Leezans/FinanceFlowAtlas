// @vitest-environment jsdom
import React from 'react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import Page from '../app/ashare/page';
const row={f12:'BK0001',f14:'合成行业',f2:1,f3:1,f62:-10,f184:1,f66:1,f69:1,f72:1,f75:1,f78:1,f81:1,f84:1,f87:1};
const root={schema:'ashare-provider-evidence/1',rows:[row],source_total:1,fetched_at:'2026-11-05T12:00:00Z',scope:{kind:'industry_rank',fs:'m:90+s:2+f:!50',classification_level:'eastmoney_level_1'},page_count:1,source_observed_at:null,trade_date:null,metric_kind:'provider_order_flow_proxy',metric_field:'f62',unit:'CNY',field_units:{f62:'CNY',f3:'percent',f2:'index_points'},delay_status:'not_provided',classification_exclusivity:'not_established',notice:'合成测试，非真实行情',stale:false,has_error:false};
const response=()=>new Response(JSON.stringify(root),{headers:{etag:'"complete"'}});
async function advance(ms:number){await act(async()=>{await vi.advanceTimersByTimeAsync(ms);});}
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.useRealTimers();});
describe('bounded A-share browser requests',()=>{
 it('keeps 429 retry disabled and blocks timer/focus checks for its full wait',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date(root.fetched_at));
  const fetcher=vi.fn().mockResolvedValueOnce(new Response('not JSON',{status:429,headers:{'retry-after':'900'}})).mockResolvedValue(response());vi.stubGlobal('fetch',fetcher);
  const view=render(<Page/>);await advance(1);
  expect(screen.getByText(/应用请求限速，请等待后再检查。/)).toBeTruthy();
  const retry=screen.getByRole('button',{name:'重试当前来源'}) as HTMLButtonElement;
  expect(retry.disabled).toBe(true);fireEvent.click(retry);
  await advance(899998);fireEvent.focus(window);fireEvent(window,new Event('pageshow'));await advance(0);
  expect(fetcher).toHaveBeenCalledOnce();expect(retry.disabled).toBe(true);
  await advance(2);expect(fetcher).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('button',{name:/合成行业.*BK0001/})).toBeTruthy();
  view.unmount();await advance(120000);expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('stops when a retryable header conflicts with a stopped body',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date(root.fetched_at));const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({error_code:'source_outcome_unconfirmed'}),{status:503,headers:{'x-ashare-error-code':'source_cooldown','retry-after':'1'}}));vi.stubGlobal('fetch',fetcher);
  render(<Page/>);await advance(1);expect(screen.getByText('上次采集未能确认结果，已停止自动重试。')).toBeTruthy();
  expect(screen.queryByRole('button',{name:'重试当前来源'})).toBeNull();
  await advance(180000);fireEvent.focus(window);await advance(1);expect(fetcher).toHaveBeenCalledOnce();
 });

 it('ends a hung initial connection and uses ordinary cooldown before trying the application again',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date(root.fetched_at));const fetcher=vi.fn().mockImplementationOnce(()=>new Promise(()=>{})).mockResolvedValue(response());vi.stubGlobal('fetch',fetcher);
  render(<Page/>);await advance(1);await advance(34998);expect(screen.queryByLabelText('来源连接与恢复')).toBeNull();
  await advance(2);expect(fetcher.mock.calls[0][1].signal!.aborted).toBe(true);
  expect(screen.getByText('浏览器等待应用响应超时，尚未确认来源状态。')).toBeTruthy();
  const retry=screen.getByRole('button',{name:'重试当前来源'}) as HTMLButtonElement;
  expect(retry.disabled).toBe(true);fireEvent.click(retry);await advance(59998);expect(fetcher).toHaveBeenCalledOnce();
  await advance(2);expect(fetcher).toHaveBeenCalledTimes(2);expect(screen.getByRole('button',{name:/合成行业.*BK0001/})).toBeTruthy();
  expect(screen.queryByLabelText('来源连接与恢复')).toBeNull();
 });
 it('bounds a stalled response body, retains same-scope evidence and ignores its late bytes',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date(root.fetched_at));let finish!:(value:unknown)=>void;
  const hung={status:200,headers:new Headers({etag:'"late"'}),json:vi.fn(()=>new Promise(resolve=>{finish=resolve;}))};
  const fetcher=vi.fn().mockResolvedValueOnce(response()).mockResolvedValueOnce(hung).mockResolvedValueOnce(new Response(null,{status:304,headers:{etag:'"complete"'}}));vi.stubGlobal('fetch',fetcher);
  render(<Page/>);await advance(1);fireEvent.change(screen.getByLabelText('搜索代码或名称'),{target:{value:'合成'}});
  await advance(60000);await advance(35000);
  expect(fetcher.mock.calls[1][1].signal.aborted).toBe(true);expect(screen.getByText(/本次刷新失败；保留浏览器内/)).toBeTruthy();
  expect(screen.getByRole('button',{name:/合成行业.*BK0001/})).toBeTruthy();expect((screen.getByLabelText('搜索代码或名称') as HTMLInputElement).value).toBe('合成');
  await advance(60000);expect(fetcher).toHaveBeenCalledTimes(3);expect(fetcher.mock.calls[2][1].headers).toEqual({'If-None-Match':'"complete"'});
  await act(async()=>finish({...root,rows:[{...row,f14:'迟到的旧响应'}]}));
  expect(screen.queryByText(/迟到的旧响应/)).toBeNull();expect(screen.queryByLabelText('来源连接与恢复')).toBeNull();
 });
 it('does not shorten a long Retry-After received before a body stalls',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date(root.fetched_at));const failed={status:503,headers:new Headers({'retry-after':'900','x-ashare-error-code':'upstream_http'}),json:vi.fn(()=>new Promise(()=>{}))};
  const fetcher=vi.fn().mockResolvedValueOnce(failed).mockResolvedValue(response());vi.stubGlobal('fetch',fetcher);
  render(<Page/>);await advance(35001);expect(screen.getByText('浏览器等待应用响应超时，尚未确认来源状态。')).toBeTruthy();
  await advance(60_000);expect(fetcher).toHaveBeenCalledOnce();expect((screen.getByRole('button',{name:'重试当前来源'}) as HTMLButtonElement).disabled).toBe(true);
  await advance(804_998);expect(fetcher).toHaveBeenCalledOnce();await advance(2);
  fireEvent.click(screen.getByRole('button',{name:'重试当前来源'}));await advance(1);expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it.each([401,403,'stopped','source_outcome_unconfirmed'] as const)('does not wait for a body after known access stop %s',async stop=>{
  vi.useFakeTimers();vi.setSystemTime(new Date(root.fetched_at));const json=vi.fn(()=>new Promise(()=>{}));
  const failed={status:typeof stop==='number'?stop:503,headers:new Headers(typeof stop==='number'?{}:stop==='stopped'?{'x-ashare-recovery':'stopped'}:{'x-ashare-error-code':stop}),json};
  const fetcher=vi.fn().mockResolvedValueOnce(response()).mockResolvedValueOnce(failed);vi.stubGlobal('fetch',fetcher);
  render(<Page/>);await advance(1);await advance(60000);
  expect(json).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:/合成行业.*BK0001/})).toBeNull();
  expect(screen.queryByRole('button',{name:'重试当前来源'})).toBeNull();await advance(180000);expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('ignores headers arriving after timeout without consuming the old response body',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date(root.fetched_at));let finish!:(response:unknown)=>void;const json=vi.fn(async()=>root);
  const fetcher=vi.fn().mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValue(response());vi.stubGlobal('fetch',fetcher);
  render(<Page/>);await advance(95001);expect(fetcher).toHaveBeenCalledTimes(2);
  await act(async()=>finish({status:200,headers:new Headers(),json}));
  expect(json).not.toHaveBeenCalled();expect(screen.queryByLabelText('来源连接与恢复')).toBeNull();expect(screen.getByRole('button',{name:/合成行业.*BK0001/})).toBeTruthy();
 });
 it.each(['fetch','body'] as const)('aborts a pending %s on unmount and never schedules a replacement',async phase=>{
  vi.useFakeTimers();vi.setSystemTime(new Date(root.fetched_at));let finish!:(value:unknown)=>void;
  const pending=new Promise(resolve=>{finish=resolve;});const json=vi.fn(()=>pending);
  const fetcher=vi.fn<(url:string,init:RequestInit)=>Promise<unknown>>().mockImplementation(()=>phase==='fetch'?pending:Promise.resolve({status:200,headers:new Headers(),json}));vi.stubGlobal('fetch',fetcher);
  const view=render(<Page/>);await advance(1);view.unmount();expect(fetcher.mock.calls[0][1].signal!.aborted).toBe(true);
  await advance(120000);await act(async()=>finish(phase==='fetch'?{status:200,headers:new Headers(),json}:root));
  expect(fetcher).toHaveBeenCalledOnce();if(phase==='fetch')expect(json).not.toHaveBeenCalled();expect(screen.queryByLabelText('来源连接与恢复')).toBeNull();
 });
 it('cancels the timeout on scope change and unmount without interrupting the next scope',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date(root.fetched_at));const stock={...root,field_units:{...root.field_units,f2:'CNY'},rows:[{...row,f12:'000001',f14:'合成股票'}],scope:{kind:'industry_stocks',fs:'b:BK0001',classification_level:'unknown_may_mix_levels'}};
  const fetcher=vi.fn().mockResolvedValueOnce(response()).mockImplementationOnce(()=>new Promise(()=>{})).mockResolvedValueOnce(new Response(JSON.stringify(stock)));vi.stubGlobal('fetch',fetcher);
  const view=render(<Page/>);await advance(1);await advance(60000);fireEvent.click(screen.getByRole('button',{name:/合成行业.*BK0001/}));await advance(1);
  expect(fetcher.mock.calls[1][1].signal.aborted).toBe(true);await advance(35000);
  expect(fetcher.mock.calls[2][1].signal.aborted).toBe(false);expect(screen.getByRole('button',{name:/合成股票.*000001/})).toBeTruthy();
  expect(screen.queryByLabelText('来源连接与恢复')).toBeNull();view.unmount();await advance(120000);expect(fetcher).toHaveBeenCalledTimes(3);
 });
});
