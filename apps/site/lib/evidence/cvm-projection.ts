/** Organize the already visible CVM display snapshot. No acquisition or new aggregates. */
import {COMPANY_DATASET,FLOW_DATASET,LICENSE,snapshotSchema,type CvmSnapshot} from '@/lib/cvm/model';
import type {EvidenceRow} from './types';

export type OrganizedCvmRow=EvidenceRow&{
 dimension:{namespace:'CVM.FCA.Codigo_Negociacao';kind:'instrument';id:string;label:string;native_locator:string};
 industry:{namespace:'CVM.FCA.Setor_Atividade';id:string;label:string;classification_date:string;classification_point_in_time:false;native_locator:string};
 source_rows:number;source_rows_locator:string;expected_metric_locator:string;source_fields:readonly string[];
 value_origin:'adapter_sum_of_disclosed_transactions'|'adapter_difference_of_aggregates'|'source_aggregate_unavailable';
};
export type OrganizedCvmReport={
 schema:'organized-market-report/1';source_id:'cvm-fund-equity';native_schema:'cvm-fund-equity/1';native_snapshot:CvmSnapshot;
 source:{name:'CVM';urls:readonly string[];license_url:string;license:'ODbL-1.0';attribution:string;raw_sha256:CvmSnapshot['source_sha256'];hash_scope:'source_archives'};
 geography:{iso3:'BRA';role:'local_market'};
 period:{observation_month:string;start:string;end:string;frequency:'monthly';calendar_timezone:null};
 unit:{code:'BRL_cents';currency:'BRL';currency_multiplier:0.01};
 clocks:{source_released_at:null;source_updated_date:null;classification_date:string;acquisition_started_at:string;fetched_at:string};
 net_direction:{positive:string;negative:string;zero:'reported_zero'};
 measure_scope:'public_disclosed_fund_equity_transactions';whole_market_capital_flow:false;net_capital_flow:null;
 coverage:{market:CvmSnapshot['market'];scope:CvmSnapshot['coverage'];security_count:number;known_security_count:number;unavailable_security_count:number;counts:CvmSnapshot['counts']};
 classification:{industry:{namespace:'CVM.FCA.Setor_Atividade';date:string;classification_point_in_time:false};instrument:{namespace:'CVM.FCA.Codigo_Negociacao';market:CvmSnapshot['market'];exchange_mic:null}};
 presentation:{stale:boolean;basis:'current_visible_page_snapshot';row_selection:'all_catalog_securities'};
 aggregation:{cross_source_allowed:false;total_overlaps_components:false;rule:string};
 native_retention:{schema_validation:'strict';unknown_fields:'rejected';raw_provider_payload:false};
 rows:OrganizedCvmRow[];
};

/** Caller supplies the existing age/permission-filtered snapshot, not raw source records. */
export function projectCvmReport(input:unknown|null,stale=false):OrganizedCvmReport|null {
 if(input===null)return null;
 // The display schema is strict at every level. No fund/company identifiers or
 // contact properties from the upstream archives are accepted into the file.
 const snapshot=snapshotSchema.parse(input),source='cvm-fund-equity';
 const rows:OrganizedCvmRow[]=snapshot.rows.flatMap((security,index)=>(['buy','sell','net'] as const).map(field=>{
  const missing=security.flow===null,expected_metric_locator=`rows[${index}].flow.${field}`;
  return {
   id:`${source}:${snapshot.period}:${security.code}:${field}`,
   dimension:{namespace:'CVM.FCA.Codigo_Negociacao',kind:'instrument',id:security.code,label:security.name,native_locator:`rows[${index}].code`},
   industry:{namespace:'CVM.FCA.Setor_Atividade',id:security.industry,label:security.industry,classification_date:snapshot.classification_date,classification_point_in_time:false,native_locator:`rows[${index}].industry`},
   role:'component',metric_id:`${source}.${field}`,metric_label:{buy:'公开基金买入金额',sell:'公开基金卖出金额',net:'公开基金买卖差额'}[field],
   value:security.flow?.[field]??null,state:missing?'source_aggregate_unavailable':'reported',
   native_locator:missing?`rows[${index}].flow`:expected_metric_locator,expected_metric_locator,
   source_rows:security.source_rows,source_rows_locator:`rows[${index}].source_rows`,
   source_fields:field==='buy'?['VL_AQUIS_NEGOC']:field==='sell'?['VL_VENDA_NEGOC']:['VL_AQUIS_NEGOC','VL_VENDA_NEGOC'],
   value_origin:missing?'source_aggregate_unavailable':field==='net'?'adapter_difference_of_aggregates':'adapter_sum_of_disclosed_transactions',
  };
 }));
 const known=snapshot.rows.filter(security=>security.flow!==null).length;
 return {
  schema:'organized-market-report/1',source_id:source,native_schema:snapshot.schema,native_snapshot:snapshot,
  source:{name:snapshot.source,urls:[snapshot.source_urls.cda,FLOW_DATASET,snapshot.source_urls.fca,COMPANY_DATASET],license_url:LICENSE,license:snapshot.license,attribution:snapshot.attribution,raw_sha256:{...snapshot.source_sha256},hash_scope:'source_archives'},
  geography:{iso3:'BRA',role:'local_market'},period:{observation_month:snapshot.period,start:`${snapshot.period}-01`,end:snapshot.report_date,frequency:'monthly',calendar_timezone:null},
  unit:{code:snapshot.unit,currency:'BRL',currency_multiplier:0.01},
  clocks:{source_released_at:snapshot.source_released_at,source_updated_date:null,classification_date:snapshot.classification_date,acquisition_started_at:snapshot.acquisition_started_at,fetched_at:snapshot.fetched_at},
  net_direction:{positive:'Disclosed eligible fund equity purchases exceed sales',negative:'Disclosed eligible fund equity sales exceed purchases',zero:'reported_zero'},
  measure_scope:'public_disclosed_fund_equity_transactions',whole_market_capital_flow:false,net_capital_flow:snapshot.net_capital_flow,
  coverage:{market:snapshot.market,scope:snapshot.coverage,security_count:snapshot.rows.length,known_security_count:known,unavailable_security_count:snapshot.rows.length-known,counts:{...snapshot.counts}},
  classification:{industry:{namespace:'CVM.FCA.Setor_Atividade',date:snapshot.classification_date,classification_point_in_time:snapshot.classification_point_in_time},instrument:{namespace:'CVM.FCA.Codigo_Negociacao',market:snapshot.market,exchange_mic:null}},
  presentation:{stale,basis:'current_visible_page_snapshot',row_selection:'all_catalog_securities'},
  aggregation:{cross_source_allowed:false,total_overlaps_components:false,rule:'Only security components are exported; no industry or market totals are added. Existing heatmap industry subtotals overlap these securities and must not be added to them. Buy/sell are existing adapter sums of eligible public CDA transactions; net is the existing adapter buy-minus-sell difference, not an independent reported field. Do not sum different metrics, periods or sources. Public and confidential fund counts may overlap; confidential amounts are not allocated to securities or industries. Null flow may mean no eligible record, incomplete amounts or duplicate quarantine; per-security reasons are not retained. Catalog coverage is not whole-market coverage. Industry categories are acquisition-time FCA classifications, not historical point-in-time or a global taxonomy.'},
  native_retention:{schema_validation:'strict',unknown_fields:'rejected',raw_provider_payload:false},rows,
 };
}
