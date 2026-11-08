/** Read-only organization of current A-share evidence. No acquisition or aggregation. */
import {numeric,numericFields,scopeKey,validateEvidence,type EvidenceSnapshot,type Scope,type ValidEvidence} from '@/components/ashare/model';
import type {EvidenceState} from '@/components/ashare/client';
import {ashareSnapshotExpiresAt,ashareSnapshotExpired} from '@/lib/ashare/retention';
import {SNAPSHOT_MAX_AGE_MS} from '@/lib/ashare/snapshot';
import {ASHARE_FLOW_METHODOLOGY_URL} from '@/lib/ashare/metric-semantics';
import type {EvidenceRow} from './types';

export type OrganizedAshareReport={
 schema:'organized-market-report/1';source_id:'eastmoney-ashare';native_schema:'ashare-provider-evidence/1';native_snapshot:EvidenceSnapshot;
 source:{name:'Eastmoney';urls:readonly string[];license_url:null;attribution:string;raw_sha256:null};
 geography:{iso3:'CHN';role:'local_market'};
 period:{start:null;end:null;frequency:'unknown';calendar_timezone:'Asia/Shanghai'};
 unit:{code:'CNY';currency:'CNY';currency_multiplier:1};
 clocks:{source_released_at:null;source_updated_date:null;source_observed_at:null;trade_date:null;acquisition_started_at:string|null;fetched_at:string};
 net_direction:{positive:string;negative:string;zero:'reported_zero'};
 measure_scope:'provider_order_flow_proxy';whole_market_capital_flow:false;
 coverage:string;scope:Scope;
 classification:{industry:{namespace:'Eastmoney';level:Scope['classification_level'];exclusivity:'not_established'};instrument:{namespace:'Eastmoney.security_code';exchange_mic:null}|null};
 presentation:{stale:boolean;basis:'current_visible_page_snapshot';retention:{basis:'oldest_retained_acquisition_clock';max_age_ms:number;expires_at:string};row_selection:'complete_current_provider_scope'};
 aggregation:{cross_source_allowed:false;total_overlaps_components:false;rule:string};
 native_retention:{row_fields:readonly string[];unknown_row_fields:'omitted';raw_provider_payload:false};
 rows:EvidenceRow[];
};

/** Reuse the durable source policy, measured from the oldest retained acquisition clock. */
export const ashareExportExpiresAt=ashareSnapshotExpiresAt;
/** Scope and permission checks happen during render, not after a navigation effect. */
export function visibleAshareExportSnapshot(state:EvidenceState,requestedScope:Scope,now:number|null):ValidEvidence|null {
 const snapshot=state.snapshot;
 if(!snapshot||(state.status!=='ready'&&state.status!=='stale')||state.recovery?.mode==='stopped'||
  scopeKey(snapshot.scope)!==scopeKey(requestedScope)||now===null||!Number.isFinite(now)||
  now<Date.parse(snapshot.fetched_at)||ashareSnapshotExpired(snapshot,now))return null;
 return snapshot;
}

/** Whitelist native fields: the UI row validator intentionally allows provider extras. */
function retainedSnapshot(snapshot:ValidEvidence):EvidenceSnapshot {
 const rows=snapshot.rows.map(row=>({f12:row.f12,f14:row.f14,...Object.fromEntries(numericFields.map(field=>[field,row[field]]))})) as EvidenceSnapshot['rows'];
 return {
  schema:snapshot.schema,rows,source_total:snapshot.source_total,fetched_at:snapshot.fetched_at,
  ...(snapshot.collection_started_at!==undefined?{collection_started_at:snapshot.collection_started_at}:{}),
  scope:{...snapshot.scope},page_count:snapshot.page_count,source_observed_at:snapshot.source_observed_at,trade_date:snapshot.trade_date,
  metric_kind:snapshot.metric_kind,metric_field:snapshot.metric_field,unit:snapshot.unit,field_units:{...snapshot.field_units},
  delay_status:snapshot.delay_status,classification_exclusivity:snapshot.classification_exclusivity,notice:snapshot.notice,stale:snapshot.stale,has_error:snapshot.has_error,
 };
}
/** Caller passes only age/permission/current-scope-filtered evidence. Missing is never zero. */
export function projectAshareReport(input:unknown|null,stale=false):OrganizedAshareReport|null {
 if(input===null)return null;
 const snapshot=validateEvidence(input),native=retainedSnapshot(snapshot),industry=snapshot.scope.kind==='industry_rank';
 const namespace=industry?'Eastmoney.industry_board':'Eastmoney.security_code';
 const rows:EvidenceRow[]=snapshot.rows.map((entry,index)=>{
  const value=numeric(entry.f62);
  return {id:`eastmoney-ashare:${scopeKey(snapshot.scope)}:${entry.f12}:f62`,
   dimension:{namespace,kind:industry?'industry':'instrument',id:entry.f12,label:entry.f14},role:'provider_scope_member',
   metric_id:'eastmoney-ashare.f62',metric_label:'主力净额（供应商订单分类估算）',value,
   state:value===null?'source_missing_marker':'reported',native_locator:`rows[${index}].f62`};
 });
 return {
  schema:'organized-market-report/1',source_id:'eastmoney-ashare',native_schema:snapshot.schema,native_snapshot:native,
  source:{name:'Eastmoney',urls:[ASHARE_FLOW_METHODOLOGY_URL],license_url:null,attribution:'来源：东方财富公开接口。仅当前页面个人研究证据；未确认再分发许可。',raw_sha256:null},
  geography:{iso3:'CHN',role:'local_market'},period:{start:null,end:null,frequency:'unknown',calendar_timezone:'Asia/Shanghai'},
  unit:{code:'CNY',currency:'CNY',currency_multiplier:1},
  clocks:{source_released_at:null,source_updated_date:null,source_observed_at:snapshot.source_observed_at,trade_date:snapshot.trade_date,acquisition_started_at:snapshot.collection_started_at??null,fetched_at:snapshot.fetched_at},
  net_direction:{positive:'Eastmoney large and extra-large classified orders: estimated net purchases',negative:'Eastmoney large and extra-large classified orders: estimated net sales',zero:'reported_zero'},
  measure_scope:snapshot.metric_kind,whole_market_capital_flow:false,
  coverage:`Complete validated provider scope ${snapshot.scope.fs}: ${snapshot.source_total} rows across ${snapshot.page_count} pages. Industry membership exclusivity and whole-market coverage are not established.`,
  scope:{...snapshot.scope},classification:{industry:{namespace:'Eastmoney',level:snapshot.scope.classification_level,exclusivity:snapshot.classification_exclusivity},instrument:industry?null:{namespace:'Eastmoney.security_code',exchange_mic:null}},
  presentation:{stale:stale||snapshot.stale||snapshot.has_error,basis:'current_visible_page_snapshot',retention:{basis:'oldest_retained_acquisition_clock',max_age_ms:SNAPSHOT_MAX_AGE_MS,expires_at:new Date(ashareExportExpiresAt(snapshot)).toISOString()},row_selection:'complete_current_provider_scope'},
  aggregation:{cross_source_allowed:false,total_overlaps_components:false,rule:'No aggregate total is supplied. Do not sum industry levels, industry boards with constituent stocks, or different scopes, metrics, acquisition windows or sources. Membership exclusivity is not established.'},
  native_retention:{row_fields:['f12','f14',...numericFields],unknown_row_fields:'omitted',raw_provider_payload:false},rows,
 };
}

/** Acquisition time identifies the saved snapshot; it is never labeled a trading date. */
export function ashareExportFilename(report:OrganizedAshareReport):string {
 const scope=report.scope.kind==='industry_rank'?report.scope.classification_level:report.scope.fs.slice(2);
 return `${report.source_id}-${scope}-acquired-${report.clocks.fetched_at.replace(/[^0-9TZ]/g,'')}-organized.json`;
}
