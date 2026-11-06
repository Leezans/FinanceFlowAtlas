// @vitest-environment jsdom
import React from 'react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import Page from '../app/ashare/page';
import {createAshareHandler,FIELDS,type Row} from '../lib/ashare/ashare';
import {type Snapshot,parseScope} from '../lib/ashare/snapshot';
const scope=parseScope(new URL('https://offline.invalid/?scope=level1'));
const row=Object.fromEntries(FIELDS.map(f=>[f,f==='f12'?'BK0001':f==='f14'?'合成行业':1])) as Row;
const evidence={schema:'ashare-provider-evidence/1',rows:[row],source_total:1,fetched_at:'2026-11-05T12:00:00Z',collection_started_at:'2026-11-05T11:59:40Z',scope,page_count:1,source_observed_at:null,trade_date:null,metric_kind:'provider_order_flow_proxy',metric_field:'f62',unit:'CNY',field_units:{f62:'CNY',f3:'percent',f2:'index_points'},delay_status:'not_provided',classification_exclusivity:'not_established',notice:'合成测试',stale:false,has_error:false};
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.useRealTimers();});
async function advance(ms:number){await act(async()=>{await vi.advanceTimersByTimeAsync(ms);});}
describe('server-relative next A-share check',()=>{
 it('returns remaining oldest-page freshness on 200 and 304 without another source call',async()=>{
  const snapshot:Snapshot={rows:[row],source_total:1,scope,page_count:1,fetched_at:'2026-11-05T12:00:00Z',collection_started_at:'2026-11-05T11:59:40Z'};
  const fetcher=vi.fn(),handler=createAshareHandler({enabled:()=>true,isolatedForTests:true,fetcher,snapshotStore:{read:async()=>({snapshot,ageMs:59800,canAcquire:true}),commit:vi.fn()}});
  const request=(etag?:string)=>new Request('https://offline.invalid/api/v1/ashare/snapshot?scope=level1',{headers:etag?{'if-none-match':etag}:{}});
  const response=await handler(request());expect(response.status).toBe(200);expect(response.headers.get('x-ashare-refresh-after')).toBe('1');
  const unchanged=await handler(request(response.headers.get('etag')!));expect(unchanged.status).toBe(304);expect(unchanged.headers.get('x-ashare-refresh-after')).toBe('1');expect(fetcher).not.toHaveBeenCalled();
 });
 it('does not skip a full source refresh when a mount-time tick precedes the DB acquisition clock',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-05T12:00:00Z'));
  let snapshot:Snapshot|undefined;
  const source=vi.fn(async()=>new Response(JSON.stringify({rc:0,data:{total:1,diff:[row]}}),{headers:{'content-type':'application/json'}}));
  const handler=createAshareHandler({enabled:()=>true,isolatedForTests:true,now:()=>Date.now(),fetcher:source,
   sourceGate:{acquire:async()=>({token:'synthetic-only',acquiredAtMs:Date.now()}),release:vi.fn()},
   stageStore:{read:async()=>undefined,save:vi.fn(),discard:vi.fn()},
   snapshotStore:{read:async()=>{await new Promise(resolve=>setTimeout(resolve,200));return {canAcquire:true,...(snapshot?{snapshot,ageMs:Date.now()-Date.parse(snapshot.collection_started_at!)}:{})};},commit:async(_token,value)=>{snapshot=value;}}});
  vi.stubGlobal('fetch',vi.fn((url:string,init:RequestInit)=>handler(new Request('https://offline.invalid'+url,{headers:init.headers}))));
  render(<Page/>);await advance(1000);expect(source).toHaveBeenCalledOnce();
  await advance(59000);expect(source).toHaveBeenCalledOnce(); // Never shorten the original 60s evidence TTL.
  await advance(2000);expect(source).toHaveBeenCalledTimes(2);expect(screen.getByRole('button',{name:/合成行业.*BK0001/})).toBeTruthy();
 });
 it('rechecks a nearly expired cache without losing another minute or changing evidence timestamps',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2040-01-01T00:00:00Z')); // Client wall-clock is deliberately unrelated to source timestamps.
  const mock=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(evidence),{headers:{etag:'"old"','x-ashare-refresh-after':'1'}})).mockResolvedValueOnce(new Response(JSON.stringify({...evidence,rows:[{...row,f62:2}]}),{headers:{etag:'"new"','x-ashare-refresh-after':'40'}}));vi.stubGlobal('fetch',mock);
  render(<Page/>);await advance(1);expect(mock).toHaveBeenCalledOnce();expect(screen.getByRole('button',{name:/合成行业.*BK0001/})).toBeTruthy();
  await advance(999);expect(mock).toHaveBeenCalledOnce();await advance(101);expect(mock).toHaveBeenCalledTimes(2);expect(mock.mock.calls[1][1].headers).toEqual({'If-None-Match':'"old"'});
  await advance(39000);expect(mock).toHaveBeenCalledTimes(2);
 });
 it('never overlaps an expiry refresh and cancels the scheduled check on unmount',async()=>{
  vi.useFakeTimers();let finish!:(response:Response)=>void;
  const mock=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(evidence),{headers:{'x-ashare-refresh-after':'1'}})).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));vi.stubGlobal('fetch',mock);
  const view=render(<Page/>);await advance(1200);expect(mock).toHaveBeenCalledTimes(2);
  await advance(30000);expect(mock).toHaveBeenCalledTimes(2);
  await act(async()=>finish(new Response(JSON.stringify(evidence),{headers:{'x-ashare-refresh-after':'1'}})));
  view.unmount();await advance(60000);expect(mock).toHaveBeenCalledTimes(2);
 });
 it('replaces an old-scope expiry timer when a stock scope is selected',async()=>{
  vi.useFakeTimers();const mock=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(evidence),{headers:{'x-ashare-refresh-after':'1'}})).mockResolvedValue(new Response(JSON.stringify({error_code:'source_denied'}),{status:503,headers:{'x-ashare-recovery':'stopped'}}));vi.stubGlobal('fetch',mock);
  render(<Page/>);await advance(1);fireEvent.click(screen.getByRole('button',{name:/合成行业.*BK0001/}));await advance(1);
  expect(mock.mock.calls[1][0]).toContain('scope=BK0001');await advance(180000);expect(mock).toHaveBeenCalledTimes(2);
 });

});
