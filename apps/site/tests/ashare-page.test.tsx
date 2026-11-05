// @vitest-environment jsdom
import React from 'react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {render,screen,fireEvent,waitFor,cleanup,act} from '@testing-library/react';
import Page from '../app/ashare/page';
const row={f12:'BK0001',f14:'合成行业',f2:1,f3:1,f62:-10,f184:1,f66:1,f69:1,f72:1,f75:1,f78:1,f81:1,f84:1,f87:1};
const root={schema:'ashare-provider-evidence/1',rows:[row],source_total:1,fetched_at:'2024-01-02T08:00:00Z',scope:{kind:'industry_rank',fs:'m:90+s:2+f:!50',classification_level:'eastmoney_level_1'},page_count:1,source_observed_at:null,trade_date:null,metric_kind:'provider_order_flow_proxy',metric_field:'f62',unit:'CNY',field_units:{f62:'CNY',f3:'percent',f2:'index_points'},delay_status:'not_provided',classification_exclusivity:'not_established',notice:'合成订单分类测试，非真实资金',stale:false,has_error:false};
const stock={...root,field_units:{...root.field_units,f2:'CNY'},rows:[{...row,f12:'000001',f14:'合成股票'}],scope:{kind:'industry_stocks',fs:'b:BK0001',classification_level:'unknown_may_mix_levels'}};
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.useRealTimers()});
describe('private A-share page integration',()=>{
 it('shows known source failure while ignoring untrusted error message text',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({error_code:'unsupported_content_encoding',message:'do not display private source text'}),{status:503})));
  render(<Page/>);await screen.findByText('来源返回不支持的内容编码，传输校验未通过。');
  expect(screen.queryByText('do not display private source text')).toBeNull();
 });
 it('uses generic error for unknown source codes',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({error_code:'untrusted',message:'do not display private source text'}),{status:503})));
  render(<Page/>);await screen.findByText('来源连接失败，尚未取得新的完整快照。');
  expect(screen.queryByText('do not display private source text')).toBeNull();
 });
 it('requests industry then selected stock scope and returns to root',async()=>{
  const mock=vi.fn(async(url:string)=>new Response(JSON.stringify(url.includes('BK0001')?stock:root),{status:200,headers:{etag:'test'}}));vi.stubGlobal('fetch',mock);
  render(<Page/>);const tile=await screen.findByRole('button',{name:/合成行业.*BK0001/});fireEvent.click(tile);
  await screen.findByRole('button',{name:/合成股票.*000001/});expect(mock.mock.calls.some(([url])=>url.includes('scope=BK0001'))).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'← 全部一级行业'}));await screen.findByRole('button',{name:/合成行业.*BK0001/});
 });
 it('clears old industry data on denied stock request',async()=>{
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>url.includes('BK0001')?new Response(null,{status:403}):new Response(JSON.stringify(root),{status:200})));
  render(<Page/>);fireEvent.click(await screen.findByRole('button',{name:/合成行业.*BK0001/}));
  await waitFor(()=>expect(screen.getByText('来源展示权限未建立，已清空缓存数据')).toBeTruthy());
  expect(screen.queryByRole('button',{name:/合成行业.*BK0001/})).toBeNull();
 });
});

describe('A-share recovery interactions',()=>{
 async function advance(ms:number){await act(async()=>{await vi.advanceTimersByTimeAsync(ms);});}
 const response=(payload:unknown,status=200,headers:Record<string,string>={})=>new Response(JSON.stringify(payload),{status,headers});
 it('preserves heatmap exploration during 503, waits for cooldown, deduplicates clicks and recovers',async()=>{
  vi.useFakeTimers();let finish!:(response:Response)=>void;
  const mock=vi.fn().mockResolvedValueOnce(response(root,200,{etag:'"good"'})).mockResolvedValueOnce(response({error_code:'upstream_http'},503,{'retry-after':'75','x-ashare-error-code':'upstream_http','x-ashare-recovery':'retry'})).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));vi.stubGlobal('fetch',mock);
  render(<Page/>);await advance(1);
  fireEvent.change(screen.getByLabelText('搜索代码或名称'),{target:{value:'合成'}});fireEvent.change(screen.getByLabelText('正负配色'),{target:{value:'global'}});
  const details=screen.getByLabelText('完整数值明细') as HTMLDetailsElement;details.open=true;
  await advance(60000);expect(screen.getByRole('button',{name:/合成行业.*BK0001/})).toBeTruthy();
  expect(screen.getByText(/本次刷新失败；保留浏览器内/)).toBeTruthy();expect(screen.queryByText(/服务器已标记缓存陈旧/)).toBeNull();
  expect((screen.getByLabelText('搜索代码或名称') as HTMLInputElement).value).toBe('合成');expect(details.open).toBe(true);
  const retry=screen.getByRole('button',{name:'重试当前来源'}) as HTMLButtonElement;expect(retry.disabled).toBe(true);fireEvent.click(retry);expect(mock).toHaveBeenCalledTimes(2);
  await advance(60000);expect(mock).toHaveBeenCalledTimes(2);await advance(15000);expect(retry.disabled).toBe(false);
  fireEvent.click(retry);fireEvent.click(retry);expect(mock).toHaveBeenCalledTimes(3);expect(retry.disabled).toBe(true);
  expect(mock.mock.calls[2][0]).toBe('/api/v1/ashare/snapshot?scope=level1');expect(mock.mock.calls[2][1].headers).toEqual({'If-None-Match':'"good"'});
  await act(async()=>finish(response({...root,rows:[{...row,f62:-20}]},200,{etag:'"new"'})));
  expect(screen.queryByLabelText('来源连接与恢复')).toBeNull();expect(screen.getByRole('button',{name:/合成行业.*-20/})).toBeTruthy();
  expect((screen.getByLabelText('搜索代码或名称') as HTMLInputElement).value).toBe('合成');expect((screen.getByLabelText('正负配色') as unknown as HTMLSelectElement).value).toBe('global');expect(details.open).toBe(true);
 });
 it('keeps selected stock evidence through a temporary browser disconnect and 304 recovery',async()=>{
  vi.useFakeTimers();const mock=vi.fn().mockResolvedValueOnce(response(root)).mockResolvedValueOnce(response(stock,200,{etag:'"stock"'})).mockRejectedValueOnce(new TypeError('private network detail')).mockResolvedValueOnce(new Response(null,{status:304,headers:{etag:'"stock"'}}));vi.stubGlobal('fetch',mock);
  render(<Page/>);await advance(1);fireEvent.click(screen.getByRole('button',{name:/合成行业.*BK0001/}));await advance(1);fireEvent.click(screen.getByRole('button',{name:/合成股票.*000001/}));
  await advance(60000);expect(screen.getByRole('article',{name:'股票原始证据'})).toBeTruthy();expect(screen.getByText(/浏览器到应用/)).toBeTruthy();
  await advance(60000);expect(screen.queryByLabelText('来源连接与恢复')).toBeNull();expect(screen.getByRole('article',{name:'股票原始证据'})).toBeTruthy();
 });
 it.each([403,'source_access_denied'] as const)('clears evidence and provides no retry for %s',reason=>{
  vi.useFakeTimers();
  const failed=reason===403?response({},403):response({...root,stale:true,has_error:true},200,{'x-ashare-error-code':reason,'x-ashare-recovery':'stopped'});
  const mock=vi.fn().mockResolvedValueOnce(response(root)).mockResolvedValue(failed);vi.stubGlobal('fetch',mock);
  return (async()=>{render(<Page/>);await advance(1);await advance(60000);expect(screen.queryByRole('button',{name:/合成行业.*BK0001/})).toBeNull();expect(screen.queryByRole('button',{name:'重试当前来源'})).toBeNull();await advance(180000);expect(mock).toHaveBeenCalledTimes(2);})();
 });
 it('ignores a cancelled old-scope refresh after a new industry opens',async()=>{
  vi.useFakeTimers();let oldFinish!:(response:Response)=>void;
  const mock=vi.fn().mockResolvedValueOnce(response(root)).mockImplementationOnce(()=>new Promise(resolve=>{oldFinish=resolve;})).mockResolvedValueOnce(response(stock));vi.stubGlobal('fetch',mock);
  render(<Page/>);await advance(1);await advance(60000);fireEvent.click(screen.getByRole('button',{name:/合成行业.*BK0001/}));await advance(1);
  expect(mock.mock.calls[1][1].signal.aborted).toBe(true);await act(async()=>oldFinish(response({...root,rows:[{...row,f14:'旧请求不得显示'}]})));
  expect(screen.getByRole('button',{name:/合成股票.*000001/})).toBeTruthy();expect(screen.queryByText('旧请求不得显示')).toBeNull();
 });
});
