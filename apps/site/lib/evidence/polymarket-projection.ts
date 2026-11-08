/** Gamma organization only: no acquisition, event inference, OI join or price conversion. */
import {z} from 'zod';
import {legacySnapshotSchema,keysetSnapshotSchema,hotSnapshotSchema,SOURCE_DOCS,HOT_SOURCE_DOCS,SOURCE_TERMS,snapshotView} from '@/lib/polymarket/model';

const gammaSchema=z.union([keysetSnapshotSchema,legacySnapshotSchema,hotSnapshotSchema]);
export type PolymarketGammaSnapshot=z.infer<typeof gammaSchema>;
export type OrganizedPolymarketRow={
 id:string;
 dimension:{namespace:'Polymarket.Gamma.market_id';kind:'prediction_market';id:string;label:string;native_locator:string;label_native_locator:string};
 identity:{condition_id:string|null;condition_state:'reported'|'retained_null'|'not_retained';condition_native_locator:string|null;event_id:null;event_native_locator:null;event_identity:'not_retained'};
 grouping:{label:string;basis:'source_category'|'source_tag'|'unclassified';native_locator:string;basis_native_locator:string;official_primary_taxonomy:false};
 outcome:{index:number;name:string;name_native_locator:string}|null;
 role:'market_measure';metric_id:'polymarket-gamma.outcome_price'|'polymarket-gamma.volume_24h';metric_label:string;
 value:string|number|null;state:'reported'|'source_null';native_locator:string;value_origin:'retained_adapter_field';
 unit:{code:'probability_fraction'|'source_reported';kind:'outcome_price'|'rolling_volume';currency:null;currency_multiplier:null;value_encoding:'decimal_string'|'number';native_locator:string|null};
 observation:{window:'price_observation_unknown'|'rolling_24h';duration_hours:24|null;window_start:null;window_end:null;source_observed_at:null;observed_native_locator:string;source_record_updated_at:string|null;record_updated_native_locator:string;record_update_is_price_time:false};
};
export type OrganizedPolymarketReport={
 schema:'organized-market-report/1';source_id:'polymarket-gamma';native_schema:PolymarketGammaSnapshot['schema'];native_snapshot:PolymarketGammaSnapshot;
 source:{name:'Polymarket Gamma';urls:readonly string[];license_url:null;terms_url:string;attribution:string;raw_sha256:null};
 geography:{iso3:null;role:'prediction_market_venue';underlying_domicile:null};
 period:{start:null;end:null;frequency:'snapshot';calendar_timezone:null;date_semantics:'outcome_prices_and_source_rolling_24h_volume'};
 unit:{code:'per_row';currency:null;currency_multiplier:null};
 clocks:{source_released_at:null;source_observed_at:null;acquisition_started_at:string;fetched_at:string;note:string};
 measure_scope:'bounded_gamma_outcome_prices_and_24h_volume';whole_market_capital_flow:false;net_capital_flow:null;delay_status:'not_provided';
 coverage:{view:'hot'|'newest';source_scope:'bounded_active_market_sample';sample_limit:100|200|500;source_market_count:number;retained_market_count:number;excluded_market_count:number;ordering:PolymarketGammaSnapshot['ordering'];complete_universe:false;total_market_count:null;pagination:'keyset'|'single_page'|null;source_page_count:number|null;source_page_sizes:number[]|null;stop_reason:'source_exhausted'|'page_limit'|'time_budget'|'sample_limit'|'source_short_page'|null;has_more:boolean|null;grouping:'source_category_else_smallest_tag_slug'|null;native_locators:{total_market_count:'total_market_count'|null;pagination:'pagination'|null;source_page_count:'source_page_count'|null;source_page_sizes:'source_page_sizes'|null;stop_reason:'stop_reason'|null;has_more:'has_more'|null;grouping:'grouping'|null}};
 normalization:{input_schema:PolymarketGammaSnapshot['schema'];native_payload:'validated_visible_snapshot';transformed:false;note:string};
 classification:{industry:null;instrument:{namespace:'Polymarket.Gamma.market_id'};country_assignment:null};
 excluded_metrics:{open_interest:'separate_interest_view_not_projected';liquidity:'not_retained_in_gamma_snapshot';net_capital_flow:'not_a_source_measure'};
 presentation:{stale:boolean;basis:'current_visible_page_snapshot';row_selection:'all_retained_markets_and_outcomes_in_current_gamma_mode';search_and_group_filters_applied:false};
 aggregation:{cross_source_allowed:false;cross_market_allowed:false;cross_outcome_allowed:false;cross_metric_allowed:false;cross_window_allowed:false;rule:string};
 native_retention:{schema_validation:'existing_strict_gamma_snapshot_schemas';unknown_fields:'rejected';raw_provider_payload:false;other_modes_included:false};
 rows:OrganizedPolymarketRow[];
};

/** Accept only the current permitted Gamma snapshot, never a reply/cache or OI discovery. */
export function projectPolymarketReport(input:unknown|null,stale=false):OrganizedPolymarketReport|null {
 if(input===null)return null;
 const snapshot=gammaSchema.parse(input),modern=snapshot.schema!=='polymarket-gamma/1';
 const rows:OrganizedPolymarketRow[]=snapshot.rows.flatMap((market,index)=>{
  const base=`rows[${index}]`;
  const common={
   dimension:{namespace:'Polymarket.Gamma.market_id' as const,kind:'prediction_market' as const,id:market.id,label:market.question,native_locator:`${base}.id`,label_native_locator:`${base}.question`},
   identity:{condition_id:market.condition_id??null,condition_state:market.condition_id===undefined?'not_retained' as const:market.condition_id===null?'retained_null' as const:'reported' as const,condition_native_locator:market.condition_id===undefined?null:`${base}.condition_id`,event_id:null,event_native_locator:null,event_identity:'not_retained' as const},
   grouping:{label:market.category,basis:market.category_basis,native_locator:`${base}.category`,basis_native_locator:`${base}.category_basis`,official_primary_taxonomy:false as const},
   role:'market_measure' as const,value_origin:'retained_adapter_field' as const,
  };
  const observation={window_start:null,window_end:null,source_observed_at:market.source_observed_at,observed_native_locator:`${base}.source_observed_at`,source_record_updated_at:market.source_record_updated_at,record_updated_native_locator:`${base}.source_record_updated_at`,record_update_is_price_time:false as const};
  const prices:OrganizedPolymarketRow[]=market.outcomes.map((outcome,outcomeIndex)=>({
   ...common,id:`polymarket-gamma:${market.id}:outcome_price:${outcomeIndex}`,outcome:{index:outcomeIndex,name:outcome.name,name_native_locator:`${base}.outcomes[${outcomeIndex}].name`},metric_id:'polymarket-gamma.outcome_price',metric_label:'结果价格隐含概率（原始小数字符串）',value:outcome.price,state:outcome.price===null?'source_null':'reported',native_locator:`${base}.outcomes[${outcomeIndex}].price`,
   unit:{code:'probability_fraction',kind:'outcome_price',currency:null,currency_multiplier:null,value_encoding:'decimal_string',native_locator:null},
   observation:{...observation,window:'price_observation_unknown',duration_hours:null},
  }));
  return [...prices,{
   ...common,id:`polymarket-gamma:${market.id}:volume_24h`,outcome:null,metric_id:'polymarket-gamma.volume_24h',metric_label:'平台报告的 24 小时成交量',value:market.volume_24h,state:market.volume_24h===null?'source_null':'reported',native_locator:`${base}.volume_24h`,
   unit:{code:market.volume_unit,kind:'rolling_volume',currency:null,currency_multiplier:null,value_encoding:'number',native_locator:`${base}.volume_unit`},
   observation:{...observation,window:'rolling_24h',duration_hours:24},
  }];
 });
 return {
  schema:'organized-market-report/1',source_id:'polymarket-gamma',native_schema:snapshot.schema,native_snapshot:snapshot,
  source:{name:'Polymarket Gamma',urls:[snapshot.schema==='polymarket-gamma/2'?SOURCE_DOCS:HOT_SOURCE_DOCS],license_url:null,terms_url:SOURCE_TERMS,attribution:'Source: Polymarket Gamma. Personal-use evidence only; no redistribution license, endorsement or current source availability is asserted.',raw_sha256:null},
  geography:{iso3:null,role:'prediction_market_venue',underlying_domicile:null},
  period:{start:null,end:null,frequency:'snapshot',calendar_timezone:null,date_semantics:'outcome_prices_and_source_rolling_24h_volume'},unit:{code:'per_row',currency:null,currency_multiplier:null},
  clocks:{source_released_at:null,source_observed_at:null,acquisition_started_at:snapshot.acquisition_started_at,fetched_at:snapshot.fetched_at,note:'Acquisition clocks are not price observations or 24h volume endpoints. Per-market source_record_updated_at is a record update, not a price timestamp. Source publication time, observation time and publication delay remain unknown.'},
  measure_scope:'bounded_gamma_outcome_prices_and_24h_volume',whole_market_capital_flow:false,net_capital_flow:null,delay_status:'not_provided',
  coverage:{view:snapshotView(snapshot) as 'hot'|'newest',source_scope:snapshot.coverage,sample_limit:snapshot.sample_limit,source_market_count:snapshot.source_market_count,retained_market_count:snapshot.rows.length,excluded_market_count:snapshot.excluded_market_count,ordering:snapshot.ordering,complete_universe:false,total_market_count:null,pagination:modern?snapshot.pagination:null,source_page_count:modern?snapshot.source_page_count:null,source_page_sizes:modern?snapshot.source_page_sizes:null,stop_reason:modern?snapshot.stop_reason:null,has_more:modern?snapshot.has_more:null,grouping:modern?snapshot.grouping:null,native_locators:{total_market_count:modern?'total_market_count':null,pagination:modern?'pagination':null,source_page_count:modern?'source_page_count':null,source_page_sizes:modern?'source_page_sizes':null,stop_reason:modern?'stop_reason':null,has_more:modern?'has_more':null,grouping:modern?'grouping':null}},
  normalization:{input_schema:snapshot.schema,native_payload:'validated_visible_snapshot',transformed:false,note:'No acquisition or native schema upgrade. Retain optional condition_id omissions and legacy missing pagination/grouping fields. A retained null condition may reflect an absent, invalid or unsupported source ID; its original cause is not known. Export all retained markets in the currently visible Gamma mode, independent of local search, category drilldown and selected heatmap metric; no other mode or OI discovery is joined.'},
  classification:{industry:null,instrument:{namespace:'Polymarket.Gamma.market_id'},country_assignment:null},
  excluded_metrics:{open_interest:'separate_interest_view_not_projected',liquidity:'not_retained_in_gamma_snapshot',net_capital_flow:'not_a_source_measure'},
  presentation:{stale,basis:'current_visible_page_snapshot',row_selection:'all_retained_markets_and_outcomes_in_current_gamma_mode',search_and_group_filters_applied:false},
  aggregation:{cross_source_allowed:false,cross_market_allowed:false,cross_outcome_allowed:false,cross_metric_allowed:false,cross_window_allowed:false,rule:'Outcome prices are retained 0–1 decimal strings, not objective probabilities, percentages or currency. Retain every outcome name and index, not just Yes or the first displayed outcome. 24h volume is a separate source_reported number with unverified currency and unknown window endpoints, not event volume, liquidity, OI or net capital flow. Do not sum or average outcomes, markets, categories, metrics, overlapping windows or sources. Market, condition and event identities are not interchangeable; no event identity or country is inferred from question, category or tags. Null differs from reported zero. A short page or missing continuation does not establish full-universe coverage.'},
  native_retention:{schema_validation:'existing_strict_gamma_snapshot_schemas',unknown_fields:'rejected',raw_provider_payload:false,other_modes_included:false},rows,
 };
}
export function polymarketExportFilename(report:OrganizedPolymarketReport){return `polymarket-gamma-${report.coverage.view}-${report.clocks.fetched_at.replace(/[:.]/g,'-')}-organized.json`;}
