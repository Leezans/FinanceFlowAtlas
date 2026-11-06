import {describe,it,expect} from 'vitest';
import {MAX_BYTES,REFRESH_MS,MAX_CACHE_AGE_MS,MAX_REPORT_AGE_DAYS,STALE_REPORT_DAYS,MAX_SOURCE_THOUSANDS,PRODUCTS,rowSchema,snapshotSchema,replySchema,reportAge,visibleSnapshot} from '../lib/futures/taifex/model';
import {NOW,FETCHED,futuresReply,futuresSnapshot} from './taifex-futures-fixture';
const withDate=(date:string,now:number)=>{const reply=futuresReply(now);reply.snapshot!.report_date=date;return reply;};
const zeroRow=()=>({...futuresSnapshot().rows[0],buy_contracts:0,sell_contracts:0,net_contracts:0,buy_amount:0,sell_amount:0,reported_net_amount:0,long_oi_contracts:0,short_oi_contracts:0,net_oi_contracts:0,long_oi_amount:0,short_oi_amount:0,reported_net_oi_amount:0});
describe('TAIFEX strict futures daily evidence model',()=>{
 it('accepts exact verified coverage and application freshness limits',()=>{
  expect(snapshotSchema.parse(futuresSnapshot())).toEqual(futuresSnapshot());expect(replySchema.parse(futuresReply())).toEqual(futuresReply());
  expect(futuresSnapshot().rows).toHaveLength(69);expect([REFRESH_MS,MAX_CACHE_AGE_MS,MAX_BYTES,STALE_REPORT_DAYS,MAX_REPORT_AGE_DAYS]).toEqual([3600000,86400000,256000,4,14]);
 });
 it('requires futures provenance, metric and unknown release/cashflow, rejecting option semantics',()=>{
  for(const patch of [{schema:'taifex-options-institutions/1'},{source:'Deribit'},{currency:'USD'},{source_unit:'TWD'},{frequency:'realtime'},{metric:'premium_turnover'},{net_capital_flow:0},{source_released_at:FETCHED},{unknown:true}])expect(snapshotSchema.safeParse({...futuresSnapshot(),...patch}).success).toBe(false);
  for(const key of Object.keys(futuresSnapshot())){const value:Record<string,unknown>={...futuresSnapshot()};delete value[key];expect(snapshotSchema.safeParse(value).success).toBe(false);}
  expect(rowSchema.safeParse({...futuresSnapshot().rows[0],option_type:'call'}).success).toBe(false);
 });
 it('validates actual covered products, unique identity and exactly three participants per covered group',()=>{
  const s=futuresSnapshot();
  for(const rows of [s.rows.slice(1),[...s.rows,s.rows[0]],s.rows.map((row,i)=>i===1?s.rows[0]:row),s.rows.map((row,i)=>i===0?{...row,product:'unknown'}:row),s.rows.map((row,i)=>i===0?{...row,participant:'total'}:row)])expect(snapshotSchema.safeParse({...s,rows}).success).toBe(false);
  expect(rowSchema.safeParse({...s.rows[0],id:'tx/foreign'}).success).toBe(false);
  for(const covered_products of [[],['tx','tx'],s.covered_products.slice(1),[...s.covered_products,'unknown']])expect(snapshotSchema.safeParse({...s,covered_products}).success).toBe(false);
  const onlyTx={...s,rows:s.rows.filter(row=>row.product==='tx'),covered_products:['tx'],source_product_count:1};expect(snapshotSchema.safeParse(onlyTx).success).toBe(true);
  expect(snapshotSchema.safeParse({...onlyTx,covered_products:['mtx']}).success).toBe(false);
 });
 it('requires coherent bounded source and excluded group/row counts',()=>{
  const s=futuresSnapshot();
  for(const patch of [{source_product_count:22},{source_product_count:24},{source_product_count:101,excluded_product_count:78,excluded_row_count:234},{excluded_product_count:1},{excluded_row_count:3},{source_product_count:24,excluded_product_count:1,excluded_row_count:2},{source_product_count:23.5},{excluded_row_count:-1}])expect(snapshotSchema.safeParse({...s,...patch}).success).toBe(false);
  expect(snapshotSchema.safeParse({...s,source_product_count:24,excluded_product_count:1,excluded_row_count:3}).success).toBe(true);
  expect(snapshotSchema.safeParse({...s,source_product_count:100,excluded_product_count:77,excluded_row_count:231}).success).toBe(true);
 });
 it('keeps reported monetary nets with only ±1000 TWD independent-rounding tolerance',()=>{
  const row=futuresSnapshot().rows[0];
  for(const value of [0,1000,2000]){expect(rowSchema.safeParse({...row,reported_net_amount:value}).success).toBe(true);expect(rowSchema.safeParse({...row,reported_net_oi_amount:value}).success).toBe(true);}
  for(const value of [-1000,3000]){expect(rowSchema.safeParse({...row,reported_net_amount:value}).success).toBe(false);expect(rowSchema.safeParse({...row,reported_net_oi_amount:value}).success).toBe(false);}
  expect(rowSchema.safeParse({...row,net_contracts:2}).success).toBe(false);expect(rowSchema.safeParse({...row,net_oi_contracts:2}).success).toBe(false);
 });
 it('rejects missing, fractional, unsafe, nonfinite, negative unsigned and non-thousand amounts without throwing',()=>{
  const row=futuresSnapshot().rows[0];
  for(const key of ['buy_contracts','sell_contracts','long_oi_contracts','short_oi_contracts','buy_amount','sell_amount','long_oi_amount','short_oi_amount'])for(const value of [undefined,null,-1,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])expect(rowSchema.safeParse({...row,[key]:value}).success).toBe(false);
  for(const key of ['net_contracts','net_oi_contracts','reported_net_amount','reported_net_oi_amount'])for(const value of [undefined,null,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])expect(rowSchema.safeParse({...row,[key]:value}).success).toBe(false);
  expect(rowSchema.safeParse({...row,buy_amount:3001}).success).toBe(false);expect(rowSchema.safeParse({...row,extra:1}).success).toBe(false);
  expect(rowSchema.safeParse({...row,buy_amount:MAX_SOURCE_THOUSANDS*1000,sell_amount:MAX_SOURCE_THOUSANDS*1000,reported_net_amount:0}).success).toBe(true);
 });
 it('bounds exact aggregate monetary totals and counts, not just individual row integers',()=>{
  const s=futuresSnapshot(),max=MAX_SOURCE_THOUSANDS*1000;
  for(const patch of [
   {buy_amount:max,sell_amount:max,reported_net_amount:0},
   {long_oi_amount:max,short_oi_amount:max,reported_net_oi_amount:0},
   {buy_contracts:Number.MAX_SAFE_INTEGER,sell_contracts:Number.MAX_SAFE_INTEGER,net_contracts:0},
   {long_oi_contracts:Number.MAX_SAFE_INTEGER,short_oi_contracts:Number.MAX_SAFE_INTEGER,net_oi_contracts:0},
  ]){const rows=s.rows.map(row=>({...row,...patch}));expect(rows.every(row=>rowSchema.safeParse(row).success)).toBe(true);expect(snapshotSchema.safeParse({...s,rows}).success).toBe(false);}
  const safe=s.rows.map((row,i)=>({...row,buy_amount:i===0?max:0,sell_amount:i===0?max:0,reported_net_amount:0}));expect(snapshotSchema.safeParse({...s,rows:safe}).success).toBe(true);
  const signedOverflow=s.rows.map((row,i)=>({...row,buy_amount:i===0?max:0,sell_amount:0,reported_net_amount:i===0?max:1000}));expect(signedOverflow.every(row=>rowSchema.safeParse(row).success)).toBe(true);expect(snapshotSchema.safeParse({...s,rows:signedOverflow}).success).toBe(false);
  expect(snapshotSchema.safeParse({...s,rows:signedOverflow.map(row=>({...row,buy_amount:0,sell_amount:row.buy_amount,reported_net_amount:-row.reported_net_amount}))}).success).toBe(false);
 });
 it.each([
  ['buy_contracts','buy_amount','net_contracts','reported_net_amount',1],
  ['sell_contracts','sell_amount','net_contracts','reported_net_amount',-1],
  ['long_oi_contracts','long_oi_amount','net_oi_contracts','reported_net_oi_amount',1],
  ['short_oi_contracts','short_oi_amount','net_oi_contracts','reported_net_oi_amount',-1],
 ] as const)('requires zero %s to imply zero %s, allowing positive counts rounded to zero',(count,amount,netCount,netAmount,sign)=>{
  const zero=zeroRow();expect(rowSchema.safeParse(zero).success).toBe(true);
  expect(rowSchema.safeParse({...zero,[amount]:1000,[netAmount]:sign*1000}).success).toBe(false);
  expect(rowSchema.safeParse({...zero,[count]:1,[netCount]:sign}).success).toBe(true);
 });
 it('does not claim missing products were zero',()=>{
  const s=futuresSnapshot(),zero=zeroRow();
  const value={...s,covered_products:['tx'],source_product_count:1,rows:s.rows.filter(row=>row.product==='tx').map(row=>({...zero,id:row.id,participant:row.participant}))};
  const valid=snapshotSchema.parse(value);expect(valid.rows).toHaveLength(3);expect(valid.covered_products).toEqual(['tx']);expect(valid.rows.every(row=>row.buy_amount===0)).toBe(true);expect(valid.covered_products.length).toBeLessThan(PRODUCTS.length);
 });
 it('validates real calendar dates and coherent acquisition clocks in Taipei',()=>{
  const s=futuresSnapshot();for(const report_date of ['2026-02-29','2026-04-31','2026-13-01','2026-11-07','20261105',''])expect(snapshotSchema.safeParse({...s,report_date}).success).toBe(false);
  expect(snapshotSchema.safeParse({...s,report_date:'2024-02-29'}).success).toBe(true);expect(snapshotSchema.safeParse({...s,fetched_at:new Date(NOW-1).toISOString()}).success).toBe(false);expect(snapshotSchema.safeParse({...s,acquisition_started_at:'invalid'}).success).toBe(false);
  const midnight=Date.parse('2026-11-06T16:00:00Z');expect(snapshotSchema.safeParse({...s,report_date:'2026-11-07',acquisition_started_at:new Date(midnight).toISOString(),fetched_at:new Date(midnight).toISOString()}).success).toBe(true);
  expect(snapshotSchema.safeParse({...s,report_date:'2026-11-07',acquisition_started_at:new Date(midnight-1).toISOString(),fetched_at:new Date(midnight).toISOString()}).success).toBe(false);
 });
 it('counts source age in Taipei calendar days, without a guessed holiday calendar',()=>{
  const s=futuresSnapshot();expect(reportAge(s,Date.parse('2026-11-05T15:59:59.999Z'))).toBe(0);expect(reportAge(s,Date.parse('2026-11-05T16:00:00Z'))).toBe(1);expect(reportAge(s,Date.parse('2026-11-08T16:00:00Z'))).toBe(4);expect(reportAge(s,Date.parse('2026-11-09T16:00:00Z'))).toBe(5);
 });
 it('expires independently on cache/report age, with five-second future-fetch skew',()=>{
  const reply=futuresReply();expect(visibleSnapshot(reply,NOW-5000)).toEqual(reply.snapshot);expect(visibleSnapshot(reply,NOW-5001)).toBeNull();expect(visibleSnapshot(reply,NOW+MAX_CACHE_AGE_MS)).toEqual(reply.snapshot);expect(visibleSnapshot(reply,NOW+MAX_CACHE_AGE_MS+1)).toBeNull();
  const now=Date.parse('2026-11-20T03:00:00Z');expect(visibleSnapshot(withDate('2026-11-06',now),now)).toBeTruthy();expect(visibleSnapshot(withDate('2026-11-05',now),now)).toBeNull();expect(visibleSnapshot(withDate('2026-11-21',now),now)).toBeNull();expect(visibleSnapshot(reply,NaN)).toBeNull();expect(visibleSnapshot(null,NOW)).toBeNull();
 });
 it('requires status/snapshot identity and suppresses denied/unavailable evidence',()=>{
  const reply=futuresReply();for(const state of ['denied','unavailable'] as const){const invalid={...reply,status:{...reply.status,state}};expect(replySchema.safeParse(invalid).success).toBe(false);expect(visibleSnapshot(invalid,NOW)).toBeNull();expect(replySchema.safeParse({...invalid,snapshot:null}).success).toBe(true);}
  expect(replySchema.safeParse({...reply,snapshot:null}).success).toBe(false);expect(replySchema.safeParse({...reply,status:{...reply.status,fetched_at:new Date(NOW+1).toISOString()}}).success).toBe(false);
  expect(replySchema.safeParse({...reply,status:{...reply.status,refresh_ms:60000}}).success).toBe(false);expect(replySchema.safeParse({...reply,status:{...reply.status,extra:true}}).success).toBe(false);
 });
});
