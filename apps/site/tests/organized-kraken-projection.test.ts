import {describe,expect,it} from 'vitest';
import {KRAKEN_TRADE_FIELDS_PER_PAIR,projectKrakenTradeReport,krakenTradeExportFilename} from '../lib/evidence/kraken-trade-projection';
import {tradeSnapshotSchema} from '../lib/crypto/trade-validation';
import {validateKrakenReply} from '../lib/crypto/validation';
import {visibleSnapshot} from '../components/crypto/client';
import {visibleTradeSnapshot} from '../components/crypto/trade-matrix';
import {MAX_CACHE_AGE_MS} from '../lib/crypto/kraken';
import {at,iso,krakenTradeReply,legacyTrades,variedTrades} from './organized-kraken-fixture';
function nativeValue(snapshot:unknown,path:string){return path.replace(/\[(\d+)\]/g,'.$1').split('.').reduce((value,key)=>(value as Record<string,unknown>)[key],snapshot);}
const view=(input:unknown,now=at)=>{const reply=validateKrakenReply(input);return visibleTradeSnapshot(reply.trade_snapshot,!!visibleSnapshot(reply,now),now);};
describe('Kraken exact trade-direction organization',()=>{
 it('retains every original metric, pair identity, window, execution/fetch clock and response-count locator',()=>{
  const snapshot=krakenTradeReply({fetched:at+2000}).trade_snapshot!;snapshot.rows[0].fetched_at=iso;
  const before=structuredClone(snapshot),report=projectKrakenTradeReport(snapshot)!;
  expect(report.native_snapshot).toEqual(snapshot);expect(report.native_snapshot).not.toBe(snapshot);expect(snapshot).toEqual(before);
  expect(report.rows).toHaveLength(3*KRAKEN_TRADE_FIELDS_PER_PAIR);expect(new Set(report.rows.map(row=>row.id)).size).toBe(12);
  for(const row of report.rows){
   expect(nativeValue(report.native_snapshot,row.native_locator)).toBe(row.value);
   expect(nativeValue(report.native_snapshot,row.dimension.native_locator)).toBe(row.dimension.id);
   for(const [field,locator] of [['name','name_native_locator'],['base','base_native_locator'],['quote','quote_native_locator']] as const)expect(nativeValue(report.native_snapshot,row.pair[locator])).toBe(row.pair[field]);
   for(const [field,locator] of [['window_start','start_native_locator'],['window_end','end_native_locator'],['window_ms','duration_native_locator'],['first_trade_at','first_native_locator'],['last_trade_at','last_native_locator'],['fetched_at','fetched_native_locator']] as const)expect(nativeValue(report.native_snapshot,row.observation[locator])).toBe(row.observation[field]);
   expect(nativeValue(report.native_snapshot,row.response.coverage_native_locator)).toBe(row.response.coverage);
   for(const field of ['returned_count','trade_count','excluded_after_window_count','page_count','last_page_count','cursor'] as const)expect(nativeValue(report.native_snapshot,row.response.native_locators[field]!)).toBe(row.response[field]);
   if(row.metric_id==='kraken-trades.imbalance_pct'){expect(row.value).toBe(100);expect(row.unit).toEqual({code:'percent',kind:'marked_amount_ratio',currency:null,currency_multiplier:null,value_encoding:'number'});}
   else {expect(typeof row.value).toBe('string');expect(row.unit.code).toBe('USD');expect(row.unit.currency).toBe('USD');expect(row.unit.value_encoding).toBe('decimal_string');}
  }
  expect(report.rows[0].value).toBe('0.000000000010000000000001');
  expect(report.clocks).toMatchObject({fetched_at:new Date(at+2000).toISOString(),acquisition_started_at:null,source_released_at:null,source_observed_at:null,window_end_role:'acquisition_anchor_in_validated_reply'});
  expect(report.rows[0].observation.fetched_at).toBe(iso);expect(report.period).toEqual({start:new Date(at-300000).toISOString(),end:iso,frequency:'fixed_window',calendar_timezone:'UTC',window_ms:300000,start_inclusive:true,end_exclusive:true});
  expect(krakenTradeExportFilename(report)).toBe('kraken-trades-5m-2026-11-05T03-00-00-000Z-organized.json');
 });
 it('keeps null coverage, empty zero strings and a native truncated zero ratio distinct without float coercion',()=>{
  const report=projectKrakenTradeReport(variedTrades())!,rows=(pair:string)=>report.rows.filter(row=>row.pair.name===pair);
  expect(rows('BTC/USD').slice(0,3).every(row=>row.value==='0'&&row.state==='reported')).toBe(true);
  expect(rows('BTC/USD')[3]).toMatchObject({value:null,state:'no_trades_in_window'});
  expect(rows('ETH/USD').every(row=>row.value===null&&row.state==='coverage_unavailable')).toBe(true);
  expect(rows('SOL/USD')[0].value).toBe('9007199254740993.000000000000000000000001');
  expect(rows('SOL/USD')[2].value).toBe('0.000000000000000000000001');expect(rows('SOL/USD')[3]).toMatchObject({value:0,state:'reported',value_origin:'adapter_truncated_ratio_of_marked_amounts'});
  const roundtrip=JSON.parse(JSON.stringify(report));expect(roundtrip.rows).toEqual(report.rows);
 });
 it('preserves legacy omissions rather than normalizing native selection or pagination into invented source fields',()=>{
  const snapshot=legacyTrades(),report=projectKrakenTradeReport(snapshot)!;
  expect(report.native_schema).toBe('kraken-trades/1');expect(report.native_snapshot).toEqual(snapshot);expect(report.normalization.transformed).toBe(false);
  expect(report.coverage).toMatchObject({selected_pairs:['BTC/USD','ETH/USD','SOL/USD'],selection_origin:'schema_1_default_pairs',page_limit:null});
  expect(report.native_snapshot).not.toHaveProperty('selected_pairs');expect(report.native_snapshot).not.toHaveProperty('page_limit');
  for(const row of report.rows){expect(row.response.page_count).toBeNull();expect(row.response.last_page_count).toBeNull();expect(row.response.native_locators.page_count).toBeNull();expect(row.response.native_locators.last_page_count).toBeNull();}
 });
 it('keeps actual schema-2 selected pairs and one-minute scope, and never fills missing pairs with metadata or zeros',()=>{
  const reply=krakenTradeReply({selected:['ADA/USD','XRP/USD'],timeframe:'1m',missing:['XRP/USD']}),report=projectKrakenTradeReport(view(reply))!;
  expect(report.native_schema).toBe('kraken-trades/2');expect(report.coverage).toMatchObject({selected_pairs:['ADA/USD','XRP/USD'],selection_origin:'native_selected_pairs',present_pair_count:1,missing_pairs:['XRP/USD']});
  expect(report.period.window_ms).toBe(60000);expect(report.rows).toHaveLength(4);expect(report.rows.every(row=>row.pair.name==='ADA/USD')).toBe(true);
  expect(nativeValue(report.native_snapshot,report.coverage.missing_pairs_native_locator)).toEqual(['XRP/USD']);
  const empty=krakenTradeReply({selected:['XRP/USD'],missing:['XRP/USD']});expect(projectKrakenTradeReport(view(empty))!.rows).toEqual([]);
 });
 it('states counterparties, scope and no aggregation without inventing flow, industry, domicile, license or totals',()=>{
  const report=projectKrakenTradeReport(variedTrades(),true)!;
  expect(report).toMatchObject({net_capital_flow:null,whole_market_capital_flow:false,delay_status:'not_provided',geography:{iso3:null,underlying_domicile:null},classification:{industry:null},semantics:{both_counterparties_per_trade:true,rest_bs_aggressor_semantics:'unconfirmed',not_net_capital_inflow:true},presentation:{stale:true}});
  expect(report.aggregation).toMatchObject({cross_source_allowed:false,cross_currency_allowed:false,cross_pair_allowed:false,cross_window_allowed:false,cross_metric_allowed:false});
  expect(report.source).toMatchObject({license_url:null,raw_sha256:null});expect(report.coverage.full_window_completeness).toBe('not_verified');
  expect(report.rows.every(row=>row.role==='trade_direction_measure')).toBe(true);expect(new Set(report.rows.map(row=>row.metric_id)).size).toBe(4);
 });
 it('uses the existing strict schema and rejects private extras, malformed identities, counts, numbers, clocks and wider scope',()=>{
  const snapshot=krakenTradeReply().trade_snapshot!;
  for(const patch of [{private_token:'synthetic'},{window_ms:60000},{page_limit:3},{selected_pairs:['BTC/USD']},{schema:'kraken-trades/2'},{fetched_at:new Date(at-1).toISOString()},...[
   {private_token:'synthetic'},{quote:'EUR'},{base:'OTHER'},{buy_notional_usd:1},{buy_notional_usd:'1e-20'},{buy_notional_usd:'1'},{imbalance_pct:Infinity},{returned_count:2},{page_count:3},{last_page_count:1000},{first_trade_at:iso},{fetched_at:new Date(at-1).toISOString()},
  ].map(row=>({rows:[{...snapshot.rows[0],...row},...snapshot.rows.slice(1)]}))]){
   const input={...snapshot,...patch};expect(()=>tradeSnapshotSchema.parse(input)).toThrow();expect(()=>projectKrakenTradeReport(input)).toThrow();
  }
  const four={...snapshot,schema:'kraken-trades/2',selected_pairs:['ADA/USD','BTC/USD','ETH/USD','SOL/USD']};expect(()=>projectKrakenTradeReport(four)).toThrow();
  expect(projectKrakenTradeReport(null)).toBeNull();
 });
 it('inherits independent row/final fetch ages, quote visibility, future and permission bounds without exporting hidden evidence',()=>{
  const reply=krakenTradeReply();expect(projectKrakenTradeReport(view(reply,at+MAX_CACHE_AGE_MS))).not.toBeNull();expect(projectKrakenTradeReport(view(reply,at+MAX_CACHE_AGE_MS+1))).toBeNull();expect(view(reply,at-1)).toBeNull();
  const delayed=krakenTradeReply({fetched:at+2000});delayed.trade_snapshot!.rows[0].fetched_at=iso;
  expect(view(delayed,at+MAX_CACHE_AGE_MS)).not.toBeNull();expect(view(delayed,at+MAX_CACHE_AGE_MS+1)).toBeNull();
  for(const state of ['denied','unavailable'] as const)expect(projectKrakenTradeReport(view({...reply,snapshot:null,trade_snapshot:null,status:{...reply.status,state}}))).toBeNull();
  expect(visibleTradeSnapshot(reply.trade_snapshot,false,at)).toBeNull();
 });
});
