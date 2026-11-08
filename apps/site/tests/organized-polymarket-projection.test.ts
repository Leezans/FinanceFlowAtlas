import {describe,expect,it} from 'vitest';
import {projectPolymarketReport,polymarketExportFilename} from '../lib/evidence/polymarket-projection';
import {MAX_CACHE_AGE_MS,visibleSnapshot,snapshotSchema} from '../lib/polymarket/model';
import {gammaReply,legacyGamma,largeGamma,NOW,ISO} from './organized-polymarket-fixture';
function nativeValue(snapshot:unknown,path:string){return path.replace(/\[(\d+)\]/g,'.$1').split('.').reduce((value,key)=>(value as Record<string,unknown>)[key],snapshot);}

describe('Polymarket Gamma organized evidence',()=>{
 it('retains every outcome, exact price string, volume, market/condition identity and native locator',()=>{
  const input=gammaReply().snapshot!,report=projectPolymarketReport(input)!;
  expect(report.native_snapshot).toEqual(input);expect(report.native_snapshot).not.toBe(input);expect(report.rows).toHaveLength(9);expect(new Set(report.rows.map(row=>row.id)).size).toBe(9);
  for(const row of report.rows){
   expect(nativeValue(report.native_snapshot,row.native_locator)).toBe(row.value);
   expect(nativeValue(report.native_snapshot,row.dimension.native_locator)).toBe(row.dimension.id);expect(nativeValue(report.native_snapshot,row.dimension.label_native_locator)).toBe(row.dimension.label);
   expect(nativeValue(report.native_snapshot,row.grouping.native_locator)).toBe(row.grouping.label);expect(nativeValue(report.native_snapshot,row.grouping.basis_native_locator)).toBe(row.grouping.basis);
   expect(nativeValue(report.native_snapshot,row.observation.record_updated_native_locator)).toBe(row.observation.source_record_updated_at);expect(nativeValue(report.native_snapshot,row.observation.observed_native_locator)).toBeNull();
   if(row.identity.condition_native_locator)expect(nativeValue(report.native_snapshot,row.identity.condition_native_locator)).toBe(row.identity.condition_id);
   expect(row.identity).toMatchObject({event_id:null,event_native_locator:null,event_identity:'not_retained'});
   if(row.outcome){expect(nativeValue(report.native_snapshot,row.outcome.name_native_locator)).toBe(row.outcome.name);expect(row.unit).toEqual({code:'probability_fraction',kind:'outcome_price',currency:null,currency_multiplier:null,value_encoding:'decimal_string',native_locator:null});}
   else expect(row.unit).toEqual({code:'source_reported',kind:'rolling_volume',currency:null,currency_multiplier:null,value_encoding:'number',native_locator:row.native_locator.replace('volume_24h','volume_unit')});
  }
  expect(report.rows[0]).toMatchObject({value:'0.123456789012',outcome:{name:'No',index:0},identity:{condition_id:`0x${'a'.repeat(64)}`,condition_state:'reported'}});
  expect(report.rows[1]).toMatchObject({value:'1.000000000000',outcome:{name:'Yes',index:1}});
  expect(report.rows.find(row=>row.native_locator==='rows[0].volume_24h')!.value).toBe(1234.56);
  expect(report.native_snapshot.rows[0].tags).toEqual(input.rows[0].tags);expect(report.native_snapshot.rows[2].accepting_orders).toBe(false);
  expect(polymarketExportFilename(report)).toBe('polymarket-gamma-hot-2026-11-05T12-00-00-000Z-organized.json');
 });
 it('never conflates null/zero, volume/probability, record updates/acquisition/window endpoints or currencies',()=>{
  const report=projectPolymarketReport(gammaReply().snapshot)!;
  expect(report.rows.filter(row=>row.state==='source_null')).toHaveLength(3);
  expect(report.rows.find(row=>row.native_locator==='rows[1].outcomes[0].price')).toMatchObject({value:'0',state:'reported'});
  expect(report.rows.find(row=>row.native_locator==='rows[1].volume_24h')).toMatchObject({value:0,state:'reported'});
  expect(report.rows.every(row=>row.unit.currency===null&&row.unit.currency_multiplier===null)).toBe(true);
  expect(report.rows.every(row=>row.observation.window_start===null&&row.observation.window_end===null&&row.observation.source_observed_at===null&&row.observation.record_update_is_price_time===false)).toBe(true);
  expect(report.rows.filter(row=>row.outcome===null).every(row=>row.observation.window==='rolling_24h'&&row.observation.duration_hours===24)).toBe(true);
  expect(report.rows.filter(row=>row.outcome!==null).every(row=>row.observation.window==='price_observation_unknown'&&row.observation.duration_hours===null)).toBe(true);
  expect(report.clocks).toMatchObject({acquisition_started_at:ISO,fetched_at:ISO,source_released_at:null,source_observed_at:null});
  expect(report.period).toMatchObject({start:null,end:null,frequency:'snapshot',calendar_timezone:null});
  expect(report).toMatchObject({net_capital_flow:null,whole_market_capital_flow:false,delay_status:'not_provided',geography:{iso3:null,underlying_domicile:null},classification:{industry:null},excluded_metrics:{open_interest:'separate_interest_view_not_projected',liquidity:'not_retained_in_gamma_snapshot'}});
  expect(Object.values(report.aggregation).filter(value=>value===false)).toHaveLength(5);expect(report.source).toMatchObject({license_url:null,raw_sha256:null});
 });
 it('preserves actual hot/newest coverage and legacy omissions without claiming event identity or upgrading old records',()=>{
  const hot=projectPolymarketReport(gammaReply().snapshot)!,newest=projectPolymarketReport(gammaReply('newest').snapshot)!,legacy=projectPolymarketReport(legacyGamma())!;
  expect(hot.coverage).toMatchObject({view:'hot',sample_limit:100,pagination:'single_page',ordering:'source_volume24hr_descending',has_more:null,stop_reason:'source_short_page'});
  expect(newest.coverage).toMatchObject({view:'newest',sample_limit:500,pagination:'keyset',ordering:'source_id_descending',has_more:false,stop_reason:'source_exhausted'});
  expect(legacy.coverage).toMatchObject({view:'newest',sample_limit:200,pagination:null,ordering:'source_volume24hr_descending',source_page_count:null,source_page_sizes:null,stop_reason:null,has_more:null,grouping:null});
  expect(Object.values(legacy.coverage.native_locators).every(value=>value===null)).toBe(true);
  for(const report of [hot,newest])for(const [key,path] of Object.entries(report.coverage.native_locators))expect(nativeValue(report.native_snapshot,path!)).toEqual(report.coverage[key as keyof typeof report.coverage]);
  expect(legacy.native_snapshot).toEqual(legacyGamma());expect(legacy.native_snapshot).not.toHaveProperty('pagination');expect(legacy.rows.every(row=>row.identity.condition_state==='not_retained'&&row.identity.condition_native_locator===null)).toBe(true);
  expect(hot.rows.filter(row=>row.dimension.id==='1').every(row=>row.identity.condition_state==='retained_null')).toBe(true);
  expect(hot.presentation).toMatchObject({search_and_group_filters_applied:false,row_selection:'all_retained_markets_and_outcomes_in_current_gamma_mode'});
 });
 it('rejects private/unknown nested fields, duplicate identities, malformed prices, negative volumes and fabricated event or liquidity fields',()=>{
  const input=gammaReply().snapshot!;
  for(const patch of [{private_token:'synthetic'},{event_id:'event'},{liquidity:1},{fetched_at:new Date(NOW-1).toISOString()},...[
   {wallet:'synthetic'},{event_id:'synthetic'},{liquidity:1},{condition_id:'invalid'},{id:'not numeric'},{volume_24h:-1},{volume_unit:'USD'},{volume_24h:Infinity},{source_record_updated_at:new Date(NOW+60001).toISOString()},
   {tags:[{slug:'tag',label:'Tag',private_token:'synthetic'}]},{outcomes:[{name:'Yes',price:'0.5',private_token:'synthetic'},{name:'No',price:'0.5'}]},
   {outcomes:[{name:'Yes',price:0.5},{name:'No',price:'0.5'}]},{outcomes:[{name:'Yes',price:'1.000000000001'},{name:'No',price:'0'}]},
   {outcomes:[{name:'Yes',price:'0.5'},{name:'yes',price:'0.5'}]},
  ].map(row=>({rows:[{...input.rows[0],...row},...input.rows.slice(1)]})),{rows:[input.rows[0],input.rows[0],input.rows[2]]}])expect(()=>projectPolymarketReport({...input,...patch})).toThrow();
  expect(()=>projectPolymarketReport(gammaReply())).toThrow();expect(()=>projectPolymarketReport({schema:'polymarket-open-interest/2',discovery:input})).toThrow();expect(projectPolymarketReport(null)).toBeNull();
 });
 it('keeps inclusive existing visibility limits and records declared stale state without extending freshness',()=>{
  const reply=gammaReply();expect(projectPolymarketReport(visibleSnapshot(reply,NOW+MAX_CACHE_AGE_MS))).not.toBeNull();expect(projectPolymarketReport(visibleSnapshot(reply,NOW+MAX_CACHE_AGE_MS+1))).toBeNull();expect(projectPolymarketReport(visibleSnapshot(reply,NOW-1))).toBeNull();
  for(const state of ['denied','unavailable'] as const)expect(projectPolymarketReport(visibleSnapshot({...reply,status:{...reply.status,state}},NOW))).toBeNull();
  const before=projectPolymarketReport(reply.snapshot)!,stale=projectPolymarketReport(reply.snapshot,true)!;expect(stale.presentation.stale).toBe(true);expect(stale.native_snapshot).toEqual(before.native_snapshot);expect(stale.clocks).toEqual(before.clocks);
 });
 it('exports the actual 500-market/16-outcome maximum as 8500 fields with unique exact identities and bounded coverage',()=>{
  const input=largeGamma(),report=projectPolymarketReport(input)!;
  expect(snapshotSchema.safeParse(input).success).toBe(true);expect(report.rows).toHaveLength(8500);expect(new Set(report.rows.map(row=>row.id)).size).toBe(8500);
  expect(report.coverage).toMatchObject({retained_market_count:500,source_page_count:5,source_page_sizes:[100,100,100,100,100],stop_reason:'page_limit',has_more:true,complete_universe:false,total_market_count:null});
  expect(report.rows.at(-1)).toMatchObject({dimension:{id:'1'},native_locator:'rows[499].volume_24h'});
  expect(report.rows.every(row=>nativeValue(report.native_snapshot,row.native_locator)===row.value)).toBe(true);
 });
});
