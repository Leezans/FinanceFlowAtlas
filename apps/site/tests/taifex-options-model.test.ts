import {describe,it,expect} from 'vitest';
import {MAX_BYTES,REFRESH_MS,MAX_CACHE_AGE_MS,MAX_REPORT_AGE_DAYS,STALE_REPORT_DAYS,MAX_SOURCE_THOUSANDS,rowSchema,snapshotSchema,replySchema,reportAge,visibleSnapshot} from '../lib/options/taifex/model';
import {at,iso,taifexReply} from './taifex-options-fixture';
const snapshot=()=>taifexReply().snapshot!;
const withDate=(date:string,now:number)=>{const reply=taifexReply();reply.snapshot!.report_date=date;reply.snapshot!.acquisition_started_at=reply.snapshot!.fetched_at=new Date(now).toISOString();reply.status.fetched_at=reply.snapshot!.fetched_at;return reply;};
describe('TAIFEX strict daily evidence model',()=>{
 it('accepts the exact 5 × 2 × 3 daily TWD snapshot and report envelope',()=>{
  expect(snapshotSchema.parse(snapshot())).toEqual(snapshot());expect(replySchema.parse(taifexReply())).toEqual(taifexReply());
  expect(snapshot().rows).toHaveLength(30);expect(new Set(snapshot().rows.map(row=>row.id)).size).toBe(30);
  expect([REFRESH_MS,MAX_CACHE_AGE_MS,MAX_BYTES,STALE_REPORT_DAYS,MAX_REPORT_AGE_DAYS]).toEqual([3600000,86400000,256000,4,14]);
 });
 it('requires schema, provenance, currency, frequency, absent capital flow and absent release timestamp',()=>{
  for(const patch of [{schema:'taifex-options-institutions/2'},{source:'Deribit'},{currency:'USD'},{source_unit:'TWD'},{frequency:'realtime'},{net_capital_flow:0},{source_released_at:iso},{unknown:true}])expect(snapshotSchema.safeParse({...snapshot(),...patch}).success).toBe(false);
  for(const key of Object.keys(snapshot())){const value:Record<string,unknown>={...snapshot()};delete value[key];expect(snapshotSchema.safeParse(value).success).toBe(false);}
 });
 it('rejects duplicate, missing, extra and unknown product/participant/type categories',()=>{
  const s=snapshot();
  for(const rows of [s.rows.slice(1),[...s.rows,s.rows[0]],s.rows.map((row,i)=>i===1?s.rows[0]:row),s.rows.map((row,i)=>i===0?{...row,product:'unknown'}:row),s.rows.map((row,i)=>i===0?{...row,participant:'total'}:row),s.rows.map((row,i)=>i===0?{...row,option_type:'future'}:row)])expect(snapshotSchema.safeParse({...s,rows}).success).toBe(false);
  expect(rowSchema.safeParse({...s.rows[0],id:'txo/call/foreign'}).success).toBe(false);
 });
 it('keeps source-rounded reported monetary nets and permits only one-thousand rounding differences',()=>{
  const row=snapshot().rows[0];expect(row.buy_amount-row.sell_amount).toBe(3000);expect(row.reported_net_amount).toBe(4000);
  for(const net of [2000,3000,4000])expect(rowSchema.safeParse({...row,reported_net_amount:net}).success).toBe(true);
  for(const net of [1000,5000])expect(rowSchema.safeParse({...row,reported_net_amount:net}).success).toBe(false);
  for(const net of [8000,9000,10000])expect(rowSchema.safeParse({...row,reported_net_oi_amount:net}).success).toBe(true);
  expect(rowSchema.safeParse({...row,reported_net_oi_amount:11000}).success).toBe(false);
  expect(rowSchema.safeParse({...row,net_contracts:4}).success).toBe(false);expect(rowSchema.safeParse({...row,net_oi_contracts:4}).success).toBe(false);
 });
 it('rejects missing, fractional, unsafe, nonfinite, negative unsigned and non-thousand amounts',()=>{
  const row=snapshot().rows[0];
  for(const key of ['buy_contracts','sell_contracts','long_oi_contracts','short_oi_contracts','buy_amount','sell_amount','long_oi_amount','short_oi_amount']){
   for(const value of [undefined,null,-1,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])expect(rowSchema.safeParse({...row,[key]:value}).success).toBe(false);
  }
  for(const key of ['reported_net_amount','reported_net_oi_amount'])for(const value of [undefined,null,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])expect(rowSchema.safeParse({...row,[key]:value}).success).toBe(false);
  expect(rowSchema.safeParse({...row,buy_amount:12001}).success).toBe(false);
  expect(rowSchema.safeParse({...row,buy_amount:MAX_SOURCE_THOUSANDS*1000,sell_amount:MAX_SOURCE_THOUSANDS*1000,reported_net_amount:0}).success).toBe(true);
  expect(rowSchema.safeParse({...row,extra:1}).success).toBe(false);
 });

 it('rejects individually safe monetary fields whose cross-row totals exceed safe precision',()=>{
  const s=snapshot(),max=MAX_SOURCE_THOUSANDS*1000;
  const overflowing=s.rows.map(row=>({...row,buy_contracts:1,sell_contracts:1,net_contracts:0,buy_amount:max,sell_amount:max,reported_net_amount:0}));
  expect(overflowing.every(row=>rowSchema.safeParse(row).success)).toBe(true);
  expect(snapshotSchema.safeParse({...s,rows:overflowing}).success).toBe(false);
  const oiOverflow=s.rows.map(row=>({...row,long_oi_contracts:1,short_oi_contracts:1,net_oi_contracts:0,long_oi_amount:max,short_oi_amount:max,reported_net_oi_amount:0}));
  expect(oiOverflow.every(row=>rowSchema.safeParse(row).success)).toBe(true);
  expect(snapshotSchema.safeParse({...s,rows:oiOverflow}).success).toBe(false);
  const safe=s.rows.map((row,i)=>({...row,buy_amount:i===0?max:0,sell_amount:i===0?max:0,reported_net_amount:0}));
  expect(snapshotSchema.safeParse({...s,rows:safe}).success).toBe(true);
  const signedOverflow=s.rows.map((row,i)=>({...row,buy_amount:i===0?max:0,sell_amount:0,reported_net_amount:i===0?max:1000}));
  expect(signedOverflow.every(row=>rowSchema.safeParse(row).success)).toBe(true);
  expect(snapshotSchema.safeParse({...s,rows:signedOverflow}).success).toBe(false);
  const negativeOverflow=signedOverflow.map(row=>({...row,buy_amount:0,sell_amount:row.buy_amount,reported_net_amount:-row.reported_net_amount}));
  expect(snapshotSchema.safeParse({...s,rows:negativeOverflow}).success).toBe(false);
 });

 it.each([
  ['buy_contracts','buy_amount','net_contracts','reported_net_amount',1],
  ['sell_contracts','sell_amount','net_contracts','reported_net_amount',-1],
  ['long_oi_contracts','long_oi_amount','net_oi_contracts','reported_net_oi_amount',1],
  ['short_oi_contracts','short_oi_amount','net_oi_contracts','reported_net_oi_amount',-1],
 ] as const)('requires %s zero to imply %s zero, without requiring the reverse',(count,amount,netCount,netAmount,sign)=>{
  const s=snapshot(),zero=s.rows.find(row=>row.product==='teo')!;
  const invalid={...zero,[amount]:1000,[netAmount]:sign*1000};
  // Both source net balances are valid; only the zero-count amount is false.
  expect(rowSchema.safeParse(invalid).success).toBe(false);
  expect(snapshotSchema.safeParse({...s,rows:s.rows.map(row=>row.id===zero.id?invalid:row)}).success).toBe(false);
  const roundedSmall={...zero,[count]:1,[netCount]:sign};
  expect(rowSchema.safeParse(roundedSmall).success).toBe(true);
  expect(snapshotSchema.safeParse({...s,rows:s.rows.map(row=>row.id===zero.id?roundedSmall:row)}).success).toBe(true);
 });
 it('retains complete source-zero rows as known zero',()=>{
  const rows=snapshot().rows.filter(row=>row.product==='teo');expect(rows).toHaveLength(6);
  for(const row of rows){expect(rowSchema.safeParse(row).success).toBe(true);expect(Object.entries(row).filter(([,value])=>typeof value==='number').every(([,value])=>value===0)).toBe(true);}
 });
 it('validates real report dates and coherent acquisition clocks in Taipei',()=>{
  const s=snapshot();
  for(const report_date of ['2026-02-29','2026-04-31','2026-13-01','2026-11-07','20261105',''])expect(snapshotSchema.safeParse({...s,report_date}).success).toBe(false);
  expect(snapshotSchema.safeParse({...s,report_date:'2024-02-29'}).success).toBe(true);
  expect(snapshotSchema.safeParse({...s,fetched_at:new Date(at-1).toISOString()}).success).toBe(false);
  expect(snapshotSchema.safeParse({...s,acquisition_started_at:'not a date'}).success).toBe(false);
  const midnight=Date.parse('2026-11-06T16:00:00Z');
  expect(snapshotSchema.safeParse({...s,report_date:'2026-11-07',acquisition_started_at:new Date(midnight).toISOString(),fetched_at:new Date(midnight).toISOString()}).success).toBe(true);
  expect(snapshotSchema.safeParse({...s,report_date:'2026-11-07',acquisition_started_at:new Date(midnight-1).toISOString(),fetched_at:new Date(midnight).toISOString()}).success).toBe(false);
 });
 it('counts source age in Taipei calendar days rather than fractional age or guessed business days',()=>{
  const s=snapshot();expect(reportAge(s,Date.parse('2026-11-05T15:59:59.999Z'))).toBe(0);
  expect(reportAge(s,Date.parse('2026-11-05T16:00:00Z'))).toBe(1);
  expect(reportAge(s,Date.parse('2026-11-08T16:00:00Z'))).toBe(4);
  expect(reportAge(s,Date.parse('2026-11-09T16:00:00Z'))).toBe(5);
 });
 it('expires independently on 24-hour cache age and 14-calendar-day report age with five-second skew',()=>{
  const reply=taifexReply();expect(visibleSnapshot(reply,at-5000)).toEqual(reply.snapshot);expect(visibleSnapshot(reply,at-5001)).toBeNull();
  expect(visibleSnapshot(reply,at+MAX_CACHE_AGE_MS)).toEqual(reply.snapshot);expect(visibleSnapshot(reply,at+MAX_CACHE_AGE_MS+1)).toBeNull();
  const now=Date.parse('2026-11-20T03:00:00Z');
  expect(visibleSnapshot(withDate('2026-11-06',now),now)).toBeTruthy();expect(visibleSnapshot(withDate('2026-11-05',now),now)).toBeNull();
  expect(visibleSnapshot(withDate('2026-11-21',now),now)).toBeNull();expect(visibleSnapshot(reply,NaN)).toBeNull();
  expect(visibleSnapshot(null,at)).toBeNull();
 });
 it('requires status/snapshot identity and never displays unavailable or denied evidence',()=>{
  const reply=taifexReply();for(const state of ['denied','unavailable'] as const){const invalid={...reply,status:{...reply.status,state}};expect(replySchema.safeParse(invalid).success).toBe(false);expect(visibleSnapshot(invalid,at)).toBeNull();expect(replySchema.safeParse({...invalid,snapshot:null}).success).toBe(true);}
  expect(replySchema.safeParse({...reply,snapshot:null}).success).toBe(false);
  expect(replySchema.safeParse({...reply,status:{...reply.status,fetched_at:new Date(at+1).toISOString()}}).success).toBe(false);
  expect(replySchema.safeParse({...reply,status:{...reply.status,refresh_ms:60000}}).success).toBe(false);
  expect(replySchema.safeParse({...reply,status:{...reply.status,unexpected:0}}).success).toBe(false);
 });
});
