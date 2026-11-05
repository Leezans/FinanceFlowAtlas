import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createAshareHandler} from '../lib/ashare/ashare';
import {FIELDS,decodeSnapshot,encodeSnapshot,parseScope,validateRow} from '../lib/ashare/snapshot';
import {validateEvidence} from '../components/ashare/model';

// Synthetic metadata only. These values are not captured provider evidence.
const epoch = Date.parse('2026-11-05T02:00:00Z') / 1000;
const makeRow = (stock:boolean,extra:Record<string,unknown>={})=>({
 ...Object.fromEntries(FIELDS.map(field=>[field,field==='f12'?(stock?'000001':'BK0001'):field==='f14'?'合成时间测试':1])),
 ...extra,
});
const scopeFor = (stock:boolean)=>parseScope(new URL(`https://synthetic.invalid/?scope=${stock?'BK0001':'level1'}`));
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-05T02:00:00Z'));});
afterEach(()=>vi.useRealTimers());

describe('unknown flow observation time is not replaced by quote or transport clocks',()=>{
 it.each([false,true])('does not promote f124/f297 or HTTP Date to flow metadata for stocks=%s',async stock=>{
  const sourceRow=makeRow(stock,{f124:epoch,f297:20261105});
  const fetcher=vi.fn(async()=>new Response(JSON.stringify({rc:0,data:{total:1,diff:[sourceRow]}}),{
   headers:{'content-type':'application/json',date:'Thu, 05 Nov 2026 02:00:00 GMT'},
  }));
  const handler=createAshareHandler({enabled:()=>true,fetcher,isolatedForTests:true});
  const response=await handler(new Request(`https://synthetic.invalid/api/v1/ashare/snapshot?scope=${stock?'BK0001':'level1'}`));
  expect(response.status).toBe(200);
  const result=validateEvidence(await response.json());
  expect(result).toMatchObject({source_observed_at:null,trade_date:null,delay_status:'not_provided',metric_field:'f62'});
  expect(result.rows[0]).not.toHaveProperty('f124');
  expect(result.rows[0]).not.toHaveProperty('f297');
  expect(result.rows[0].f62).toBe(1);
  expect(fetcher).toHaveBeenCalledTimes(1);
  // A future timestamp feature needs a separate validated contract, not a cast.
  expect(()=>validateEvidence({...result,source_observed_at:'2026-11-05T02:00:00Z'})).toThrow();
  expect(()=>validateEvidence({...result,trade_date:'2026-11-05'})).toThrow();
  expect(()=>validateEvidence({...result,delay_status:'real_time'})).toThrow();
 });

 it.each([undefined,null,'-',0,epoch,epoch*1000,'2026-11-05',Infinity])('ignores unvalidated f124=%s without fabricating zero flow',f124=>{
  const scope=scopeFor(false);
  const missing=validateRow(makeRow(false,{f124,f297:20261105,f62:null}),scope);
  const zero=validateRow(makeRow(false,{f124,f297:20261105,f62:0}),scope);
  expect(missing.f62).toBeNull();expect(zero.f62).toBe(0);
  expect(missing).not.toHaveProperty('f124');expect(zero).not.toHaveProperty('f297');
 });

 it('does not resurrect unverified time fields when canonicalizing a durable snapshot',()=>{
  const scope=scopeFor(false);
  const snapshot={rows:[makeRow(false,{f124:epoch,f297:20261105})],source_total:1,
   fetched_at:'2026-11-05T02:00:00.000Z',scope,page_count:1,
   source_observed_at:'2026-11-05T02:00:00Z',trade_date:'2026-11-05'};
  const decoded=decodeSnapshot(JSON.stringify(snapshot),scope);
  const roundtrip=decodeSnapshot(encodeSnapshot(decoded),scope);
  expect(roundtrip.rows[0].f62).toBe(1);
  expect(roundtrip).not.toHaveProperty('source_observed_at');
  expect(roundtrip).not.toHaveProperty('trade_date');
  expect(roundtrip.rows[0]).not.toHaveProperty('f124');
 });
});
