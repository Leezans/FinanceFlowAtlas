/** Read-only retained CFTC position fields. No new source calls or derived positions. */
import {CFTC_DATASET,CFTC_SCHEDULE,CONTRACTS,FUTURES_CATEGORIES,snapshotSchema,type CftcSnapshot,type Position} from '@/lib/futures/model';
import type {EvidenceRow} from './types';

type PositionField=Exclude<keyof Position,'date'>;
const fields=[
 {id:'open_interest',label:'市场未平仓量',group:'all',side:'both_sides'},
 {id:'noncommercial_long',label:'非商业多头',group:'noncommercial',side:'long'},
 {id:'noncommercial_short',label:'非商业空头',group:'noncommercial',side:'short'},
 {id:'spreading',label:'非商业抵消多空持仓（spreading）',group:'noncommercial',side:'both_sides'},
 {id:'commercial_long',label:'商业多头',group:'commercial',side:'long'},
 {id:'commercial_short',label:'商业空头',group:'commercial',side:'short'},
 {id:'nonreportable_long',label:'非报告多头',group:'nonreportable',side:'long'},
 {id:'nonreportable_short',label:'非报告空头',group:'nonreportable',side:'short'},
] as const satisfies readonly {id:PositionField;label:string;group:string;side:string}[];
export type OrganizedCftcRow=EvidenceRow&{
 dimension:{namespace:'CFTC.contract_market_code';kind:'instrument';id:string;label:string;native_locator:string;label_native_locator:string};
 contract:{units:string;units_native_locator:string;expiry_scope:'all_expiry_months'};
 category:{namespace:'FinanceFlowAtlas.futures_navigation';id:string;label:string;origin:'application_manifest';source_classification:false};
 observation:{slot:'current'|'previous';date:string;native_locator:string};
 position:{group:typeof fields[number]['group'];side:typeof fields[number]['side']};
 role:'position_measure';value:number;state:'reported';native_locator:string;value_origin:'retained_source_position';
};
export type OrganizedCftcReport={
 schema:'organized-market-report/1';source_id:'cftc';native_schema:CftcSnapshot['schema'];native_snapshot:CftcSnapshot;
 source:{name:'CFTC';dataset:'6dca-aqww';report_type:'futures_only';urls:readonly string[];license_url:null;attribution:string;raw_sha256:null};
 geography:{iso3:'USA';role:'reporting_market';underlying_domicile:null};
 period:{start:string;end:string;frequency:'weekly';calendar_timezone:null;date_semantics:'point_in_time_positions';current_report_date:string;previous_report_dates:string[];frequency_note:string};
 unit:{code:'contracts';currency:null;currency_multiplier:null};
 clocks:{source_released_at:null;source_updated_date:null;acquisition_started_at:string;fetched_at:string};
 measure_scope:'futures_positions';whole_market_capital_flow:false;net_capital_flow:null;
 coverage:{scope:CftcSnapshot['coverage'];market_count:number;category_count:number;legacy:boolean;global_coverage:false};
 classification:{industry:null;instrument:{namespace:'CFTC.contract_market_code';expiry_scope:'all_expiry_months'};category:{namespace:'FinanceFlowAtlas.futures_navigation';origin:'application_manifest';source_classification:false}};
 presentation:{stale:boolean;basis:'current_visible_page_snapshot';row_selection:'all_retained_markets_periods_position_fields'};
 aggregation:{cross_source_allowed:false;total_overlaps_components:true;cross_market_allowed:false;rule:string};
 native_retention:{schema_validation:'strict';unknown_fields:'rejected';raw_provider_payload:false};
 rows:OrganizedCftcRow[];
};

/** Caller passes the existing age/permission-filtered visibleSnapshot result, not provider data. */
export function projectCftcReport(input:unknown|null,stale=false):OrganizedCftcReport|null {
 if(input===null)return null;
 // Both schema versions are strict at every level, with exact contract identity,
 // specification and OI validation. Preserve legacy coverage and per-market dates.
 const snapshot=snapshotSchema.parse(input);
 const rows:OrganizedCftcRow[]=snapshot.rows.flatMap((market,index)=>{
  const contract=CONTRACTS.find(contract=>contract.code===market.code)!;
  const category=FUTURES_CATEGORIES.find(category=>category.id===contract.category)!;
  return (['current','previous'] as const).flatMap(slot=>fields.map(field=>({
   id:`cftc:${market.code}:${slot}:${market[slot].date}:${field.id}`,
   dimension:{namespace:'CFTC.contract_market_code',kind:'instrument',id:market.code,label:market.market_name,native_locator:`rows[${index}].code`,label_native_locator:`rows[${index}].market_name`},
   contract:{units:market.contract_units,units_native_locator:`rows[${index}].contract_units`,expiry_scope:'all_expiry_months'},
   category:{namespace:'FinanceFlowAtlas.futures_navigation',id:category.id,label:category.label,origin:'application_manifest',source_classification:false},
   observation:{slot,date:market[slot].date,native_locator:`rows[${index}].${slot}.date`},
   position:{group:field.group,side:field.side},role:'position_measure',metric_id:`cftc.${field.id}`,metric_label:field.label,
   value:market[slot][field.id],state:'reported',native_locator:`rows[${index}].${slot}.${field.id}`,value_origin:'retained_source_position',
  })));
 });
 const current=snapshot.rows[0].current.date;
 return {
  schema:'organized-market-report/1',source_id:'cftc',native_schema:snapshot.schema,native_snapshot:snapshot,
  source:{name:snapshot.source,dataset:snapshot.dataset,report_type:snapshot.report_type,urls:[CFTC_DATASET,CFTC_SCHEDULE],license_url:null,attribution:'Source: CFTC Legacy Futures Only. Application organization does not imply CFTC endorsement or unrestricted redistribution permission.',raw_sha256:null},
  geography:{iso3:'USA',role:'reporting_market',underlying_domicile:null},
  // These are point-in-time positions, not a transaction interval between dates.
  // Legacy snapshots need not have a common previous date across all markets.
  period:{start:current,end:current,frequency:'weekly',calendar_timezone:null,date_semantics:'point_in_time_positions',current_report_date:current,previous_report_dates:[...new Set(snapshot.rows.map(row=>row.previous.date))].sort(),frequency_note:'Customary weekly reporting, not a guaranteed seven-day interval. Use each row observation date; publication time is unknown. See the official release schedule.'},
  unit:{code:snapshot.unit,currency:null,currency_multiplier:null},
  clocks:{source_released_at:snapshot.source_released_at,source_updated_date:null,acquisition_started_at:snapshot.acquisition_started_at,fetched_at:snapshot.fetched_at},
  measure_scope:'futures_positions',whole_market_capital_flow:false,net_capital_flow:snapshot.net_capital_flow,
  coverage:{scope:snapshot.coverage,market_count:snapshot.rows.length,category_count:new Set(rows.map(row=>row.category.id)).size,legacy:snapshot.schema==='cftc-legacy-futures/1',global_coverage:false},
  classification:{industry:null,instrument:{namespace:'CFTC.contract_market_code',expiry_scope:'all_expiry_months'},category:{namespace:'FinanceFlowAtlas.futures_navigation',origin:'application_manifest',source_classification:false}},
  presentation:{stale,basis:'current_visible_page_snapshot',row_selection:'all_retained_markets_periods_position_fields'},
  aggregation:{cross_source_allowed:false,total_overlaps_components:true,cross_market_allowed:false,rule:'No calculated net, change, category or cross-market total is supplied. These are positions in each market\'s own contracts, not cash flow, trading volume or monetary notional. Long and short sides describe the same open contracts; each side separately reconciles to open interest. Noncommercial spreading enters both side identities and overlaps open interest. Do not add sides, spreading and open interest together, or sum different markets, units, periods or sources. Application categories are navigation, not CFTC industry classifications or additive totals. US reporting-market geography does not identify underlying domicile or establish global coverage.'},
  native_retention:{schema_validation:'strict',unknown_fields:'rejected',raw_provider_payload:false},rows,
 };
}
