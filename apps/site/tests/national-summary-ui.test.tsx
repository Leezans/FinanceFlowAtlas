// @vitest-environment jsdom
import React from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import TaiwanMoney from '../components/markets/TaiwanMoney';
import {summaryFixture,SUMMARY_TEST_NOW} from './national-summary-fixture';
vi.mock('../components/tpex/TpexInstitutional',()=>({default:()=> <section aria-label="独立行业股数测试">share-count only</section>}));
const response=(body:unknown,status=200)=>Response.json(body,{status});
// Respect the fixture's source cooldown before exercising its next response.
const nextCheck=()=>{vi.mocked(Date.now).mockReturnValue(SUMMARY_TEST_NOW+3600000+1);fireEvent(document,new Event('visibilitychange'));};
beforeEach(()=>{vi.spyOn(Date,'now').mockReturnValue(SUMMARY_TEST_NOW);Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('Taiwan owns its monetary evidence',()=>{
 it('renders actual date/TWD and proportional participants without fake industry amount allocation',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>response(summaryFixture())));const {container}=render(<TaiwanMoney/>);
  await screen.findByText('已取得每日法人交易报告');
  expect(container.querySelectorAll('svg g[data-id]')).toHaveLength(2);
  expect(screen.getByText('+100 TWD',{selector:'strong'})).toBeTruthy();expect(screen.getByText(/来源没有行业金额/)).toBeTruthy();
  expect(screen.queryByRole('region',{name:'独立行业股数测试'})).toBeNull();
  expect(fetch).toHaveBeenCalledWith('/api/v1/taiwan/tpex/summary/snapshot',expect.objectContaining({redirect:'manual'}));
  fireEvent.click(screen.getAllByRole('button',{name:/台湾上柜市场.*外资及陆资/})[0]);
  expect(screen.getByRole('region',{name:'所选法人金额证据'}).textContent).toContain('+200 TWD');
  fireEvent.click(screen.getByText('行业 → 公司矩阵 · 独立股数指标，不是上述金额的下钻'));
  expect(await screen.findByRole('region',{name:'独立行业股数测试'})).toBeTruthy();
 });
 it('leaves denied source empty and disables retries',async()=>{
  const fixture=summaryFixture();vi.stubGlobal('fetch',vi.fn(async()=>response({snapshot:null,status:{...fixture.status,state:'denied',error_code:'source_denied',fetched_at:null,cache_age_ms:null,report_age_days:null,next_retry_at:null}},503)));
  const {container}=render(<TaiwanMoney/>);await screen.findByText('来源访问已停止，金额保持空白');
  expect(container.querySelector('[data-matrix-empty=true]')).toBeTruthy();expect(container.querySelector('[data-id]')).toBeNull();expect((screen.getByRole('button',{name:'检查报告'}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent(document,new Event('visibilitychange'));expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('clears earlier money on permission denial',async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(response(summaryFixture())).mockResolvedValueOnce(response({},403));vi.stubGlobal('fetch',fetcher);
  const {container}=render(<TaiwanMoney/>);await screen.findByText('已取得每日法人交易报告');
  nextCheck();await screen.findByText('来源访问已停止，金额保持空白');
  expect(container.querySelector('[data-id]')).toBeNull();expect(screen.queryByText('+100 TWD',{selector:'strong'})).toBeNull();
 });
 it('retains a still-valid report on network failure but leaves original timestamp and marks stale',async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(response(summaryFixture())).mockRejectedValueOnce(new Error('offline'));vi.stubGlobal('fetch',fetcher);
  render(<TaiwanMoney/>);await screen.findByText('已取得每日法人交易报告');nextCheck();
  await screen.findByText('保留最近已核验报告 · 注意时效');expect(screen.getByText('+100 TWD',{selector:'strong'})).toBeTruthy();expect(screen.getAllByText('2026-11-05 10:00:00.000 UTC').length).toBeGreaterThan(0);
 });
 it('clears money on a malformed successful response instead of retaining it as stale',async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(response(summaryFixture())).mockResolvedValueOnce(response({snapshot:{unit:'shares'}}));vi.stubGlobal('fetch',fetcher);
  const {container}=render(<TaiwanMoney/>);await screen.findByText('已取得每日法人交易报告');nextCheck();
  await screen.findByText('响应未通过校验，已清空金额。');expect(container.querySelector('[data-id]')).toBeNull();expect(screen.queryByText('+100 TWD',{selector:'strong'})).toBeNull();
 });
 it('keeps selection across a revised report and never duplicates in-flight refresh clicks',async()=>{
  let finish:(value:unknown)=>void=()=>{};const updated=summaryFixture();updated.snapshot!.participants[0]={id:'foreign',buy:400,sell:100,net:300};updated.snapshot!.participants[3]={id:'total',buy:550,sell:350,net:200};
  const fetcher=vi.fn().mockResolvedValueOnce(response(summaryFixture())).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));vi.stubGlobal('fetch',fetcher);
  render(<TaiwanMoney/>);await screen.findByText('已取得每日法人交易报告');fireEvent.click(screen.getAllByRole('button',{name:/台湾上柜市场.*外资及陆资/})[0]);
  nextCheck();fireEvent(document,new Event('visibilitychange'));expect(fetcher).toHaveBeenCalledTimes(2);
  finish(response(updated));await waitFor(()=>expect(screen.getByRole('region',{name:'所选法人金额证据'}).textContent).toContain('+300 TWD'));
 });
 it('does not paint expired daily reports as current money',async()=>{
  const old=summaryFixture();old.snapshot!.report_date='2026-10-01';vi.stubGlobal('fetch',vi.fn(async()=>response(old)));const {container}=render(<TaiwanMoney/>);
  await waitFor(()=>expect(fetch).toHaveBeenCalledOnce());expect(container.querySelector('[data-id]')).toBeNull();expect(screen.queryByText('+100 TWD',{selector:'strong'})).toBeNull();
 });
 it('ignores late responses after leaving the market and aborts the browser request',async()=>{
  let finish:(value:unknown)=>void=()=>{};const fetcher=vi.fn((_url:string,_options:RequestInit)=>new Promise(resolve=>{void _url;void _options;finish=resolve;}));vi.stubGlobal('fetch',fetcher);
  const {unmount}=render(<TaiwanMoney/>);await waitFor(()=>expect(fetcher).toHaveBeenCalledOnce());const options=fetcher.mock.calls[0][1] as unknown as RequestInit;
  unmount();expect(options.signal?.aborted).toBe(true);finish(response(summaryFixture()));expect(screen.queryByText('+100 TWD',{selector:'strong'})).toBeNull();
 });
});
