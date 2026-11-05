// @vitest-environment jsdom
import React from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import Markets from '../components/markets/Markets';
import {ticFixture} from './ticTestFixture';
vi.mock('../components/ashare/AshareWorkspace',()=>({default:()=> <section aria-label="中国行业测试工作区">中国自身 CNY 估算</section>}));
vi.mock('../components/cvm/CvmFunds',()=>({default:()=> <section aria-label="巴西行业测试工作区">巴西公开基金 BRL 月报</section>}));
vi.mock('../components/markets/TaiwanMoney',()=>({default:()=> <section aria-label="台湾金额测试工作区">台湾自身 TWD 日报</section>}));
beforeEach(()=>{window.history.replaceState({},'','/markets');vi.stubGlobal('fetch',vi.fn(async(url:string)=>({ok:true,status:200,headers:new Headers(),json:async()=>url.endsWith('/status')?{state:'available'}:ticFixture})));});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe('country-owned global matrix',()=>{
 it('defaults to local industry evidence, never foreign TIC residence',async()=>{
  render(<Markets/>);
  expect(await screen.findByRole('region',{name:'中国行业测试工作区'})).toBeTruthy();
  expect(screen.getByRole('region',{name:'矩阵来源与口径边界'}).textContent).toContain('本地市场口径，不以美国为基准');
  expect(screen.queryByRole('region',{name:'美国股权跨境净交易矩阵'})).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
  expect(screen.queryByRole('group',{name:'选择国家或地区；小型地区也可通过搜索选择'})).toBeNull();
 });
 it('switches own countries without retained prior evidence or automatic supplementary fetches',async()=>{
  render(<Markets/>);await screen.findByRole('region',{name:'中国行业测试工作区'});
  fireEvent.change(screen.getByLabelText('国家 / 地区'),{target:{value:'TWN'}});
  expect(await screen.findByRole('region',{name:'台湾金额测试工作区'})).toBeTruthy();
  expect(screen.queryByRole('region',{name:'中国行业测试工作区'})).toBeNull();expect(window.location.search).toBe('?country=TWN');
  fireEvent.change(screen.getByLabelText('国家 / 地区'),{target:{value:'BRA'}});
  expect(await screen.findByRole('region',{name:'巴西行业测试工作区'})).toBeTruthy();
  expect(screen.queryByRole('region',{name:'台湾金额测试工作区'})).toBeNull();
  expect(screen.getByText('月度披露，每日检查；非实时',{selector:'dd'})).toBeTruthy();expect(fetch).not.toHaveBeenCalled();
 });
 it.each(['FRA','USA','JPN'])('keeps %s unknown, with no TIC fallback or fake country blocks',async iso=>{
  window.history.replaceState({},'',`/markets?country=${iso}`);const {container}=render(<Markets/>);
  expect(await screen.findByText('该市场资金流尚未接入')).toBeTruthy();
  expect(container.querySelector('[data-matrix-empty=true]')).toBeTruthy();expect(container.querySelector('[data-id]')).toBeNull();
  expect(screen.queryByRole('region',{name:'中国行业测试工作区'})).toBeNull();expect(fetch).not.toHaveBeenCalled();
 });
 it('restores exact country deep links and Back/Forward selection',async()=>{
  window.history.replaceState({},'','/markets?country=BRA');render(<Markets/>);
  expect(await screen.findByRole('region',{name:'巴西行业测试工作区'})).toBeTruthy();
  window.history.replaceState({},'','/markets?country=FRA');fireEvent(window,new PopStateEvent('popstate'));
  expect(await screen.findByText('该市场资金流尚未接入')).toBeTruthy();expect(screen.queryByRole('region',{name:'巴西行业测试工作区'})).toBeNull();
  window.history.replaceState({},'','/markets?country=TWN');fireEvent(window,new PopStateEvent('popstate'));
  expect(await screen.findByRole('region',{name:'台湾金额测试工作区'})).toBeTruthy();
 });
 it('loads TIC only after explicit independent supplement selection',async()=>{
  render(<Markets/>);await screen.findByRole('region',{name:'中国行业测试工作区'});
  fireEvent.click(screen.getByText('美国 TIC · 独立跨境补充资料'));
  expect(await screen.findByRole('region',{name:'美国股权跨境净交易矩阵'})).toBeTruthy();
  await waitFor(()=>expect(fetch).toHaveBeenCalledTimes(2));
  expect((fetch as ReturnType<typeof vi.fn>).mock.calls.map(([url])=>url)).toEqual(['/api/v1/flows/tic/status','/api/v1/flows/tic']);
  expect(screen.getByRole('region',{name:'中国行业测试工作区'})).toBeTruthy();
 });
 it('keeps country search/navigation distinct from observations',async()=>{
  render(<Markets/>);await screen.findByRole('region',{name:'中国行业测试工作区'});
  fireEvent.change(screen.getByLabelText('搜索国家'),{target:{value:'France'}});
  expect(within(screen.getByLabelText('国家 / 地区')).getByRole('option',{name:'法国 · FRA · 未接入'})).toBeTruthy();
  fireEvent.change(screen.getByLabelText('国家 / 地区'),{target:{value:'FRA'}});
  await screen.findByText('该市场资金流尚未接入');
  fireEvent.click(screen.getByText('地理导航与市场入口'));
  expect(await screen.findByRole('group',{name:'选择国家或地区；小型地区也可通过搜索选择'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'选择 中国 (CHN)'}));
  expect(await screen.findByRole('region',{name:'中国行业测试工作区'})).toBeTruthy();expect((screen.getByLabelText('国家 / 地区') as unknown as {value:string}).value).toBe('CHN');
 });
});
