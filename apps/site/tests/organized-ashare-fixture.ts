import {numericFields,validateEvidence,type Scope} from '../components/ashare/model';
export const ASHARE_REPORT_NOW=Date.parse('2026-11-08T08:00:00Z');
export const ASHARE_REPORT_ROOT:Scope={kind:'industry_rank',fs:'m:90+s:2+f:!50',classification_level:'eastmoney_level_1'};
/** Synthetic values only. No source observations or identifiers are copied from a provider. */
export function ashareReportFixture({scope=ASHARE_REPORT_ROOT,now=ASHARE_REPORT_NOW,collection=true}:{scope?:Scope;now?:number;collection?:boolean}={}) {
 return validateEvidence({schema:'ashare-provider-evidence/1',
  rows:[120,-70,0,null,'-','--',''].map((f62,index)=>({...Object.fromEntries(numericFields.map(field=>[field,1])),f12:scope.kind==='industry_rank'?`BK900${index}`:`90000${index}`,f14:`合成证据${index}`,f62})),
  source_total:7,fetched_at:new Date(now).toISOString(),...(collection?{collection_started_at:new Date(now-120_000).toISOString()}:{}),
  scope,page_count:1,source_observed_at:null,trade_date:null,metric_kind:'provider_order_flow_proxy',metric_field:'f62',unit:'CNY',field_units:{f62:'CNY',f3:'percent',f2:scope.kind==='industry_rank'?'index_points':'CNY'},
  delay_status:'not_provided',classification_exclusivity:'not_established',notice:'合成测试记录，非真实市场数据。',stale:false,has_error:false});
}
