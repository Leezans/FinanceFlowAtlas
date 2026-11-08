/** Read-only organization of the existing, permission/age-filtered option view. */
import {z} from 'zod';
import {MAX_ROWS,METADATA_MAX_AGE_MS,OPTION_CURRENCIES,coverageForCurrencies,optionRowSchema,type OptionCurrency,type OptionsSnapshot} from '@/lib/options/model';
import type {EvidenceRow} from './report-projection';

export type DeribitInputSchema='deribit-options/2'|'deribit-btc-options/1';
export type DeribitProvenance={input_schema:DeribitInputSchema|null;source_instrument_count:number|null};
const instant=z.string().datetime({offset:true});
/** A VIEW, not a second acquisition schema. Full replies are validated by the hook
 * before expired contracts are removed. Source clocks/scope must not be rewritten
 * to make the filtered view pass the full snapshot's minimum-clock/count checks. */
const visibleViewSchema=z.object({
 schema:z.literal('deribit-options/2'),source:z.literal('Deribit'),
 currencies:z.array(z.enum(OPTION_CURRENCIES)).min(1).max(2),coverage:z.enum(['deribit_btc_options','deribit_eth_options','deribit_btc_eth_options']),
 acquisition_started_at:instant,fetched_at:instant,source_as_of:instant,
 metadata_fetched_at:z.object({BTC:instant.optional(),ETH:instant.optional()}).strict(),
 net_capital_flow:z.null(),delay_policy:z.literal('source_delay_unconfirmed'),rows:z.array(optionRowSchema).min(1).max(2*MAX_ROWS),
}).strict().refine(s=>{
 const start=Date.parse(s.acquisition_started_at),end=Date.parse(s.fetched_at),asof=Date.parse(s.source_as_of);
 const canonical=OPTION_CURRENCIES.filter(currency=>s.currencies.includes(currency)),keys=Object.keys(s.metadata_fetched_at);
 return end>=start&&asof>=start-30_000&&asof<=end+5_000&&canonical.join(',')===s.currencies.join(',')&&s.coverage===coverageForCurrencies(s.currencies)&&
  keys.length===canonical.length&&keys.every(currency=>canonical.includes(currency as OptionCurrency))&&canonical.every(currency=>{
   const meta=Date.parse(s.metadata_fetched_at[currency]??'');
   return meta<=end&&meta>=start-METADATA_MAX_AGE_MS&&s.rows.filter(row=>row.underlying_currency===currency).length<=MAX_ROWS;
  })&&new Set(s.rows.map(row=>row.instrument)).size===s.rows.length&&s.rows.every(row=>canonical.includes(row.underlying_currency)&&row.creation_timestamp>=asof&&row.creation_timestamp<=asof+5_000);
},'visible_snapshot_identity_or_timing');
const provenanceSchema=z.object({input_schema:z.enum(['deribit-options/2','deribit-btc-options/1']).nullable(),source_instrument_count:z.number().int().min(1).max(2*MAX_ROWS).nullable()}).strict();
const fields=[
 {id:'volume',label:'来源24小时成交量',kind:'underlying_quantity',window:'rolling_24_hours'},
 {id:'volume_usd',label:'来源24小时成交额',kind:'traded_amount',window:'rolling_24_hours'},
 {id:'open_interest',label:'来源未平仓量（OI）',kind:'underlying_quantity',window:'snapshot'},
 {id:'mark_price',label:'标记价格',kind:'option_quote',window:'snapshot'},
 {id:'bid_price',label:'买价',kind:'option_quote',window:'snapshot'},
 {id:'ask_price',label:'卖价',kind:'option_quote',window:'snapshot'},
 {id:'last',label:'最近成交价',kind:'option_quote',window:'last_trade_time_unknown'},
] as const;
export const DERIBIT_FIELDS_PER_INSTRUMENT=fields.length;
export type OrganizedDeribitRow=EvidenceRow&{
 dimension:{namespace:'Deribit.instrument_name';kind:'instrument';id:string;label:string;native_locator:string};
 instrument:{underlying_currency:OptionCurrency;underlying_native_locator:string;expiration_timestamp:number;expiration_native_locator:string;strike:number;strike_unit:'USD';strike_native_locator:string;option_type:'call'|'put';type_native_locator:string;contract_size:number;contract_size_unit:OptionCurrency;size_native_locator:string};
 unit:{code:string;kind:typeof fields[number]['kind'];currency:OptionCurrency|'USD';denominator:OptionCurrency|null;currency_multiplier:1|null};
 observation:{creation_timestamp:number;native_locator:string;window:typeof fields[number]['window'];window_start:null;window_end:null;delay_policy:'source_delay_unconfirmed'};
 role:'instrument_measure';state:'reported'|'source_null';native_locator:string;value_origin:'retained_source_field';
};
export type DeribitVisibleNative=Omit<OptionsSnapshot,'schema'>&{schema:'deribit-options-visible/1';source_schema:'deribit-options/2'};
export type OrganizedDeribitReport={
 schema:'organized-market-report/1';source_id:'deribit-options';native_schema:'deribit-options-visible/1';native_snapshot:DeribitVisibleNative;
 source:{name:'Deribit';urls:readonly string[];license_url:null;terms_url:string;attribution:string;raw_sha256:null};
 geography:{iso3:null;role:'exchange_venue';underlying_domicile:null};
 period:{start:null;end:null;frequency:'snapshot';calendar_timezone:null;date_semantics:'source_snapshot_with_rolling_24h_statistics'};
 unit:{code:'per_row';currency:null;currency_multiplier:null};
 clocks:{source_released_at:null;source_updated_date:null;source_as_of:string;acquisition_started_at:string;fetched_at:string;metadata_fetched_at:OptionsSnapshot['metadata_fetched_at']};
 measure_scope:'single_exchange_option_market_snapshot';whole_market_capital_flow:false;net_capital_flow:null;delay_policy:'source_delay_unconfirmed';
 coverage:{source_scope:OptionsSnapshot['coverage'];source_currencies:OptionCurrency[];source_instrument_count:number|null;visible_currencies:OptionCurrency[];visible_instrument_count:number;global_coverage:false};
 normalization:{input_schema:DeribitInputSchema|null;normalized_schema:'deribit-options/2';legacy_btc_normalized:boolean|null;native_payload:'normalized_visible_view';note:string};
 classification:{industry:null;instrument:{namespace:'Deribit.instrument_name'};underlying:{origin:'source_metadata';country_assignment:null}};
 presentation:{stale:boolean;basis:'current_visible_page_snapshot';row_selection:'all_visible_unexpired_instruments_and_selected_native_fields'};
 aggregation:{cross_source_allowed:false;cross_currency_allowed:false;cross_instrument_allowed:false;total_overlaps_components:false;rule:string};
 native_retention:{schema_validation:'strict_visible_view_after_validated_reply';unknown_fields:'rejected';raw_provider_payload:false;expired_rows_included:false};
 rows:OrganizedDeribitRow[];
};

/** Only the hook's exact visible view is eligible. This does not acquire evidence,
 * grant permission or replace the hook's age, denial and individual-expiry policy. */
export function projectDeribitReport(input:unknown|null,stale=false,provenance:DeribitProvenance={input_schema:null,source_instrument_count:null}):OrganizedDeribitReport|null {
 if(input===null)return null;
 const snapshot=visibleViewSchema.parse(input),origin=provenanceSchema.parse(provenance);
 if(origin.source_instrument_count!==null&&(origin.source_instrument_count<snapshot.rows.length||origin.source_instrument_count>snapshot.currencies.length*MAX_ROWS))throw new Error('invalid_source_instrument_count');
 if(origin.input_schema==='deribit-btc-options/1'&&(snapshot.currencies.length!==1||snapshot.currencies[0]!=='BTC'))throw new Error('invalid_legacy_coverage');
 const native:DeribitVisibleNative={...snapshot,schema:'deribit-options-visible/1',source_schema:snapshot.schema};
 const rows:OrganizedDeribitRow[]=snapshot.rows.flatMap((contract,index)=>fields.map(field=>{
  const base=`rows[${index}]`,currency=contract.underlying_currency,value=contract[field.id],quote=field.kind==='option_quote',usd=field.id==='volume_usd';
  return {
   id:`deribit-options:${contract.instrument}:${contract.creation_timestamp}:${field.id}`,
   dimension:{namespace:'Deribit.instrument_name',kind:'instrument',id:contract.instrument,label:contract.instrument,native_locator:`${base}.instrument`},
   instrument:{underlying_currency:currency,underlying_native_locator:`${base}.underlying_currency`,expiration_timestamp:contract.expiration_timestamp,expiration_native_locator:`${base}.expiration_timestamp`,strike:contract.strike,strike_unit:'USD',strike_native_locator:`${base}.strike`,option_type:contract.option_type,type_native_locator:`${base}.option_type`,contract_size:contract.contract_size,contract_size_unit:currency,size_native_locator:`${base}.contract_size`},
   unit:{code:usd?'USD':quote?`${currency} / ${currency}`:currency,kind:field.kind,currency:usd?'USD':currency,denominator:quote?currency:null,currency_multiplier:usd?1:null},
   observation:{creation_timestamp:contract.creation_timestamp,native_locator:`${base}.creation_timestamp`,window:field.window,window_start:null,window_end:null,delay_policy:snapshot.delay_policy},
   role:'instrument_measure',metric_id:`deribit-options.${field.id}`,metric_label:field.label,value,state:value===null?'source_null':'reported',native_locator:`${base}.${field.id}`,value_origin:'retained_source_field',
  };
 }));
 return {
  schema:'organized-market-report/1',source_id:'deribit-options',native_schema:native.schema,native_snapshot:native,
  source:{name:snapshot.source,urls:['https://docs.deribit.com/api-reference/market-data/public-get_book_summary_by_currency','https://docs.deribit.com/api-reference/market-data/public-get_instruments','https://support.deribit.com/hc/en-us/articles/40275495462301-5-November-2026'],license_url:null,terms_url:'https://support.deribit.com/hc/en-us/articles/25944532191645-Deribit-Exchange-Membership-Terms-Deribit-FZE',attribution:'Source: Deribit. Personal-use evidence only; no redistribution license or exchange endorsement is asserted.',raw_sha256:null},
  geography:{iso3:null,role:'exchange_venue',underlying_domicile:null},
  period:{start:null,end:null,frequency:'snapshot',calendar_timezone:null,date_semantics:'source_snapshot_with_rolling_24h_statistics'},unit:{code:'per_row',currency:null,currency_multiplier:null},
  clocks:{source_released_at:null,source_updated_date:null,source_as_of:snapshot.source_as_of,acquisition_started_at:snapshot.acquisition_started_at,fetched_at:snapshot.fetched_at,metadata_fetched_at:snapshot.metadata_fetched_at},
  measure_scope:'single_exchange_option_market_snapshot',whole_market_capital_flow:false,net_capital_flow:null,delay_policy:snapshot.delay_policy,
  coverage:{source_scope:snapshot.coverage,source_currencies:snapshot.currencies,source_instrument_count:origin.source_instrument_count,visible_currencies:OPTION_CURRENCIES.filter(currency=>snapshot.rows.some(row=>row.underlying_currency===currency)),visible_instrument_count:snapshot.rows.length,global_coverage:false},
  normalization:{input_schema:origin.input_schema,normalized_schema:snapshot.schema,legacy_btc_normalized:origin.input_schema===null?null:origin.input_schema==='deribit-btc-options/1',native_payload:'normalized_visible_view',note:'Input schema is the actual received API schema, not an inferred cache origin. Legacy input, when observed, was normalized by the existing reader: currency to currencies, metadata clock to BTC key, BTC underlying added to rows. Clocks and values are unchanged. Only currently visible rows are retained; original source scope is separate from active coverage.'},
  classification:{industry:null,instrument:{namespace:'Deribit.instrument_name'},underlying:{origin:'source_metadata',country_assignment:null}},
  presentation:{stale,basis:'current_visible_page_snapshot',row_selection:'all_visible_unexpired_instruments_and_selected_native_fields'},
  aggregation:{cross_source_allowed:false,cross_currency_allowed:false,cross_instrument_allowed:false,total_overlaps_components:false,rule:'No sums, net flow, OI valuation or currency conversions are supplied. Native volume, open interest and contract size use each underlying coin, not integer contract counts. Quotes use that coin per underlying coin. volume_usd is the source 24-hour traded amount in USD, not net capital inflow or position value. Do not add quantities, quotes, OI or turnover, currencies, instruments, windows or sources. Exact rolling-window endpoints and last-trade time are not retained; creation_timestamp is the source row clock, not guaranteed publication or trade time. Publication delay remains unconfirmed.'},
  native_retention:{schema_validation:'strict_visible_view_after_validated_reply',unknown_fields:'rejected',raw_provider_payload:false,expired_rows_included:false},rows,
 };
}
export function deribitExportFilename(report:OrganizedDeribitReport){return `deribit-options-${report.coverage.visible_currencies.join('-')}-source-${report.clocks.source_as_of.replace(/[:.]/g,'-')}-organized.json`;}
