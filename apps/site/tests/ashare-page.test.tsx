// @vitest-environment jsdom
import React from 'react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import Page from '../app/ashare/page';
const row={f12:'BK0001',f14:'合成行业',f2:1,f3:1,f62:-10,f184:1,f66:1,f69:1,f72:1,f75:1,f78:1,f81:1,f84:1,f87:1};
const root={schema:'ashare-provider-evidence/1',rows:[row],source_total:1,fetched_at:'2024-01-02T08:00:00Z',scope:{kind:'industry_rank',fs:'m:90+s:2+f:!50',classification_level:'eastmoney_level_1'},page_count:1,source_observed_at:null,trade_date:null,metric_kind:'provider_order_flow_proxy',metric_field:'f62',unit:'CNY',field_units:{f62:'CNY',f3:'percent',f2:'CNY'},delay_status:'not_provided',classification_exclusivity:'not_established',notice:'合成订单分类测试，非真实资金',stale:false,has_error:false};
const stock={...root,rows:[{...row,f12:'000001',f14:'合成股票'}],scope:{kind:'industry_stocks',fs:'b:BK0001',classification_level:'unknown_may_mix_levels'}};
afterEach(()=>{cleanup();vi.unstubAllGlobals()});
describe('private A-share page integration',()=>{
 it('shows known source failure while ignoring untrusted error message text',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({error_code:'unsupported_content_encoding',message:'do not display private source text'}),{status:503})));
  render(<Page/>);await screen.findByText('来源返回不支持的内容编码，传输校验未通过。');
  expect(screen.queryByText('do not display private source text')).toBeNull();
 });
 it('uses generic error for unknown source codes',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({error_code:'untrusted',message:'do not display private source text'}),{status:503})));
  render(<Page/>);await screen.findByText('来源响应失败（HTTP 503），不沿用旧数据');
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
