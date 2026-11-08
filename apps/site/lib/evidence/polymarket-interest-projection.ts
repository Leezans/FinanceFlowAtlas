/** OI evidence only. The frozen Gamma cohort is provenance, not synchronized prices. */
import {interestSnapshotSchema,INTEREST_SOURCE_DOCS,HOT_SOURCE_DOCS,SOURCE_TERMS,INTEREST_REFRESH_MS,INTEREST_MAX_CACHE_AGE_MS,type PolymarketInterestSnapshot} from '@/lib/polymarket/model';

export type OrganizedPolymarketInterestBatch={
 index:number;kind:'retained_batch'|'legacy_single_request';native_locator:string|null;
 condition_ids:string[];returned_condition_ids:string[];
 requested_at:string;fetched_at:string;requested_native_locator:string;fetched_native_locator:string;
 condition_native_locators:string[];returned_condition_native_locators:string[];
};
export type OrganizedPolymarketInterestRow={
 id:string;
 dimension:{namespace:'Polymarket.Gamma.market_id';kind:'prediction_market';id:string;label:string;native_locator:string;label_native_locator:string};
 identity:{condition_namespace:'Polymarket.condition_id';condition_id:string;condition_native_locator:string;returned_condition_native_locator:string|null;event_id:null;event_native_locator:null;event_identity:'not_retained'};
 grouping:{label:string;basis:'source_category'|'source_tag'|'unclassified';native_locator:string;basis_native_locator:string;official_primary_taxonomy:false};
 cohort:{discovery_market_native_locator:string;discovery_condition_native_locator:string;discovery_record_updated_at:string|null;record_updated_native_locator:string;record_update_is_oi_time:false};
 role:'open_interest_measure';metric_id:'polymarket-open-interest.priced_gross_open_interest';metric_label:string;metric_native_locator:'metric';
 value:number|null;state:'reported'|'source_condition_not_returned';native_locator:string|null;source_values_native_locator:'values';value_origin:'retained_adapter_field'|'condition_absent_from_retained_values';
 unit:{code:'USDC';currency:'USDC';currency_multiplier:1;kind:'priced_gross_open_interest';value_encoding:'number';native_locator:'currency';fiat_conversion:false};
 observation:{window:'valuation_time_unknown';source_observed_at:null;observed_native_locator:'source_observed_at';window_start:null;window_end:null;batch_index:number;requested_at:string;fetched_at:string;requested_native_locator:string;fetched_native_locator:string;atomic_valuation:false};
};
export type OrganizedPolymarketInterestReport={
 schema:'organized-market-report/1';source_id:'polymarket-open-interest';native_schema:PolymarketInterestSnapshot['schema'];native_snapshot:PolymarketInterestSnapshot;
 source:{name:'Polymarket Data API v2';urls:readonly string[];license_url:null;terms_url:string;attribution:string;raw_sha256:null};
 geography:{iso3:null;role:'prediction_market_venue';underlying_domicile:null};
 period:{start:null;end:null;frequency:'snapshot';calendar_timezone:null;date_semantics:'source_valuation_time_unknown'};
 unit:{code:'USDC';currency:'USDC';currency_multiplier:1};
 clocks:{source_released_at:null;source_observed_at:null;acquisition_started_at:string;fetched_at:string;discovery_acquisition_started_at:string;discovery_fetched_at:string;oi_request_started_at:string;native_locators:{acquisition_started_at:'acquisition_started_at';fetched_at:'fetched_at';discovery_acquisition_started_at:'discovery.acquisition_started_at';discovery_fetched_at:'discovery.fetched_at';oi_request_started_at:'oi_request_started_at';source_observed_at:'source_observed_at'};note:string};
 retention:{age_basis:'oldest_oi_request'|'legacy_response_received';age_anchor:string;native_locator:'oi_request_started_at'|'fetched_at';stale_after_ms:number;hide_after_ms:number;source_valuation_age_known:false};
 measure_scope:'bounded_hot_market_priced_gross_open_interest';whole_market_capital_flow:false;net_capital_flow:null;delay_status:'not_provided';
 coverage:{view:'interest';source_scope:'bounded_hot_market_open_interest';sample_limit:20|40;selection:'first_distinct_standard_conditions_in_hot_window';selected_market_count:number;returned_condition_count:number;missing_condition_count:number;batch_count:number;batch_size:20|null;complete_universe:false;total_market_count:null;oi_ranked:false;discovery:{native_locator:'discovery';sample_limit:100;source_market_count:number;retained_market_count:number;excluded_market_count:number;conditioned_market_count:number;missing_or_unsupported_condition_count:number;distinct_condition_count:number;duplicate_condition_count:number;not_selected_due_to_limit:number;ordering:'source_volume24hr_descending';pagination:'single_page';source_page_count:1;source_page_sizes:[number];stop_reason:'sample_limit'|'source_short_page';has_more:null};native_locators:{sample_limit:'sample_limit';selection:'selection';batch_size:'batch_size'|null;selected_markets:'rows';returned_values:'values';total_market_count:'total_market_count'}};
 batches:OrganizedPolymarketInterestBatch[];
 normalization:{input_schema:PolymarketInterestSnapshot['schema'];native_payload:'validated_visible_snapshot';transformed:false;note:string};
 classification:{industry:null;instrument:{namespace:'Polymarket.Gamma.market_id'};country_assignment:null};
 excluded_metrics:{outcome_prices:'discovery_provenance_only';volume_24h:'discovery_selection_provenance_only';net_capital_flow:'not_a_source_measure'};
 presentation:{stale:boolean;basis:'current_visible_page_snapshot';row_selection:'all_selected_conditions_in_current_interest_snapshot';search_and_group_filters_applied:false};
 aggregation:{cross_source_allowed:false;cross_market_allowed:false;cross_batch_allowed:false;cross_metric_allowed:false;rule:string};
 native_retention:{schema_validation:'existing_strict_interest_snapshot_schemas';unknown_fields:'rejected';raw_provider_payload:false;discovery_is_provenance_only:true;other_mode_snapshots_included:false};
 rows:OrganizedPolymarketInterestRow[];
};

/** The caller must pass the currently permitted OI snapshot, never a reply/cache. */
export function projectPolymarketInterestReport(input:unknown|null,stale=false):OrganizedPolymarketInterestReport|null{
 if(input===null)return null;
 const snapshot=interestSnapshotSchema.parse(input),modern=snapshot.schema==='polymarket-open-interest/2';
 const batches:OrganizedPolymarketInterestBatch[]=modern?snapshot.batches.map((batch,index)=>({
  index,kind:'retained_batch',native_locator:`batches[${index}]`,condition_ids:batch.condition_ids,returned_condition_ids:batch.returned_condition_ids,
  requested_at:batch.requested_at,fetched_at:batch.fetched_at,requested_native_locator:`batches[${index}].requested_at`,fetched_native_locator:`batches[${index}].fetched_at`,
  condition_native_locators:batch.condition_ids.map((_,i)=>`batches[${index}].condition_ids[${i}]`),returned_condition_native_locators:batch.returned_condition_ids.map((_,i)=>`batches[${index}].returned_condition_ids[${i}]`),
 })):[{
  index:0,kind:'legacy_single_request',native_locator:null,condition_ids:snapshot.rows.map(row=>row.condition_id!),returned_condition_ids:snapshot.values.map(value=>value.condition_id),
  requested_at:snapshot.oi_request_started_at,fetched_at:snapshot.fetched_at,requested_native_locator:'oi_request_started_at',fetched_native_locator:'fetched_at',
  condition_native_locators:snapshot.rows.map((_,i)=>`rows[${i}].condition_id`),returned_condition_native_locators:snapshot.values.map((_,i)=>`values[${i}].condition_id`),
 }];
 const rows:OrganizedPolymarketInterestRow[]=snapshot.rows.map((market,index)=>{
  const base=`rows[${index}]`,condition=market.condition_id!,valueIndex=snapshot.values.findIndex(value=>value.condition_id===condition),value=valueIndex<0?null:snapshot.values[valueIndex].value;
  const discoveryIndex=snapshot.discovery.rows.findIndex(row=>row.id===market.id),discoveryBase=`discovery.rows[${discoveryIndex}]`;
  const batch=batches.find(batch=>batch.condition_ids.includes(condition))!;
  return {
   id:`polymarket-open-interest:${condition}:priced_gross_open_interest`,
   dimension:{namespace:'Polymarket.Gamma.market_id',kind:'prediction_market',id:market.id,label:market.question,native_locator:`${base}.id`,label_native_locator:`${base}.question`},
   identity:{condition_namespace:'Polymarket.condition_id',condition_id:condition,condition_native_locator:`${base}.condition_id`,returned_condition_native_locator:valueIndex<0?null:`values[${valueIndex}].condition_id`,event_id:null,event_native_locator:null,event_identity:'not_retained'},
   grouping:{label:market.category,basis:market.category_basis,native_locator:`${base}.category`,basis_native_locator:`${base}.category_basis`,official_primary_taxonomy:false},
   cohort:{discovery_market_native_locator:`${discoveryBase}.id`,discovery_condition_native_locator:`${discoveryBase}.condition_id`,discovery_record_updated_at:market.source_record_updated_at,record_updated_native_locator:`${discoveryBase}.source_record_updated_at`,record_update_is_oi_time:false},
   role:'open_interest_measure',metric_id:'polymarket-open-interest.priced_gross_open_interest',metric_label:'按价格计值的总未平仓持仓金额',metric_native_locator:'metric',value,state:valueIndex<0?'source_condition_not_returned':'reported',native_locator:valueIndex<0?null:`values[${valueIndex}].value`,source_values_native_locator:'values',value_origin:valueIndex<0?'condition_absent_from_retained_values':'retained_adapter_field',
   unit:{code:snapshot.currency,currency:snapshot.currency,currency_multiplier:1,kind:snapshot.metric,value_encoding:'number',native_locator:'currency',fiat_conversion:false},
   observation:{window:'valuation_time_unknown',source_observed_at:null,observed_native_locator:'source_observed_at',window_start:null,window_end:null,batch_index:batch.index,requested_at:batch.requested_at,fetched_at:batch.fetched_at,requested_native_locator:batch.requested_native_locator,fetched_native_locator:batch.fetched_native_locator,atomic_valuation:false},
  };
 });
 const discovery=snapshot.discovery,conditioned=discovery.rows.filter(row=>row.condition_id),distinct=new Set(conditioned.map(row=>row.condition_id)).size;
 return {
  schema:'organized-market-report/1',source_id:'polymarket-open-interest',native_schema:snapshot.schema,native_snapshot:snapshot,
  source:{name:snapshot.source,urls:[INTEREST_SOURCE_DOCS,HOT_SOURCE_DOCS],license_url:null,terms_url:SOURCE_TERMS,attribution:'Source: Polymarket Data API v2; Gamma discovery retained only as cohort provenance. Personal-use evidence only; no redistribution license, endorsement or current source availability is asserted.',raw_sha256:null},
  geography:{iso3:null,role:'prediction_market_venue',underlying_domicile:null},period:{start:null,end:null,frequency:'snapshot',calendar_timezone:null,date_semantics:'source_valuation_time_unknown'},unit:{code:snapshot.currency,currency:snapshot.currency,currency_multiplier:1},
  clocks:{source_released_at:null,source_observed_at:null,acquisition_started_at:snapshot.acquisition_started_at,fetched_at:snapshot.fetched_at,discovery_acquisition_started_at:discovery.acquisition_started_at,discovery_fetched_at:discovery.fetched_at,oi_request_started_at:snapshot.oi_request_started_at,native_locators:{acquisition_started_at:'acquisition_started_at',fetched_at:'fetched_at',discovery_acquisition_started_at:'discovery.acquisition_started_at',discovery_fetched_at:'discovery.fetched_at',oi_request_started_at:'oi_request_started_at',source_observed_at:'source_observed_at'},note:'Discovery selects a frozen hot cohort. Gamma acquisition, each OI request/receipt and Gamma record updates are distinct clocks, not source valuation times. Neither the cohort nor separate OI batches nor even conditions within one batch establish an atomic valuation. Source publication time and delay remain unknown.'},
  retention:{age_basis:modern?'oldest_oi_request':'legacy_response_received',age_anchor:modern?snapshot.oi_request_started_at:snapshot.fetched_at,native_locator:modern?'oi_request_started_at':'fetched_at',stale_after_ms:INTEREST_REFRESH_MS,hide_after_ms:INTEREST_MAX_CACHE_AGE_MS,source_valuation_age_known:false},
  measure_scope:'bounded_hot_market_priced_gross_open_interest',whole_market_capital_flow:false,net_capital_flow:null,delay_status:'not_provided',
  coverage:{view:'interest',source_scope:snapshot.coverage,sample_limit:snapshot.sample_limit,selection:snapshot.selection,selected_market_count:snapshot.rows.length,returned_condition_count:snapshot.values.length,missing_condition_count:snapshot.rows.length-snapshot.values.length,batch_count:batches.length,batch_size:modern?snapshot.batch_size:null,complete_universe:false,total_market_count:null,oi_ranked:false,discovery:{native_locator:'discovery',sample_limit:discovery.sample_limit,source_market_count:discovery.source_market_count,retained_market_count:discovery.rows.length,excluded_market_count:discovery.excluded_market_count,conditioned_market_count:conditioned.length,missing_or_unsupported_condition_count:discovery.rows.length-conditioned.length,distinct_condition_count:distinct,duplicate_condition_count:conditioned.length-distinct,not_selected_due_to_limit:distinct-snapshot.rows.length,ordering:discovery.ordering,pagination:discovery.pagination,source_page_count:discovery.source_page_count,source_page_sizes:discovery.source_page_sizes,stop_reason:discovery.stop_reason,has_more:discovery.has_more},native_locators:{sample_limit:'sample_limit',selection:'selection',batch_size:modern?'batch_size':null,selected_markets:'rows',returned_values:'values',total_market_count:'total_market_count'}},batches,
  normalization:{input_schema:snapshot.schema,native_payload:'validated_visible_snapshot',transformed:false,note:'Only OI values are projected; preserve the validated native snapshot without adding fields or upgrading legacy scope. Match returned values to selected markets by the exact standard condition ID, not array position or question labels. A selected condition absent from values has a projected null and no invented value locator. Native Gamma prices/volume and all discovery rows remain provenance only, not a synchronous price/OI join or another mode snapshot.'},
  classification:{industry:null,instrument:{namespace:'Polymarket.Gamma.market_id'},country_assignment:null},
  excluded_metrics:{outcome_prices:'discovery_provenance_only',volume_24h:'discovery_selection_provenance_only',net_capital_flow:'not_a_source_measure'},
  presentation:{stale,basis:'current_visible_page_snapshot',row_selection:'all_selected_conditions_in_current_interest_snapshot',search_and_group_filters_applied:false},
  aggregation:{cross_source_allowed:false,cross_market_allowed:false,cross_batch_allowed:false,cross_metric_allowed:false,rule:'Priced gross open interest is a stock valuation in USDC, not fiat USD, collateral net deposits, trade volume or net capital flow. No sums, averages, currency conversion or cross-source reconciliation. Only returned zero is zero; absent conditions remain unknown. Gamma market ID, condition ID and event ID are distinct; no event ID, country or industry is inferred. The first eligible distinct conditions in a bounded Gamma hot window are neither a full universe nor a source OI ranking.'},
  native_retention:{schema_validation:'existing_strict_interest_snapshot_schemas',unknown_fields:'rejected',raw_provider_payload:false,discovery_is_provenance_only:true,other_mode_snapshots_included:false},rows,
 };
}
export function polymarketInterestExportFilename(report:OrganizedPolymarketInterestReport){return `polymarket-open-interest-${report.clocks.fetched_at.replace(/[:.]/g,'-')}-organized.json`;}
