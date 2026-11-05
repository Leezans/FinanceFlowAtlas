// @vitest-environment jsdom
import React from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import JapanMoney from '../components/markets/JapanMoney';
import {japanFixture,JAPAN_TEST_NOW} from './japan-mof-ui-fixture';
const response=(body:unknown,status=200)=>({status,redirected:false,type:'basic',json:async()=>body});
beforeEach(()=>{vi.spyOn(Date,'now').mockReturnValue(JAPAN_TEST_NOW);});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('Japan own-issuer weekly cross-border evidence',()=>{
  it('shows period, update and acquisition separately, preserves sample scope and scales signed amounts',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>response(japanFixture())));const {container}=render(<JapanMoney/>);
    await screen.findByText('已取得日本证券跨境交易周报');
    expect(screen.getByText('+5 亿 JPY',{selector:'strong'})).toBeTruthy();
    expect(screen.getByText('2026-10-25 至 2026-10-31',{selector:'b'})).toBeTruthy();
    expect(screen.getByText('2026-11-06',{selector:'b'})).toBeTruthy();
    expect(screen.getByText('仅指定报告机构样本，不是日本全国资金流总计')).toBeTruthy();
    expect(screen.getByText(/不提供行业、公司或投资者来源国家分解/)).toBeTruthy();
    expect(container.querySelectorAll('svg g[data-id]')).toHaveLength(2);
    expect(fetch).toHaveBeenCalledWith('/api/v1/japan/mof/snapshot',expect.objectContaining({redirect:'manual'}));
    fireEvent.click(screen.getAllByRole('button',{name:/日本证券.*股票及投资基金份额/})[0]);
    expect(screen.getByRole('region',{name:'所选日本证券类别证据'}).textContent).toContain('+20 亿 JPY');
    expect(screen.getByText(/官方净额和合计可能与展示分项相差少量单位/)).toBeTruthy();
  });
  it('clears displayed evidence and disables retries on permission denial',async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(response(japanFixture())).mockResolvedValueOnce(response({},403));vi.stubGlobal('fetch',fetcher);
    const {container}=render(<JapanMoney/>);await screen.findByText('已取得日本证券跨境交易周报');fireEvent.click(screen.getByRole('button',{name:'检查周报'}));
    await screen.findByText('来源访问已停止，金额保持空白');expect(container.querySelector('[data-id]')).toBeNull();
    expect((screen.getByRole('button',{name:'检查周报'}) as HTMLButtonElement).disabled).toBe(true);
    fireEvent(document,new Event('visibilitychange'));expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('keeps original acquisition time and warns on temporary network failure',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(response(japanFixture())).mockRejectedValueOnce(new Error('offline')));
    render(<JapanMoney/>);await screen.findByText('已取得日本证券跨境交易周报');fireEvent.click(screen.getByRole('button',{name:'检查周报'}));
    await screen.findByText('保留最近已核验周报 · 注意时效');expect(screen.getByText('+5 亿 JPY',{selector:'strong'})).toBeTruthy();
    expect(screen.getAllByText('2026-11-06 09:00:00.000 UTC')).toHaveLength(2);
  });
  it('does not retain invalid successful data',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(response(japanFixture())).mockResolvedValueOnce(response({snapshot:{unit:'shares'}})));
    const {container}=render(<JapanMoney/>);await screen.findByText('已取得日本证券跨境交易周报');fireEvent.click(screen.getByRole('button',{name:'检查周报'}));
    await screen.findByText('响应未通过校验，已清空金额。');expect(container.querySelector('[data-id]')).toBeNull();
  });
  it('hides source evidence after cache expiry instead of repainting old periods as current',async()=>{
    const old=japanFixture();old.snapshot!.fetched_at='2026-10-28T09:00:00.000Z';old.snapshot!.acquisition_started_at=old.snapshot!.fetched_at;old.snapshot!.updated_date='2026-10-28';
    old.snapshot!.report_start='2026-10-18';old.snapshot!.report_end='2026-10-24';old.snapshot!.report_date='2026-10-24';old.status.fetched_at=old.snapshot!.fetched_at;
    vi.stubGlobal('fetch',vi.fn(async()=>response(old)));const {container}=render(<JapanMoney/>);
    await waitFor(()=>expect(fetch).toHaveBeenCalledOnce());expect(container.querySelector('[data-id]')).toBeNull();expect(screen.queryByText('+5 亿 JPY',{selector:'strong'})).toBeNull();
  });
  it('keeps the selected category when the same report is revised',async()=>{
    const revised=japanFixture();revised.snapshot!.assets[0]={id:'equity_funds',acquisitions:30,dispositions:10,net:20};revised.snapshot!.total_net=15;
    vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(response(japanFixture())).mockResolvedValueOnce(response(revised)));
    render(<JapanMoney/>);await screen.findByText('已取得日本证券跨境交易周报');fireEvent.click(screen.getAllByRole('button',{name:/日本证券.*股票及投资基金份额/})[0]);
    fireEvent.click(screen.getByRole('button',{name:'检查周报'}));await waitFor(()=>expect(screen.getByRole('region',{name:'所选日本证券类别证据'}).textContent).toContain('+30 亿 JPY'));
  });
});
