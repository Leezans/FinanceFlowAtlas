import {describe,expect,it} from 'vitest';
import {DERIBIT_FIELDS_PER_INSTRUMENT,projectDeribitReport} from '../lib/evidence/deribit-projection';
import {MAX_CACHE_AGE_MS,MAX_ROWS,METADATA_MAX_AGE_MS,replySchema,snapshotSchema,visibleSnapshot} from '../lib/options/model';
import {at,iso,optionsReply,combinedOptionsReply,singleCurrencyOptionsReply} from './deribit-fixture';
import {expiringOptionsReply,legacyOptionsReply,organizedOptions} from './organized-deribit-fixture';
function nativeValue(snapshot:unknown,path:string){return path.replace(/\[(\d+)\]/g,'.$1').split('.').reduce((value,key)=>(value as Record<string,unknown>)[key],snapshot);}

describe('Deribit visible evidence projection',()=>{
 it('retains exact numeric, identity, metadata and row-clock locators without currency conversion',()=>{
  const reply=combinedOptionsReply(),report=organizedOptions(reply)!;
  expect(report.rows).toHaveLength(reply.snapshot!.rows.length*DERIBIT_FIELDS_PER_INSTRUMENT);expect(new Set(report.rows.map(row=>row.id)).size).toBe(report.rows.length);
  expect(report.native_snapshot).toEqual({...reply.snapshot,schema:'deribit-options-visible/1',source_schema:'deribit-options/2'});expect(report.native_snapshot.rows).not.toBe(reply.snapshot!.rows);
  for(const row of report.rows){
   expect(nativeValue(report.native_snapshot,row.native_locator)).toBe(row.value);
   expect(nativeValue(report.native_snapshot,row.dimension.native_locator)).toBe(row.dimension.id);
   for(const [field,locator] of [['underlying_currency','underlying_native_locator'],['expiration_timestamp','expiration_native_locator'],['strike','strike_native_locator'],['option_type','type_native_locator'],['contract_size','size_native_locator']] as const)expect(nativeValue(report.native_snapshot,row.instrument[locator])).toBe(row.instrument[field]);
   expect(nativeValue(report.native_snapshot,row.observation.native_locator)).toBe(row.observation.creation_timestamp);
   const coin=row.instrument.underlying_currency;
   if(row.metric_id==='deribit-options.volume_usd')expect(row.unit).toEqual({code:'USD',kind:'traded_amount',currency:'USD',denominator:null,currency_multiplier:1});
   else if(['deribit-options.volume','deribit-options.open_interest'].includes(row.metric_id))expect(row.unit).toEqual({code:coin,kind:'underlying_quantity',currency:coin,denominator:null,currency_multiplier:null});
   else expect(row.unit).toEqual({code:`${coin} / ${coin}`,kind:'option_quote',currency:coin,denominator:coin,currency_multiplier:null});
   expect(row.instrument.contract_size_unit).toBe(coin);expect(row.instrument.strike_unit).toBe('USD');
  }
  expect(report.unit).toEqual({code:'per_row',currency:null,currency_multiplier:null});
  expect(report.period).toEqual({start:null,end:null,frequency:'snapshot',calendar_timezone:null,date_semantics:'source_snapshot_with_rolling_24h_statistics'});
  expect(report.clocks).toMatchObject({source_as_of:iso,source_released_at:null,acquisition_started_at:iso,fetched_at:iso,metadata_fetched_at:{BTC:iso,ETH:iso}});
  expect(report.rows.every(row=>row.observation.window_start===null&&row.observation.window_end===null&&row.observation.delay_policy==='source_delay_unconfirmed')).toBe(true);
  expect(report.rows.find(row=>row.metric_id==='deribit-options.last')!.observation.window).toBe('last_trade_time_unknown');
 });
 it('separates native null quote fields from reported zero, without invented net flow, totals or price changes',()=>{
  const reply=combinedOptionsReply();Object.assign(reply.snapshot!.rows[0],{bid_price:null,ask_price:0,last:null,volume:0,volume_usd:0,open_interest:0});
  const report=organizedOptions(reply)!,rows=report.rows.filter(row=>row.dimension.id===reply.snapshot!.rows[0].instrument);
  for(const field of ['bid_price','last'])expect(rows.find(row=>row.metric_id===`deribit-options.${field}`)).toMatchObject({value:null,state:'source_null'});
  for(const field of ['ask_price','volume','volume_usd','open_interest'])expect(rows.find(row=>row.metric_id===`deribit-options.${field}`)).toMatchObject({value:0,state:'reported'});
  expect(new Set(report.rows.map(row=>row.metric_id))).toEqual(new Set(['volume','volume_usd','open_interest','mark_price','bid_price','ask_price','last'].map(field=>`deribit-options.${field}`)));
  expect(report).toMatchObject({net_capital_flow:null,whole_market_capital_flow:false,geography:{iso3:null,role:'exchange_venue',underlying_domicile:null},classification:{industry:null},delay_policy:'source_delay_unconfirmed'});
  expect(report.aggregation).toMatchObject({cross_source_allowed:false,cross_currency_allowed:false,cross_instrument_allowed:false});
  expect(report.source).toMatchObject({license_url:null,raw_sha256:null});expect(report.source.attribution).toContain('Personal-use');
 });
 it('keeps original source scope and earliest clock when that currency has no unexpired rows',()=>{
  const reply=expiringOptionsReply(),validated=replySchema.parse(reply),view=visibleSnapshot(validated,at+2000)!;
  expect(snapshotSchema.safeParse(view).success).toBe(false); // A view is intentionally not a new full acquisition.
  const report=organizedOptions(reply,at+2000)!;
  expect(report.coverage).toEqual({source_scope:'deribit_btc_eth_options',source_currencies:['BTC','ETH'],source_instrument_count:6,visible_currencies:['ETH'],visible_instrument_count:3,global_coverage:false});
  expect(report.clocks.source_as_of).toBe(iso);expect(report.clocks.metadata_fetched_at).toEqual(reply.snapshot!.metadata_fetched_at);
  expect(report.native_snapshot.rows).toEqual(view.rows);expect(report.native_snapshot.rows.every(row=>row.creation_timestamp===at+1000)).toBe(true);
  expect(report.rows.every(row=>row.instrument.underlying_currency==='ETH')).toBe(true);expect(report.rows[0].native_locator).toBe('rows[0].volume');
  expect(report.native_retention.expired_rows_included).toBe(false);
 });
 it('preserves active BTC-only or ETH-only source coverage without manufacturing the other chain',()=>{
  for(const currency of ['BTC','ETH'] as const){const report=organizedOptions(singleCurrencyOptionsReply(currency))!;expect(report.coverage.source_currencies).toEqual([currency]);expect(report.coverage.visible_currencies).toEqual([currency]);expect(report.native_snapshot.rows.every(row=>row.underlying_currency===currency)).toBe(true);}
 });
 it('records actual wire legacy normalization without claiming every BTC-only schema-2 input was legacy',()=>{
  const legacy=legacyOptionsReply(),report=organizedOptions(legacy)!;
  expect(report.normalization).toMatchObject({input_schema:'deribit-btc-options/1',normalized_schema:'deribit-options/2',legacy_btc_normalized:true,native_payload:'normalized_visible_view'});
  expect(report.coverage.source_currencies).toEqual(['BTC']);expect(report.clocks.source_as_of).toBe(legacy.snapshot.source_as_of);expect(report.clocks.metadata_fetched_at).toEqual({BTC:iso});
  expect(report.native_snapshot.rows.every(row=>row.underlying_currency==='BTC')).toBe(true);
  expect(organizedOptions(optionsReply())!.normalization).toMatchObject({input_schema:'deribit-options/2',legacy_btc_normalized:false});
  const unknown=projectDeribitReport(optionsReply().snapshot)!;expect(unknown.normalization.input_schema).toBeNull();expect(unknown.normalization.legacy_btc_normalized).toBeNull();expect(unknown.coverage.source_instrument_count).toBeNull();
 });
 it('rejects unknown/private fields, mismatched identities and invalid clock/numeric/scope/provenance inputs',()=>{
  const input=combinedOptionsReply().snapshot!;
  for(const patch of [{private_token:'synthetic'},{currencies:['ETH','BTC']},{coverage:'deribit_btc_options'},{metadata_fetched_at:{BTC:iso,ETH:iso,private_token:'synthetic'}},{fetched_at:new Date(at-1000).toISOString()},{source_as_of:new Date(at-31000).toISOString()},...[
   {private_token:'synthetic'},{underlying_currency:'ETH'},{volume:null},{volume:-1},{volume:0,volume_usd:1},{creation_timestamp:at+5001},{bid_price:Infinity},{instrument:'BTC-bad-C'},
  ].map(row=>({rows:[{...input.rows[0],...row},...input.rows.slice(1)]})),{rows:[input.rows[0],...input.rows]}])expect(()=>projectDeribitReport({...input,...patch})).toThrow();
  expect(()=>projectDeribitReport(input,false,{input_schema:'deribit-btc-options/1',source_instrument_count:6})).toThrow();
  expect(()=>projectDeribitReport(input,false,{input_schema:'deribit-options/2',source_instrument_count:1})).toThrow();
  expect(projectDeribitReport(null)).toBeNull();
 });
 it('uses existing inclusive cache/source age, expiry and denial policy; metadata age is validated at acquisition only',()=>{
  const reply=combinedOptionsReply();reply.snapshot!.metadata_fetched_at={BTC:new Date(at-METADATA_MAX_AGE_MS).toISOString(),ETH:iso};
  expect(organizedOptions(reply,at+MAX_CACHE_AGE_MS)).not.toBeNull();expect(organizedOptions(reply,at+MAX_CACHE_AGE_MS+1)).toBeNull();
  expect(organizedOptions(reply,at-5001)).toBeNull();
  const source=optionsReply();source.snapshot!.source_as_of=new Date(at-30000).toISOString();source.snapshot!.rows.forEach(row=>{row.creation_timestamp=at-30000;});
  expect(organizedOptions(source,at+MAX_CACHE_AGE_MS-30000)).not.toBeNull();expect(organizedOptions(source,at+MAX_CACHE_AGE_MS-30000+1)).toBeNull();
  for(const state of ['denied','unavailable'] as const)expect(projectDeribitReport(visibleSnapshot({...reply,status:{...reply.status,state}},at))).toBeNull();
  const expired=optionsReply();expired.snapshot!.rows.forEach(row=>{row.expiration_timestamp=at+1;});expect(organizedOptions(expired,at+1)).toBeNull();
 });
 it('bounds the complete projection at 4000 active instruments and 28000 selected fields',()=>{
  const reply=combinedOptionsReply(),snapshot=reply.snapshot!;
  snapshot.rows=snapshot.currencies.flatMap(currency=>Array.from({length:MAX_ROWS},(_,index)=>({...snapshot.rows.find(row=>row.underlying_currency===currency)!,instrument:`${currency}-27NOV26-${index+1}-C`,strike:index+1,option_type:'call' as const})));
  const report=organizedOptions(reply)!;expect(report.native_snapshot.rows).toHaveLength(4000);expect(report.rows).toHaveLength(28000);
 });
});
