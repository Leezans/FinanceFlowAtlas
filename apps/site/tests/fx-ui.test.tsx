// @vitest-environment jsdom
import React from 'react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import Forex from '../components/forex/Forex';
import {fxPayload} from './fx-fixture';
const ready=()=>({...fxPayload(),next_check_at:'2000-01-01T00:00:00.000Z'});
const reply=(payload=ready(),status=200)=>new Response(JSON.stringify(payload),{status});
afterEach(()=>{cleanup();vi.unstubAllGlobals()});
describe('daily FX reference UI',()=>{
 it('shows dated actual coverage, not flow/live claims, and supports conversion/search/swap',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>reply()));render(<Forex/>);
  await screen.findByText('3 种报价币');expect(screen.getByText('不是资金流、实时行情或可成交报价。')).toBeTruthy();
  expect(screen.getByText('5 CNY')).toBeTruthy();fireEvent.change(screen.getByLabelText('换算数量'),{target:{value:'10'}});expect(screen.getByText('50 CNY')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'交换换算货币'}));expect(screen.getByText('2 USD')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('筛选货币'),{target:{value:'JPY'}});expect(screen.getByRole('rowheader',{name:'JPY'})).toBeTruthy();expect(screen.queryByRole('rowheader',{name:'USD'})).toBeNull();
  fireEvent.change(screen.getByLabelText('筛选货币'),{target:{value:'not-present'}});expect(screen.getByText('没有匹配的已覆盖货币；缺失不表示零。')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('换算数量'),{target:{value:'-1'}});expect(screen.getByText('请输入 0 至 1 万亿的有效数量')).toBeTruthy();
  expect(screen.getByRole('link',{name:'全球市场'}).getAttribute('href')).toBe('/markets');expect(screen.getByRole('link',{name:'使用条件与免责声明 ↗'})).toBeTruthy();
 });
 it('keeps old reference data and search after connection failure and recovers',async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(reply()).mockRejectedValueOnce(new Error('secret detail')).mockResolvedValueOnce(reply());vi.stubGlobal('fetch',fetcher);render(<Forex/>);
  await screen.findByText('3 种报价币');fireEvent.change(screen.getByLabelText('筛选货币'),{target:{value:'CNY'}});
  fireEvent.click(screen.getByRole('button',{name:'检查 ECB 来源'}));await screen.findByText(/页面连接暂时失败/);expect(screen.getByRole('rowheader',{name:'CNY'})).toBeTruthy();expect(screen.queryByText('secret detail')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'检查 ECB 来源'}));await waitFor(()=>expect(screen.queryByText(/页面连接暂时失败/)).toBeNull());expect((screen.getByLabelText('筛选货币') as HTMLInputElement).value).toBe('CNY');
 });
 it('clears displayed values on access failure and prevents repeated requests',async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(reply()).mockResolvedValueOnce(new Response(null,{status:403}));vi.stubGlobal('fetch',fetcher);render(<Forex/>);await screen.findByText('3 种报价币');
  fireEvent.click(screen.getByRole('button',{name:'检查 ECB 来源'}));await screen.findByText('展示权限不可用，已清空数据并停止检查。');expect(screen.queryByRole('table')).toBeNull();
  const button=screen.getByRole('button',{name:'来源检查已停止'});expect((button as HTMLButtonElement).disabled).toBe(true);fireEvent.click(button);expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('clears invalid successful data rather than presenting unchecked quotes',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(reply()).mockResolvedValueOnce(new Response('{"snapshot":{"rates":[]}}')));render(<Forex/>);await screen.findByText('3 种报价币');
  fireEvent.click(screen.getByRole('button',{name:'检查 ECB 来源'}));await screen.findByText('响应校验失败，已清空数据。');expect(screen.queryByRole('table')).toBeNull();
 });
 it('uses safe allowlisted errors and no fabricated snapshot on initial failure',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>reply({...ready(),snapshot:null,source_state:'unavailable',error_code:'network_error'},503)));render(<Forex/>);
  await screen.findByText(/来源连接失败/);expect(screen.queryByRole('table')).toBeNull();expect(screen.getByText(/不使用样例填补/)).toBeTruthy();
 });
 it('disables repeat clicks while in flight and aborts on navigation/unmount',async()=>{
  let resolve:(response:Response)=>void=()=>{};let signal:AbortSignal|undefined;
  const fetcher=vi.fn((_url:string,options:RequestInit)=>{signal=options.signal as AbortSignal;return new Promise<Response>(r=>{resolve=r})});vi.stubGlobal('fetch',fetcher);
  const {unmount}=render(<Forex/>);await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(1));const button=screen.getByRole('button',{name:'检查中…'});fireEvent.click(button);fireEvent.click(button);expect(fetcher).toHaveBeenCalledTimes(1);
  unmount();expect(signal?.aborted).toBe(true);resolve(reply());
 });
 it('does not let manual refresh bypass server cooldown',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>reply({...ready(),next_check_at:'2099-01-01T00:00:00.000Z'})));render(<Forex/>);await screen.findByText('3 种报价币');expect((screen.getByRole('button',{name:'等待下次检查'}) as HTMLButtonElement).disabled).toBe(true);
 });
});
