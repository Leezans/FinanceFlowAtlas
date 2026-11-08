import {describe,expect,it,vi} from 'vitest';
import {projectPolymarketInterestReport,polymarketInterestExportFilename} from '../lib/evidence/polymarket-interest-projection';
import {projectPolymarketReport} from '../lib/evidence/polymarket-projection';
import {parseHotPolymarket} from '../lib/polymarket/adapter';
import {interestSnapshotSchema,visibleSnapshot,snapshotCacheTime,INTEREST_MAX_CACHE_AGE_MS} from '../lib/polymarket/model';
import {market} from './polymarket-fixture';
import {organizedInterest,interestDiscovery,interestReply,condition,iso,NOW,ISO} from './organized-polymarket-interest-fixture';
function nativeValue(snapshot:unknown,path:string){return path.replace(/\[(\d+)\]/g,'.$1').split('.').reduce((value,key)=>(value as Record<string,unknown>)[key],snapshot);}

describe('separate Polymarket OI organized projection',()=>{
 it.each(['legacy','batched'] as const)('preserves %s values by condition identity, exact existing paths, unit and unmodified native payload',kind=>{
  const input=organizedInterest(kind),before=structuredClone(input),report=projectPolymarketInterestReport(input)!;
  expect(report.native_snapshot).toEqual(before);expect(report.native_snapshot).not.toBe(input);expect(input).toEqual(before);
  expect(report.source_id).toBe('polymarket-open-interest');expect(report.rows).toHaveLength(kind==='legacy'?20:40);expect(new Set(report.rows.map(row=>row.id)).size).toBe(report.rows.length);
  for(const row of report.rows){
   expect(nativeValue(input,row.dimension.native_locator)).toBe(row.dimension.id);expect(nativeValue(input,row.dimension.label_native_locator)).toBe(row.dimension.label);
   expect(nativeValue(input,row.identity.condition_native_locator)).toBe(row.identity.condition_id);expect(nativeValue(input,row.cohort.discovery_condition_native_locator)).toBe(row.identity.condition_id);expect(nativeValue(input,row.cohort.discovery_market_native_locator)).toBe(row.dimension.id);
   expect(nativeValue(input,row.grouping.native_locator)).toBe(row.grouping.label);expect(nativeValue(input,row.grouping.basis_native_locator)).toBe(row.grouping.basis);expect(nativeValue(input,row.cohort.record_updated_native_locator)).toBe(row.cohort.discovery_record_updated_at);
   expect(nativeValue(input,row.metric_native_locator)).toBe('priced_gross_open_interest');expect(nativeValue(input,row.unit.native_locator)).toBe('USDC');expect(row.unit).toMatchObject({currency:'USDC',currency_multiplier:1,value_encoding:'number',fiat_conversion:false});
   expect(row.identity).toMatchObject({event_id:null,event_native_locator:null,event_identity:'not_retained'});
   expect(nativeValue(input,row.observation.requested_native_locator)).toBe(row.observation.requested_at);expect(nativeValue(input,row.observation.fetched_native_locator)).toBe(row.observation.fetched_at);expect(nativeValue(input,row.observation.observed_native_locator)).toBeNull();
   expect(nativeValue(input,row.source_values_native_locator)).toEqual(input.values);
   if(row.native_locator){expect(nativeValue(input,row.native_locator)).toBe(row.value);expect(nativeValue(input,row.identity.returned_condition_native_locator!)).toBe(row.identity.condition_id);}
   else {expect(row.value).toBeNull();expect(row.state).toBe('source_condition_not_returned');expect(row.identity.returned_condition_native_locator).toBeNull();expect(input.values.some(value=>value.condition_id===row.identity.condition_id)).toBe(false);}
  }
  expect(report.rows[0]).toMatchObject({value:0.125,native_locator:'values[18].value'});expect(report.rows[19]).toMatchObject({value:0,state:'reported',native_locator:'values[0].value'});expect(report.rows[9]).toMatchObject({value:null,native_locator:null});
  if(kind==='batched'){expect(report.rows[20]).toMatchObject({value:20.125,native_locator:'values[37].value',observation:{batch_index:1}});expect(report.rows[29]).toMatchObject({value:null,native_locator:null,observation:{batch_index:1}});}
  expect(polymarketInterestExportFilename(report)).toBe('polymarket-open-interest-2026-11-05T12-00-00-000Z-organized.json');
  for(const batch of report.batches){
   expect(nativeValue(input,batch.requested_native_locator)).toBe(batch.requested_at);expect(nativeValue(input,batch.fetched_native_locator)).toBe(batch.fetched_at);
   expect(batch.condition_native_locators.map(path=>nativeValue(input,path))).toEqual(batch.condition_ids);expect(batch.returned_condition_native_locators.map(path=>nativeValue(input,path))).toEqual(batch.returned_condition_ids);
  }
 });
 it('keeps legacy single-request metadata separate from retained batched metadata and leaves all valuation times unknown',()=>{
  const legacy=projectPolymarketInterestReport(organizedInterest('legacy'))!,batched=projectPolymarketInterestReport(organizedInterest())!;
  expect(legacy.coverage).toMatchObject({sample_limit:20,selected_market_count:20,returned_condition_count:19,missing_condition_count:1,batch_count:1,batch_size:null,discovery:{not_selected_due_to_limit:25}});
  expect(legacy.batches[0]).toMatchObject({kind:'legacy_single_request',native_locator:null,requested_native_locator:'oi_request_started_at',fetched_native_locator:'fetched_at'});expect(legacy.native_snapshot).not.toHaveProperty('batches');expect(legacy.native_snapshot).not.toHaveProperty('batch_size');
  expect(batched.coverage).toMatchObject({sample_limit:40,selected_market_count:40,returned_condition_count:38,missing_condition_count:2,batch_count:2,batch_size:20,discovery:{not_selected_due_to_limit:5}});expect(batched.batches.map(batch=>batch.native_locator)).toEqual(['batches[0]','batches[1]']);
  expect(batched.retention).toMatchObject({age_basis:'oldest_oi_request',age_anchor:iso(NOW-6000),native_locator:'oi_request_started_at',stale_after_ms:300000,hide_after_ms:600000});expect(legacy.retention).toMatchObject({age_basis:'legacy_response_received',age_anchor:ISO,native_locator:'fetched_at'});
  for(const report of [legacy,batched]){
   for(const [key,path] of Object.entries(report.clocks.native_locators))expect(nativeValue(report.native_snapshot,path)).toBe(report.clocks[key as keyof typeof report.clocks]);
   expect(report.clocks).toMatchObject({acquisition_started_at:iso(NOW-8000),discovery_fetched_at:iso(NOW-7000),oi_request_started_at:iso(NOW-6000),fetched_at:ISO,source_observed_at:null,source_released_at:null});
   expect(report.rows.every(row=>row.observation.source_observed_at===null&&row.observation.window_start===null&&row.observation.window_end===null&&row.observation.atomic_valuation===false&&row.cohort.record_update_is_oi_time===false)).toBe(true);
   expect(report).toMatchObject({net_capital_flow:null,whole_market_capital_flow:false,delay_status:'not_provided',geography:{iso3:null,underlying_domicile:null},classification:{industry:null},period:{start:null,end:null}});
  }
 });
 it('discloses source limits, exclusions, duplicate/missing conditions and all selected rows without OI reranking',()=>{
  const raw:Record<string,unknown>[]=Array.from({length:100},(_,index)=>market(String(100-index),{conditionId:condition(100-index),volume24hr:100-index}));
  raw[0]={...raw[0],active:false};raw[1]={...raw[1],conditionId:undefined};raw[2]={...raw[2],conditionId:'unsupported'};raw[4]={...raw[4],conditionId:raw[3].conditionId};
  const discovery=parseHotPolymarket(raw,iso(NOW-8000),iso(NOW-7000)),report=projectPolymarketInterestReport(organizedInterest('batched',NOW,discovery))!;
  expect(report.coverage).toMatchObject({complete_universe:false,total_market_count:null,oi_ranked:false,selection:'first_distinct_standard_conditions_in_hot_window',discovery:{sample_limit:100,source_market_count:100,excluded_market_count:1,retained_market_count:99,conditioned_market_count:97,missing_or_unsupported_condition_count:2,distinct_condition_count:96,duplicate_condition_count:1,not_selected_due_to_limit:56,ordering:'source_volume24hr_descending',pagination:'single_page',source_page_count:1,source_page_sizes:[100],stop_reason:'sample_limit',has_more:null}});
  expect(report.rows[0].dimension.id).toBe('97');expect(report.rows[0].cohort.discovery_market_native_locator).toBe('discovery.rows[2].id');expect(report.rows.at(-1)!.dimension.id).toBe('57');expect(report.presentation.search_and_group_filters_applied).toBe(false);
 });
 it('keeps every selected condition even when all returned values are absent, including a small one-batch /2',()=>{
  const snapshot=organizedInterest('batched',NOW,interestDiscovery(4));if(snapshot.schema!=='polymarket-open-interest/2')throw new Error('fixture');
  const report=projectPolymarketInterestReport({...snapshot,values:[],batches:snapshot.batches.map(batch=>({...batch,returned_condition_ids:[]}))})!;
  expect(report.coverage).toMatchObject({sample_limit:40,selected_market_count:4,returned_condition_count:0,missing_condition_count:4,batch_count:1,batch_size:20});expect(report.rows).toHaveLength(4);expect(report.rows.every(row=>row.value===null&&row.native_locator===null&&row.state==='source_condition_not_returned')).toBe(true);
 });
 it('keeps discovery prices/volume as native provenance only, never joined unified metrics or inferred events',()=>{
  const input=organizedInterest(),report=projectPolymarketInterestReport(input)!;
  expect(report.native_snapshot.discovery).toEqual(input.discovery);expect(report.native_snapshot.rows[0].outcomes).toEqual(input.rows[0].outcomes);expect(report.rows.every(row=>row.metric_id==='polymarket-open-interest.priced_gross_open_interest')).toBe(true);
  expect(report.excluded_metrics).toEqual({outcome_prices:'discovery_provenance_only',volume_24h:'discovery_selection_provenance_only',net_capital_flow:'not_a_source_measure'});expect(report.native_retention).toMatchObject({discovery_is_provenance_only:true,other_mode_snapshots_included:false});
  expect(()=>projectPolymarketReport(input)).toThrow();expect(()=>projectPolymarketInterestReport(input.discovery)).toThrow();expect(()=>projectPolymarketInterestReport(interestReply(input))).toThrow();expect(projectPolymarketInterestReport(null)).toBeNull();
 });
 it('rejects private/unknown nested fields and malformed native contracts without broadening existing validation',()=>{
  const input=organizedInterest();if(input.schema!=='polymarket-open-interest/2')throw new Error('fixture');
  const mutations=[{private_token:'synthetic'},{event_id:'fabricated'},{currency:'USD'},{metric:'net_flow'},{sample_limit:500},{values:[...input.values,input.values[0]]},{values:[{...input.values[0],value:-1},...input.values.slice(1)]},{values:[{...input.values[0],wallet:'synthetic'},...input.values.slice(1)]},{rows:[{...input.rows[0],account_id:'synthetic'},...input.rows.slice(1)]},{discovery:{...input.discovery,credential:'synthetic'}},{discovery:{...input.discovery,rows:input.discovery.rows.map((row,index)=>index===0?{...row,outcomes:[{...row.outcomes[0],private_key:'synthetic'},row.outcomes[1]]}:row)}},{batches:[{...input.batches[0],private_token:'synthetic'},...input.batches.slice(1)]},{batches:[{...input.batches[0],returned_condition_ids:[condition(999)]},...input.batches.slice(1)]},{batches:[{...input.batches[0],requested_at:iso(NOW-9000)},...input.batches.slice(1)]}];
  for(const mutation of mutations){expect(interestSnapshotSchema.safeParse({...input,...mutation}).success).toBe(false);expect(()=>projectPolymarketInterestReport({...input,...mutation})).toThrow();}
 });
 it.each(['legacy','batched'] as const)('respects original %s visibility and stale metadata without renewing clocks or fetching',kind=>{
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  try{
   const input=organizedInterest(kind),reply=interestReply(input),anchor=snapshotCacheTime(input);
   expect(projectPolymarketInterestReport(visibleSnapshot(reply,anchor+INTEREST_MAX_CACHE_AGE_MS))).not.toBeNull();expect(projectPolymarketInterestReport(visibleSnapshot(reply,anchor+INTEREST_MAX_CACHE_AGE_MS+1))).toBeNull();expect(projectPolymarketInterestReport(visibleSnapshot(reply,NOW-1))).toBeNull();
   for(const state of ['denied','unavailable'] as const)expect(projectPolymarketInterestReport(visibleSnapshot({...reply,status:{...reply.status,state}},NOW))).toBeNull();
   const before=projectPolymarketInterestReport(input)!,stale=projectPolymarketInterestReport(input,true)!;expect(stale.presentation.stale).toBe(true);expect(stale.native_snapshot).toEqual(before.native_snapshot);expect(stale.clocks).toEqual(before.clocks);expect(stale.retention).toEqual(before.retention);expect(fetcher).not.toHaveBeenCalled();
  }finally{vi.unstubAllGlobals();}
 });
 it('does not impose discovery expiry on a permitted legacy snapshot',()=>{
  const discovery=interestDiscovery(45,NOW-900_000),input=organizedInterest('legacy',NOW,discovery),report=projectPolymarketInterestReport(visibleSnapshot(interestReply(input),NOW))!;
  expect(report).not.toBeNull();expect(report.clocks.discovery_fetched_at).toBe(iso(NOW-907_000));expect(report.retention.age_anchor).toBe(ISO);expect(report.native_snapshot.discovery).toEqual(discovery);
 });
});
