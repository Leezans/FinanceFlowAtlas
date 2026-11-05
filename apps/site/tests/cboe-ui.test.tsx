// @vitest-environment jsdom
import React from 'react';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import CboeQuotes from '../components/cboe/CboeQuotes';
import {reply,NOW} from './cboe-fixture';
vi.mock('../components/matrix/MatrixHeatmap',()=>({default:({groups,title}:{groups:{items:{label:string;displayValue:string}[]}[];title:string})=><section aria-label={title}>{groups.flatMap(g=>g.items.map(i=><p key={i.label}>{i.label} {i.displayValue}</p>))}</section>}));
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.useRealTimers();});
describe('Cboe delayed matrix UI',()=>{
 it('renders exact delay/scope, neutral price and timestamps, with no flow inference',async()=>{vi.spyOn(Date,'now').mockReturnValue(NOW);vi.stubGlobal('fetch',vi.fn(async()=>Response.json(reply())));render(<CboeQuotes/>);await waitFor(()=>expect(screen.getByText(/GB0000000001 12.3456 GBP/)).toBeTruthy());expect(screen.getByText('这是成交价格，不是资金净流入')).toBeTruthy();expect(screen.getByText(/12:00:00.123789 UTC/)).toBeTruthy();expect(screen.getByRole('button',{name:'检查更新'}).hasAttribute('disabled')).toBe(true);});
 it('filters by ISIN and keeps missing result empty',async()=>{vi.spyOn(Date,'now').mockReturnValue(NOW);vi.stubGlobal('fetch',vi.fn(async()=>Response.json(reply())));render(<CboeQuotes/>);await waitFor(()=>expect(screen.getByText(/GB0000000001 12.3456 GBP/)).toBeTruthy());fireEvent.change(screen.getByRole('searchbox'),{target:{value:'US'}});expect(screen.queryByText(/GB0000000001 12.3456 GBP/)).toBeNull();});
 it('labels retained prices and the latest empty source check separately',async()=>{
  vi.spyOn(Date,'now').mockReturnValue(NOW+60_000);const body=reply();body.status.state='stale';body.latest_empty_check={...body.snapshot!,fetchedAt:new Date(NOW+60_000).toISOString(),rows:[],coverage:{rawRows:1,rejectedRows:1,qualifiedRows:0}};
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json(body)));render(<CboeQuotes/>);
  await waitFor(()=>expect(screen.getByText('本次窗口无合格成交，保留上次核验价格')).toBeTruthy());expect(screen.getByText(/不是当前报价；空窗口本身不能确认市场已休市/)).toBeTruthy();expect(screen.getByText(/GB0000000001 12.3456 GBP/)).toBeTruthy();
 });
 it('retains verified prices only on transport failure and expires them from their original clock',async()=>{
  vi.useFakeTimers();vi.setSystemTime(NOW);const f=vi.fn().mockResolvedValueOnce(Response.json(reply())).mockRejectedValue(new TypeError('offline'));
  vi.stubGlobal('fetch',f);render(<CboeQuotes/>);await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
  await act(async()=>{await vi.advanceTimersByTimeAsync(60_000);});expect(screen.getByText(/GB0000000001 12.3456 GBP/)).toBeTruthy();expect(screen.getByText('连接中断，显示上次核验快照')).toBeTruthy();
  vi.setSystemTime(NOW+86_400_001);await act(async()=>{await vi.advanceTimersByTimeAsync(1000);});expect(screen.queryByText(/GB0000000001 12.3456 GBP/)).toBeNull();
 });
 it('clears previously verified prices on an HTTP denial or invalid received response',async()=>{
  for(const status of [403,200]){
   vi.useFakeTimers();vi.setSystemTime(NOW);const f=vi.fn().mockResolvedValueOnce(Response.json(reply())).mockResolvedValueOnce(Response.json({invalid:true},{status}));
   vi.stubGlobal('fetch',f);render(<CboeQuotes/>);await act(async()=>{await vi.advanceTimersByTimeAsync(0);});expect(screen.getByText(/GB0000000001 12.3456 GBP/)).toBeTruthy();
   await act(async()=>{await vi.advanceTimersByTimeAsync(60_000);});expect(screen.queryByText(/GB0000000001 12.3456 GBP/)).toBeNull();cleanup();vi.useRealTimers();
  }
 });
 it('aborts on unmount and ignores a late response',async()=>{let signal:AbortSignal|undefined,finish:(r:Response)=>void=()=>{};const f=vi.fn((_u:unknown,opts:RequestInit)=>{signal=opts.signal as AbortSignal;return new Promise<Response>(resolve=>{finish=resolve;});});vi.stubGlobal('fetch',f);const r=render(<CboeQuotes/>);await waitFor(()=>expect(f).toHaveBeenCalledTimes(1));r.unmount();expect(signal?.aborted).toBe(true);await act(async()=>{finish(Response.json(reply()));});});
 it('stops periodic requests after a denial',async()=>{vi.useFakeTimers();vi.setSystemTime(NOW);const body=reply();body.status.state='denied';body.snapshot=null;body.status.next_retry_at=null;const f=vi.fn(async()=>Response.json(body,{status:503}));vi.stubGlobal('fetch',f);render(<CboeQuotes/>);await act(async()=>{await vi.advanceTimersByTimeAsync(0);});expect(f).toHaveBeenCalledTimes(1);await act(async()=>{await vi.advanceTimersByTimeAsync(180_000);});expect(f).toHaveBeenCalledTimes(1);});
 it('does not display rows from a denied reply or malformed response',async()=>{vi.spyOn(Date,'now').mockReturnValue(NOW);const body=reply();body.status.state='denied';body.snapshot=null;body.status.next_retry_at=null;vi.stubGlobal('fetch',vi.fn(async()=>Response.json(body,{status:503})));render(<CboeQuotes/>);await waitFor(()=>expect(screen.getByText('来源拒绝访问，已停止请求')).toBeTruthy());expect(screen.queryByText(/GB0000000001/)).toBeNull();});
});
