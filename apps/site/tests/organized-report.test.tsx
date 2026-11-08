// @vitest-environment jsdom
import React from 'react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {projectJapanReport,projectTaiwanReport,type OrganizedReport} from '../lib/evidence/report-projection';
import JapanMoney from '../components/markets/JapanMoney';
import TaiwanMoney from '../components/markets/TaiwanMoney';
import {japanFixture,JAPAN_TEST_NOW} from './japan-mof-ui-fixture';
import {summaryFixture,SUMMARY_TEST_NOW} from './national-summary-fixture';
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true})});
const exported=()=>JSON.parse(decodeURIComponent(screen.getByRole('link',{name:'下载整理后的 JSON'}).getAttribute('href')!.split(',')[1])) as OrganizedReport;
function nativeValue(snapshot:unknown,path:string){return path.replace(/\[(\d+)\]/g,'.$1').split('.').reduce((value,key)=>(value as Record<string,unknown>)[key],snapshot)}
describe('actual normalized report records',()=>{
 it.each([{project:projectJapanReport,snapshot:japanFixture().snapshot},{project:projectTaiwanReport,snapshot:summaryFixture().snapshot}])('preserves every reported native field and differentiates absent values from observed zero',({project,snapshot})=>{
  const report=project(snapshot)!;
  expect(report.native_snapshot).toEqual(snapshot);
  expect(report.rows).toHaveLength(12);expect(new Set(report.rows.map(row=>row.id)).size).toBe(12);
  for(const row of report.rows){
   if(row.state==='reported'){expect(row.native_locator).not.toBeNull();expect(row.value).toBe(nativeValue(snapshot,row.native_locator!));}
   else {expect(row.value).toBeNull();expect(row.native_locator).toBeNull();}
  }
  expect(report.rows.some(row=>row.state==='reported'&&row.value===0)).toBe(true);
  expect(report.rows.some(row=>row.value!==null&&row.value<0)).toBe(true);
  expect(report.aggregation).toMatchObject({cross_source_allowed:false,total_overlaps_components:true});
  expect(report.rows.filter(row=>row.role==='reported_total')).toHaveLength(3);
  expect(report.clocks.fetched_at).toBe(snapshot!.fetched_at);expect(report.clocks.source_released_at).toBeNull();
  expect(report.net_direction.positive).toBeTruthy();expect(report.net_direction.negative).toBeTruthy();
  expect(report.source.raw_sha256).toBeNull();expect(report.whole_market_capital_flow).toBe(false);
  expect(project(null)).toBeNull();
 });
 it('retains official rounding rather than recalculating totals and retains JPY scale',()=>{
  const snapshot={...japanFixture().snapshot!,total_net:6};const report=projectJapanReport(snapshot,true)!;
  expect(report.unit).toEqual({code:'JPY_100_million',currency:'JPY',currency_multiplier:100000000});
  expect(report.rows.find(row=>row.native_locator==='total_net')?.value).toBe(6);
  expect(report.rows.filter(row=>row.state==='not_in_retained_snapshot')).toHaveLength(2);
  expect(report.geography.role).toBe('issuer_market');expect(report.presentation.stale).toBe(true);
  const taiwan=projectTaiwanReport(summaryFixture().snapshot)!;
  expect(taiwan.rows.find(row=>row.dimension.id==='foreign')?.dimension.label).toContain('不含自营商');
  expect(taiwan.unit).toEqual({code:'TWD',currency:'TWD',currency_multiplier:1});expect(taiwan.geography.role).toBe('local_market');
  expect(report.rows[0].metric_id).not.toBe(taiwan.rows[0].metric_id);
 });
 it('rejects wrong schemas, extra private fields and mislabeled units without producing export',()=>{
  expect(()=>projectJapanReport({...japanFixture().snapshot,unit:'JPY'})).toThrow();
  expect(()=>projectTaiwanReport({...summaryFixture().snapshot,account_token:'not-a-real-secret'})).toThrow();
  expect(()=>projectTaiwanReport(japanFixture().snapshot)).toThrow();
 });
});
const cases=[{name:'Japan',Component:JapanMoney,fixture:japanFixture,now:JAPAN_TEST_NOW,refresh:21600000,expiry:604800000,ready:'已取得日本证券跨境交易周报'},
 {name:'Taiwan',Component:TaiwanMoney,fixture:summaryFixture,now:SUMMARY_TEST_NOW,refresh:3600000,expiry:86400000,ready:'已取得每日法人交易报告'}];
describe.each(cases)('$name current-page export lifecycle',({Component,fixture,now,refresh,expiry,ready})=>{
 it('creates a real download and preview from the existing snapshot with no additional requests',async()=>{
  vi.spyOn(Date,'now').mockReturnValue(now);const fetcher=vi.fn(async()=>Response.json(fixture()));vi.stubGlobal('fetch',fetcher);
  render(<Component/>);await screen.findByText(ready);fireEvent.click(screen.getByText('整理后的当前证据 · 统一字段与原值追溯'));
  const data=exported();expect(data.rows).toHaveLength(12);expect(screen.getByRole('table')).toBeTruthy();
  expect(screen.getByRole('link',{name:'下载整理后的 JSON'}).getAttribute('download')).toBe(`${data.source_id}-${data.period.end}-organized.json`);
  expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it.each(['permission','invalid','denied','expired'])('removes the actual download when evidence becomes %s',async kind=>{
  vi.spyOn(Date,'now').mockReturnValue(now);const fetcher=vi.fn().mockResolvedValueOnce(Response.json(fixture()));vi.stubGlobal('fetch',fetcher);
  render(<Component/>);await screen.findByText(ready);fireEvent.click(screen.getByText('整理后的当前证据 · 统一字段与原值追溯'));expect(exported().rows.length).toBe(12);
  if(kind==='expired'){
   Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});vi.mocked(Date.now).mockReturnValue(now+expiry+1);
  }else{
   const reply=fixture();fetcher.mockResolvedValueOnce(kind==='permission'?new Response('',{status:403}):kind==='invalid'?Response.json({snapshot:{}}):Response.json({snapshot:null,status:{...reply.status,state:'denied',error_code:'source_denied'}},{status:503}));
   vi.mocked(Date.now).mockReturnValue(now+refresh+1);
  }
  fireEvent(document,new Event('visibilitychange'));
  await waitFor(()=>expect(screen.queryByText('整理后的当前证据 · 统一字段与原值追溯')).toBeNull());
  expect(screen.queryByRole('link',{name:'下载整理后的 JSON',hidden:true})).toBeNull();expect(fetcher).toHaveBeenCalledTimes(kind==='expired'?1:2);
 });
 it('exports retained temporary-failure evidence with original time and explicit stale state',async()=>{
  vi.spyOn(Date,'now').mockReturnValue(now);const fetcher=vi.fn().mockResolvedValueOnce(Response.json(fixture())).mockRejectedValueOnce(new Error('offline'));vi.stubGlobal('fetch',fetcher);
  render(<Component/>);await screen.findByText(ready);fireEvent.click(screen.getByText('整理后的当前证据 · 统一字段与原值追溯'));
  vi.mocked(Date.now).mockReturnValue(now+refresh+1);fireEvent(document,new Event('visibilitychange'));
  await waitFor(()=>expect(exported().presentation.stale).toBe(true));expect(exported().clocks.fetched_at).toBe(fixture().snapshot!.fetched_at);
 });
});
