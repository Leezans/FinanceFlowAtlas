// @vitest-environment jsdom
import React from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import JapanMoney from '../components/markets/JapanMoney';
import TaiwanMoney from '../components/markets/TaiwanMoney';
import {japanFixture,JAPAN_TEST_NOW} from './japan-mof-ui-fixture';
import {summaryFixture,SUMMARY_TEST_NOW} from './national-summary-fixture';
import {MAX_CACHE_AGE_MS,MAX_REPORT_AGE_DAYS} from '../lib/japan/model';
import {TPEX_SUMMARY_CACHE_AGE_MS,TPEX_SUMMARY_MAX_REPORT_DAYS} from '../lib/national/tpex-summary-policy';

const downloadName='下载整理后的 JSON';
const visible=(state:string)=>Object.defineProperty(document,'visibilityState',{value:state,configurable:true});
beforeEach(()=>{vi.useFakeTimers();visible('visible');});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();visible('visible');});
const cases=[
  {name:'Japan',Component:JapanMoney,fixture:japanFixture,now:JAPAN_TEST_NOW,ttl:MAX_CACHE_AGE_MS,days:MAX_REPORT_AGE_DAYS,offset:9},
  {name:'Taiwan',Component:TaiwanMoney,fixture:summaryFixture,now:SUMMARY_TEST_NOW,ttl:TPEX_SUMMARY_CACHE_AGE_MS,days:TPEX_SUMMARY_MAX_REPORT_DAYS,offset:8},
];
describe.each(cases)('$name click-time report permission',({Component,fixture,now,ttl,days,offset})=>{
  it.each(['cache','report'] as const)('allows the inclusive %s age boundary, then rejects one millisecond later without a timer tick',async limit=>{
    const data=fixture();
    const boundary=limit==='cache'?now+ttl:Date.parse(data.snapshot!.report_date)-offset*3_600_000+days*86_400_000;
    const start=limit==='cache'?now:boundary-1;
    if(limit==='report'){
      // Keep fetch age valid so this case isolates the source's report-age limit.
      data.snapshot!.fetched_at=data.snapshot!.acquisition_started_at=new Date(start).toISOString();
      data.status.fetched_at=data.snapshot!.fetched_at;
    }
    vi.setSystemTime(start);
    const fetcher=vi.fn(async()=>Response.json(data));vi.stubGlobal('fetch',fetcher);
    render(<Component/>);await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
    const link=screen.getByRole('link',{name:downloadName});
    const href=link.getAttribute('href');
    vi.setSystemTime(boundary);
    // Capture the application's decision, then suppress jsdom's native navigation.
    let allowed=false;
    const capture=(event:MouseEvent)=>{allowed=!event.defaultPrevented;event.preventDefault();};
    document.addEventListener('click',capture,{once:true});
    fireEvent.click(link);expect(allowed).toBe(true);expect(link.getAttribute('href')).toBe(href);
    vi.setSystemTime(boundary+1);
    const expired=new MouseEvent('click',{bubbles:true,cancelable:true});fireEvent(link,expired);
    expect(expired.defaultPrevented).toBe(true);
    expect(screen.queryByRole('link',{name:downloadName})).toBeNull();
    expect(screen.queryByText('整理后的当前证据 · 统一字段与原值追溯')).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(['visible','hidden'])('rejects an expired export with suspended timers in a %s tab and retains the server deadline',async state=>{
    const data=fixture();data.status.next_retry_at=new Date(now+ttl*3).toISOString();
    vi.setSystemTime(now);
    const fetcher=vi.fn(async()=>Response.json(data));vi.stubGlobal('fetch',fetcher);
    render(<Component/>);await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
    const link=screen.getByRole('link',{name:downloadName});
    visible(state);fireEvent(document,new Event('visibilitychange'));
    vi.setSystemTime(now+ttl+1);
    const expired=new MouseEvent('click',{bubbles:true,cancelable:true});fireEvent(link,expired);
    expect(expired.defaultPrevented).toBe(true);
    expect(screen.queryByRole('link',{name:downloadName})).toBeNull();
    expect(screen.getByRole('button',{name:/检查(周报|报告)/}).hasAttribute('disabled')).toBe(true);
    visible('visible');fireEvent(document,new Event('visibilitychange'));
    await act(async()=>{await vi.advanceTimersByTimeAsync(30_000);});
    expect(screen.queryByRole('link',{name:downloadName})).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects a backwards clock without downloading evidence fetched in the future',async()=>{
    vi.setSystemTime(now);const fetcher=vi.fn(async()=>Response.json(fixture()));vi.stubGlobal('fetch',fetcher);
    render(<Component/>);await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
    const link=screen.getByRole('link',{name:downloadName});vi.setSystemTime(now-1);
    const event=new MouseEvent('click',{bubbles:true,cancelable:true});fireEvent(link,event);
    expect(event.defaultPrevented).toBe(true);expect(screen.queryByRole('link',{name:downloadName})).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
