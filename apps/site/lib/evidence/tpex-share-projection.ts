/** Source-preserving organization of the already visible TPEx company snapshot. */
import {COMPANY_DATASET,FLOW_DATASET,LICENSE,PARTICIPANTS,snapshotSchema,type Participant,type TpexSnapshot} from '@/lib/tpex/model';
import {COMPANY_URL,FLOW_URL} from '@/lib/tpex/adapter';
import {INDUSTRY_REFERENCE,industryLabel} from '@/lib/tpex/industries';
import type {EvidenceRow} from './report-projection';

export type OrganizedTpexShareRow=EvidenceRow&{
 dimension:{namespace:'TPEx.security_code';kind:'instrument';id:string;label:string;native_locator:string};
 industry:{namespace:'TPEx.industry_code';id:string;label:string;classification_date:string;native_locator:string};
 participant:{namespace:'TPEx.institutional_participant';id:Participant;label:string};
 expected_metric_locator:string;
 value_origin:'source_reported'|'adapter_sum_of_participants'|'source_record_missing';
};
export type OrganizedTpexShareReport={
 schema:'organized-market-report/1';source_id:'tpex-shares';native_schema:'tpex-institutional/1';native_snapshot:TpexSnapshot;
 source:{name:'TPEx';urls:readonly string[];license_url:string;attribution:string;raw_sha256:null};
 geography:{iso3:'TWN';role:'local_market'};
 period:{start:string;end:string;frequency:'daily';calendar_timezone:'Asia/Taipei'};
 unit:{code:'shares';currency:null;currency_multiplier:null};
 clocks:{source_released_at:null;source_updated_date:null;classification_date:string;acquisition_started_at:string;fetched_at:string};
 net_direction:{positive:string;negative:string;zero:'reported_zero'};
 measure_scope:'institutional_security_buy_sell_shares';whole_market_capital_flow:false;
 coverage:{market:TpexSnapshot['market'];company_count:number;matched_company_count:number;missing_company_count:number;source_security_count:number;excluded_security_count:number};
 classification:{industry:{namespace:'TPEx.industry_code';date:string;reference_url:string};instrument:{namespace:'TPEx.security_code';market:TpexSnapshot['market'];exchange_mic:null}};
 presentation:{stale:boolean;basis:'current_visible_page_snapshot';row_selection:'all_companies_and_participants'};
 aggregation:{cross_source_allowed:false;total_overlaps_components:true;rule:string};
 native_retention:{schema_validation:'strict';unknown_fields:'rejected';raw_provider_payload:false};
 rows:OrganizedTpexShareRow[];
};

/** No acquisition, sums, guessed classification, or changes to native retention clocks. */
export function projectTpexShareReport(input:unknown|null,stale=false):OrganizedTpexShareReport|null {
 if(input===null)return null;
 // Every level of this existing schema is strict, including company/participant fields.
 const snapshot=snapshotSchema.parse(input),source='tpex-shares';
 const rows:OrganizedTpexShareRow[]=snapshot.rows.flatMap((company,index)=>PARTICIPANTS.flatMap(participant=>(['buy','sell','net'] as const).map(field=>{
  const missing=company.flow===null,expected_metric_locator=`rows[${index}].flow.${participant.id}.${field}`;
  return {
   id:`${source}:${snapshot.report_date}:${company.code}:${participant.id}:${field}`,
   dimension:{namespace:'TPEx.security_code',kind:'instrument',id:company.code,label:company.name,native_locator:`rows[${index}].code`},
   industry:{namespace:'TPEx.industry_code',id:company.industry_code,label:industryLabel(company.industry_code),classification_date:snapshot.classification_date,native_locator:`rows[${index}].industry_code`},
   participant:{namespace:'TPEx.institutional_participant',id:participant.id,label:participant.label},
   role:participant.id==='total'?'participant_total':'component',metric_id:`${source}.${field}`,metric_label:{buy:'买进股数',sell:'卖出股数',net:'净买卖超股数'}[field],
   value:company.flow?.[participant.id][field]??null,state:missing?'source_record_missing':'reported',
   native_locator:missing?`rows[${index}].flow`:expected_metric_locator,expected_metric_locator,
   // The existing adapter calculates total buy/sell; only total net is source-reported.
   value_origin:missing?'source_record_missing':participant.id==='total'&&field!=='net'?'adapter_sum_of_participants':'source_reported',
  };
 })));
 const matched=snapshot.rows.filter(company=>company.flow!==null).length;
 return {
  schema:'organized-market-report/1',source_id:source,native_schema:snapshot.schema,native_snapshot:snapshot,
  source:{name:snapshot.source,urls:[FLOW_URL,FLOW_DATASET,COMPANY_URL,COMPANY_DATASET,INDUSTRY_REFERENCE],license_url:LICENSE,attribution:'资料来源：金融监督管理委员会证券期货局／证券柜台买卖中心（TPEx）。依政府资料开放授权条款第 1 版，本应用整理，不代表来源背书。产业代码参考不授予独立报价源使用许可。',raw_sha256:null},
  geography:{iso3:'TWN',role:'local_market'},period:{start:snapshot.report_date,end:snapshot.report_date,frequency:'daily',calendar_timezone:'Asia/Taipei'},
  unit:{code:snapshot.unit,currency:null,currency_multiplier:null},
  clocks:{source_released_at:snapshot.source_released_at,source_updated_date:null,classification_date:snapshot.classification_date,acquisition_started_at:snapshot.acquisition_started_at,fetched_at:snapshot.fetched_at},
  net_direction:{positive:'Named institutional category net purchases of a TPEx OTC company in shares',negative:'Named institutional category net sales of a TPEx OTC company in shares',zero:'reported_zero'},
  measure_scope:'institutional_security_buy_sell_shares',whole_market_capital_flow:false,
  coverage:{market:snapshot.market,company_count:snapshot.rows.length,matched_company_count:matched,missing_company_count:snapshot.rows.length-matched,source_security_count:snapshot.source_security_count,excluded_security_count:snapshot.excluded_security_count},
  classification:{industry:{namespace:'TPEx.industry_code',date:snapshot.classification_date,reference_url:INDUSTRY_REFERENCE},instrument:{namespace:'TPEx.security_code',market:snapshot.market,exchange_mic:null}},
  presentation:{stale,basis:'current_visible_page_snapshot',row_selection:'all_companies_and_participants'},
  aggregation:{cross_source_allowed:false,total_overlaps_components:true,rule:'Per-company total overlaps foreign, trust and dealer components. Foreign excludes foreign dealers, which are included in dealer. Total buy/sell were calculated by the existing source adapter; total net is source-reported. Do not add total and components, buy/sell/net metrics, different periods, sources or share counts as currency. No industry aggregates or cross-taxonomy mappings are supplied. Excluded securities and companies with missing flow do not become zeros.'},
  native_retention:{schema_validation:'strict',unknown_fields:'rejected',raw_provider_payload:false},rows,
 };
}
