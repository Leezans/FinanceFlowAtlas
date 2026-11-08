/** Read-only organization of the exact validated, age/permission-filtered trade view. */
import {tradeSnapshotSchema} from '@/lib/crypto/trade-validation';
import {KRAKEN_TRADES_DOCS,TRADE_PAIRS,type KrakenTradeSnapshot} from '@/lib/crypto/trades';
import type {EvidenceRow} from './types';

const fields=[
 {id:'buy_notional_usd',label:'来源买标记成交额',origin:'adapter_sum_of_returned_buy_marked_trades'},
 {id:'sell_notional_usd',label:'来源卖标记成交额',origin:'adapter_sum_of_returned_sell_marked_trades'},
 {id:'imbalance_usd',label:'买标记成交额 − 卖标记成交额',origin:'adapter_difference_of_marked_amounts'},
 {id:'imbalance_pct',label:'来源买卖标记成交额差比',origin:'adapter_truncated_ratio_of_marked_amounts'},
] as const;
export const KRAKEN_TRADE_FIELDS_PER_PAIR=fields.length;
/** Specialize values instead of widening the older numeric report contracts. */
export type OrganizedKrakenTradeRow=Omit<EvidenceRow,'dimension'|'role'|'value'|'state'>&{
 dimension:{namespace:'Kraken.source_pair';kind:'trading_pair';id:string;label:string;native_locator:string};
 pair:{name:string;base:string;quote:'USD';name_native_locator:string;base_native_locator:string;quote_native_locator:string};
 role:'trade_direction_measure';value:string|number|null;state:'reported'|'coverage_unavailable'|'no_trades_in_window';
 unit:{code:'USD'|'percent';kind:'traded_amount'|'marked_amount_difference'|'marked_amount_ratio';currency:'USD'|null;currency_multiplier:1|null;value_encoding:'decimal_string'|'number'};
 observation:{window_start:string;window_end:string;start_inclusive:true;end_exclusive:true;window_ms:60000|300000;start_native_locator:'window_started_at';end_native_locator:'window_ended_at';duration_native_locator:'window_ms';first_trade_at:string|null;last_trade_at:string|null;fetched_at:string;first_native_locator:string;last_native_locator:string;fetched_native_locator:string};
 response:{coverage:'uncapped_response'|'capped_response';coverage_native_locator:string;returned_count:number;trade_count:number;excluded_after_window_count:number;page_count:number|null;last_page_count:number|null;cursor:string;native_locators:{returned_count:string;trade_count:string;excluded_after_window_count:string;page_count:string|null;last_page_count:string|null;cursor:string}};
 native_locator:string;value_origin:typeof fields[number]['origin'];
};
export type OrganizedKrakenTradeReport={
 schema:'organized-market-report/1';source_id:'kraken-trades';native_schema:KrakenTradeSnapshot['schema'];native_snapshot:KrakenTradeSnapshot;
 source:{name:'Kraken';urls:readonly string[];license_url:null;terms_url:string;attribution:string;raw_sha256:null};
 geography:{iso3:null;role:'exchange_venue';underlying_domicile:null};
 period:{start:string;end:string;frequency:'fixed_window';calendar_timezone:'UTC';start_inclusive:true;end_exclusive:true;window_ms:60000|300000};
 unit:{code:'per_row';currency:null;currency_multiplier:null};
 clocks:{source_released_at:null;source_observed_at:null;acquisition_started_at:null;fetched_at:string;window_end_role:'acquisition_anchor_in_validated_reply';note:string};
 measure_scope:'single_exchange_returned_trade_buy_sell_marked_amounts';whole_market_capital_flow:false;net_capital_flow:null;delay_status:'not_provided';
 coverage:{source_scope:'selected_usd_pairs_one_venue';selected_pairs:string[];selection_origin:'native_selected_pairs'|'schema_1_default_pairs';present_pair_count:number;missing_pairs:string[];missing_pairs_native_locator:'missing_pairs';trade_limit:1000;page_limit:2|null;global_coverage:false;full_window_completeness:'not_verified'};
 normalization:{input_schema:KrakenTradeSnapshot['schema'];native_payload:'validated_visible_snapshot';transformed:false;legacy_pagination_defaults:'absent_page_count_means_one_and_last_page_count_means_returned_count';note:string};
 classification:{industry:null;instrument:{namespace:'Kraken.source_pair'};underlying:{country_assignment:null}};
 semantics:{both_counterparties_per_trade:true;rest_bs_aggressor_semantics:'unconfirmed';not_net_capital_inflow:true};
 presentation:{stale:boolean;basis:'current_visible_page_snapshot';row_selection:'all_current_selected_pairs_and_four_native_fields'};
 aggregation:{cross_source_allowed:false;cross_currency_allowed:false;cross_pair_allowed:false;cross_window_allowed:false;cross_metric_allowed:false;rule:string};
 native_retention:{schema_validation:'existing_strict_trade_snapshot_schema';unknown_fields:'rejected';raw_provider_payload:false;hidden_rows_included:false};
 rows:OrganizedKrakenTradeRow[];
};

/** Does not acquire, grant permission, normalize legacy records or extend visibility. */
export function projectKrakenTradeReport(input:unknown|null,stale=false):OrganizedKrakenTradeReport|null {
 if(input===null)return null;
 const snapshot=tradeSnapshotSchema.parse(input);
 const rows:OrganizedKrakenTradeRow[]=snapshot.rows.flatMap((trade,index)=>fields.map(field=>{
  const base=`rows[${index}]`,value=trade[field.id],ratio=field.id==='imbalance_pct';
  return {
   id:`kraken-trades:${trade.source_pair}:${snapshot.window_started_at}:${snapshot.window_ended_at}:${field.id}`,
   dimension:{namespace:'Kraken.source_pair',kind:'trading_pair',id:trade.source_pair,label:trade.pair,native_locator:`${base}.source_pair`},
   pair:{name:trade.pair,base:trade.base,quote:trade.quote,name_native_locator:`${base}.pair`,base_native_locator:`${base}.base`,quote_native_locator:`${base}.quote`},
   role:'trade_direction_measure',metric_id:`kraken-trades.${field.id}`,metric_label:field.label,value,state:trade.coverage==='capped_response'?'coverage_unavailable':value===null?'no_trades_in_window':'reported',native_locator:`${base}.${field.id}`,value_origin:field.origin,
   unit:{code:ratio?'percent':'USD',kind:ratio?'marked_amount_ratio':field.id==='imbalance_usd'?'marked_amount_difference':'traded_amount',currency:ratio?null:'USD',currency_multiplier:ratio?null:1,value_encoding:ratio?'number':'decimal_string'},
   observation:{window_start:snapshot.window_started_at,window_end:snapshot.window_ended_at,start_inclusive:true,end_exclusive:true,window_ms:snapshot.window_ms,start_native_locator:'window_started_at',end_native_locator:'window_ended_at',duration_native_locator:'window_ms',first_trade_at:trade.first_trade_at,last_trade_at:trade.last_trade_at,fetched_at:trade.fetched_at,first_native_locator:`${base}.first_trade_at`,last_native_locator:`${base}.last_trade_at`,fetched_native_locator:`${base}.fetched_at`},
   response:{coverage:trade.coverage,coverage_native_locator:`${base}.coverage`,returned_count:trade.returned_count,trade_count:trade.trade_count,excluded_after_window_count:trade.excluded_after_window_count,page_count:trade.page_count??null,last_page_count:trade.last_page_count??null,cursor:trade.cursor,native_locators:{returned_count:`${base}.returned_count`,trade_count:`${base}.trade_count`,excluded_after_window_count:`${base}.excluded_after_window_count`,page_count:trade.page_count===undefined?null:`${base}.page_count`,last_page_count:trade.last_page_count===undefined?null:`${base}.last_page_count`,cursor:`${base}.cursor`}},
  };
 }));
 return {
  schema:'organized-market-report/1',source_id:'kraken-trades',native_schema:snapshot.schema,native_snapshot:snapshot,
  source:{name:'Kraken',urls:[KRAKEN_TRADES_DOCS],license_url:null,terms_url:'https://docs-legacy.kraken.com/api/docs/guides/global-intro/',attribution:'Source: Kraken. Personal-use evidence only; no redistribution license or exchange endorsement is asserted.',raw_sha256:null},
  geography:{iso3:null,role:'exchange_venue',underlying_domicile:null},
  period:{start:snapshot.window_started_at,end:snapshot.window_ended_at,frequency:'fixed_window',calendar_timezone:'UTC',start_inclusive:true,end_exclusive:true,window_ms:snapshot.window_ms},unit:{code:'per_row',currency:null,currency_multiplier:null},
  clocks:{source_released_at:null,source_observed_at:null,acquisition_started_at:null,fetched_at:snapshot.fetched_at,window_end_role:'acquisition_anchor_in_validated_reply',note:'The trade snapshot has no separate acquisition_started_at field. The existing full-reply validator ties window_ended_at to the accompanying quote acquisition_started_at. The fixed window, row execution times, row fetches and final fetch remain distinct; no publication clock is inferred.'},
  measure_scope:'single_exchange_returned_trade_buy_sell_marked_amounts',whole_market_capital_flow:false,net_capital_flow:null,delay_status:'not_provided',
  coverage:{source_scope:snapshot.coverage,selected_pairs:[...(snapshot.selected_pairs??TRADE_PAIRS)],selection_origin:snapshot.selected_pairs?'native_selected_pairs':'schema_1_default_pairs',present_pair_count:snapshot.rows.length,missing_pairs:snapshot.missing_pairs,missing_pairs_native_locator:'missing_pairs',trade_limit:snapshot.trade_limit,page_limit:snapshot.page_limit??null,global_coverage:false,full_window_completeness:'not_verified'},
  normalization:{input_schema:snapshot.schema,native_payload:'validated_visible_snapshot',transformed:false,legacy_pagination_defaults:'absent_page_count_means_one_and_last_page_count_means_returned_count',note:'The existing reader performs no schema or row transformation. Native optional selection and pagination omissions are preserved; schema-1 selection defaults are labeled separately. Missing catalog pairs have no retained source-pair/base/quote record and receive no invented metric rows.'},
  classification:{industry:null,instrument:{namespace:'Kraken.source_pair'},underlying:{country_assignment:null}},
  semantics:{both_counterparties_per_trade:true,rest_bs_aggressor_semantics:'unconfirmed',not_net_capital_inflow:true},
  presentation:{stale,basis:'current_visible_page_snapshot',row_selection:'all_current_selected_pairs_and_four_native_fields'},
  aggregation:{cross_source_allowed:false,cross_currency_allowed:false,cross_pair_allowed:false,cross_window_allowed:false,cross_metric_allowed:false,rule:'Every execution has both a buyer and a seller. REST b/s marks do not establish taker-side semantics here. Amounts are the existing adapter sums of returned in-window buy/sell-marked trades; difference and truncated percentage are retained adapter fields, not new calculations or net capital inflow. Do not sum pairs, assets, metrics, units, overlapping windows or sources; do not convert currencies. A short terminal page is not proof of complete-window coverage. A capped terminal page retains null amounts/ratio, while an uncapped empty window retains zero decimal strings and a null ratio. Cursor is an exact continuation token, not an execution timestamp.'},
  native_retention:{schema_validation:'existing_strict_trade_snapshot_schema',unknown_fields:'rejected',raw_provider_payload:false,hidden_rows_included:false},rows,
 };
}
export function krakenTradeExportFilename(report:OrganizedKrakenTradeReport){return `kraken-trades-${report.period.window_ms/60000}m-${report.period.end.replace(/[:.]/g,'-')}-organized.json`;}
