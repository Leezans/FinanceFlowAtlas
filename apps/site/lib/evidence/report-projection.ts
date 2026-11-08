/** Read-only projections. No fetch, storage, clock rewriting, currency conversion or cross-source totals. */
import {snapshotSchema as japanSchema,SOURCE_URL,SOURCE_PAGE,LICENSE_URL,ATTRIBUTION,type JapanMofSnapshot} from '@/lib/japan/model';
import {tpexSummarySnapshotSchema,TPEX_SUMMARY_URL,TPEX_SUMMARY_DATASET,TPEX_SUMMARY_LICENSE,TPEX_SUMMARY_SCOPE,type TpexSummarySnapshot} from '@/lib/national/tpex-summary';

import {assetLabels} from '@/lib/japan/view';
import {participantLabels} from '@/lib/national/tpex-summary-view';

export type EvidenceRow={
 id:string;dimension:{namespace:string;kind:'asset_class'|'participant'|'report'|'industry'|'instrument';id:string;label:string};
 role:'component'|'reported_total'|'provider_scope_member'|'participant_total';metric_id:string;metric_label:string;
 value:number|null;state:'reported'|'not_in_retained_snapshot'|'source_missing_marker'|'source_record_missing'|'source_aggregate_unavailable';native_locator:string|null;
};
export type OrganizedReport={
 schema:'organized-market-report/1';native_snapshot:JapanMofSnapshot|TpexSummarySnapshot;source_id:'japan-mof'|'tpex-money';native_schema:string;
 source:{name:string;urls:readonly string[];license_url:string;attribution:string;raw_sha256:null};
 geography:{iso3:'JPN'|'TWN';role:'issuer_market'|'local_market'};
 period:{start:string;end:string;frequency:'weekly'|'daily';calendar_timezone:string};
 unit:{code:'JPY_100_million'|'TWD';currency:'JPY'|'TWD';currency_multiplier:number};
 clocks:{source_released_at:null;source_updated_date:string|null;acquisition_started_at:string;fetched_at:string};
 net_direction:{positive:string;negative:string;zero:'reported_zero'};
 measure_scope:'nonresident_securities_transactions'|'institutional_buy_sell';whole_market_capital_flow:false;
 coverage:string;classification:{industry:null;instrument:null};
 presentation:{stale:boolean;basis:'current_visible_page_snapshot'};
 aggregation:{cross_source_allowed:false;total_overlaps_components:true;rule:string};
 rows:EvidenceRow[];
};
const aggregation={cross_source_allowed:false,total_overlaps_components:true,rule:'Do not sum reported_total with components, different metrics, units, periods or sources. Preserve published rounded totals.'} as const;
const classification={industry:null,instrument:null};
function row(source:string,period:string,dimension:EvidenceRow['dimension'],role:EvidenceRow['role'],field:string,label:string,value:number|null,locator:string|null):EvidenceRow {
 return {id:`${source}:${period}:${dimension.id}:${field}`,dimension,role,metric_id:`${source}.${field}`,metric_label:label,value,state:value===null?'not_in_retained_snapshot':'reported',native_locator:locator};
}
/** Caller must supply only its age/permission-filtered visible snapshot; null means no export. */
export function projectJapanReport(input:unknown|null,stale=false):OrganizedReport|null {
 if(input===null) return null;
 const s=japanSchema.parse(input),source='japan-mof';
 const rows=s.assets.flatMap((asset,index)=>[
  row(source,s.report_end,{namespace:'Japan_MOF',kind:'asset_class',id:asset.id,label:assetLabels[asset.id]},'component','acquisitions','取得金额',asset.acquisitions,`assets[${index}].acquisitions`),
  row(source,s.report_end,{namespace:'Japan_MOF',kind:'asset_class',id:asset.id,label:assetLabels[asset.id]},'component','dispositions','处置金额',asset.dispositions,`assets[${index}].dispositions`),
  row(source,s.report_end,{namespace:'Japan_MOF',kind:'asset_class',id:asset.id,label:assetLabels[asset.id]},'component','net','官方净额',asset.net,`assets[${index}].net`),
 ]);
 for(const [field,label,value,locator] of [['acquisitions','取得金额',null,null],['dispositions','处置金额',null,null],['net','官方净额',s.total_net,'total_net']] as const)
  rows.push(row(source,s.report_end,{namespace:'Japan_MOF',kind:'report',id:'total',label:'报告证券合计'},'reported_total',field,label,value,locator));
 return {schema:'organized-market-report/1',native_snapshot:s,source_id:source,native_schema:s.schema,
  source:{name:'Japan MOF',urls:[SOURCE_URL,SOURCE_PAGE],license_url:LICENSE_URL,attribution:ATTRIBUTION,raw_sha256:null},
  geography:{iso3:'JPN',role:'issuer_market'},period:{start:s.report_start,end:s.report_end,frequency:'weekly',calendar_timezone:'Asia/Tokyo'},
  unit:{code:s.unit,currency:'JPY',currency_multiplier:100_000_000},
  clocks:{source_released_at:s.source_released_at,source_updated_date:s.updated_date,acquisition_started_at:s.acquisition_started_at,fetched_at:s.fetched_at},
  net_direction:{positive:'Nonresident net acquisition of Japanese-issued securities',negative:'Nonresident net disposition; debt dispositions include redemptions',zero:'reported_zero'},measure_scope:'nonresident_securities_transactions',whole_market_capital_flow:false,coverage:s.coverage,classification,presentation:{stale,basis:'current_visible_page_snapshot'},aggregation,rows};
}
export function projectTaiwanReport(input:unknown|null,stale=false):OrganizedReport|null {
 if(input===null) return null;
 const s=tpexSummarySnapshotSchema.parse(input),source='tpex-money';
 const rows=s.participants.flatMap((participant,index)=>(['buy','sell','net'] as const).map(field=>row(source,s.report_date,
  {namespace:'TPEx',kind:'participant',id:participant.id,label:participantLabels[participant.id]},participant.id==='total'?'reported_total':'component',field,
  {buy:'买进金额',sell:'卖出金额',net:'净买卖金额'}[field],participant[field],`participants[${index}].${field}`)));
 return {schema:'organized-market-report/1',native_snapshot:s,source_id:source,native_schema:s.schema,
  source:{name:s.source,urls:[TPEX_SUMMARY_URL,TPEX_SUMMARY_DATASET],license_url:TPEX_SUMMARY_LICENSE,attribution:'资料来源：证券柜台买卖中心（TPEx）；本应用整理，不代表来源背书。',raw_sha256:null},
  geography:{iso3:'TWN',role:'local_market'},period:{start:s.report_date,end:s.report_date,frequency:'daily',calendar_timezone:'Asia/Taipei'},
  unit:{code:s.unit,currency:'TWD',currency_multiplier:1},
  clocks:{source_released_at:s.source_released_at,source_updated_date:null,acquisition_started_at:s.acquisition_started_at,fetched_at:s.fetched_at},
  net_direction:{positive:'Named institutional category net purchases of TPEx OTC securities',negative:'Named institutional category net sales of TPEx OTC securities',zero:'reported_zero'},measure_scope:'institutional_buy_sell',whole_market_capital_flow:false,coverage:TPEX_SUMMARY_SCOPE,classification,presentation:{stale,basis:'current_visible_page_snapshot'},aggregation,rows};
}
