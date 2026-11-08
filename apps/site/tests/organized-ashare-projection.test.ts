import {describe,expect,it} from 'vitest';
import {ashareExportExpiresAt,ashareExportFilename,projectAshareReport,visibleAshareExportSnapshot} from '../lib/evidence/ashare-projection';
import {SNAPSHOT_MAX_AGE_MS} from '../lib/ashare/snapshot';
import {ASHARE_FLOW_METHODOLOGY_URL} from '../lib/ashare/metric-semantics';
import {numericFields,type Scope} from '../components/ashare/model';
import {emptyState,type EvidenceState} from '../components/ashare/client';
import {ASHARE_REPORT_NOW as NOW,ASHARE_REPORT_ROOT as ROOT,ashareReportFixture} from './organized-ashare-fixture';
const stockScope:Scope={kind:'industry_stocks',fs:'b:BK9000',classification_level:'unknown_may_mix_levels'};
const ready=():EvidenceState=>({...emptyState(),status:'ready',snapshot:ashareReportFixture()});
describe('A-share current-source organization',()=>{
 it.each([ROOT,stockScope])('keeps every f62 native value or exact missing marker at its locator for $kind',scope=>{
  const input=ashareReportFixture({scope}),report=projectAshareReport(input)!;
  expect(report.rows).toHaveLength(input.rows.length);expect(new Set(report.rows.map(row=>row.id)).size).toBe(input.rows.length);
  report.rows.forEach((row,index)=>{
   expect(row.native_locator).toBe(`rows[${index}].f62`);
   const native=report.native_snapshot.rows[index].f62;
   expect(native).toBe(input.rows[index].f62);
   expect(row.value).toBe(typeof native==='number'?native:null);
   expect(row.state).toBe(typeof native==='number'?'reported':'source_missing_marker');
   expect(row.dimension.id).toBe(input.rows[index].f12);expect(row.dimension.label).toBe(input.rows[index].f14);
   expect(row.metric_id).toBe('eastmoney-ashare.f62');expect(row.role).toBe('provider_scope_member');
  });
  expect(report.rows[2]).toMatchObject({value:0,state:'reported'});
  expect(report.rows.filter(row=>row.state==='source_missing_marker')).toHaveLength(4);
  expect(report.native_snapshot).toEqual(input);
  expect(report.unit).toEqual({code:'CNY',currency:'CNY',currency_multiplier:1});
  expect(report.native_snapshot.field_units.f2).toBe(scope.kind==='industry_rank'?'index_points':'CNY');
  expect(report.rows.every(row=>row.metric_id.endsWith('.f62'))).toBe(true);
 });
 it.each([ROOT,{kind:'industry_rank',fs:'m:90+s:4+f:!50',classification_level:'eastmoney_level_2'},{kind:'industry_rank',fs:'m:90+s:8+f:!50',classification_level:'eastmoney_level_3'},stockScope] satisfies Scope[])('preserves source classification without creating a global industry or exchange identity: $classification_level',scope=>{
  const report=projectAshareReport(ashareReportFixture({scope}))!;
  expect(report.scope).toEqual(scope);expect(report.classification.industry).toEqual({namespace:'Eastmoney',level:scope.classification_level,exclusivity:'not_established'});
  expect(report.rows[0].dimension.namespace).toBe(scope.kind==='industry_rank'?'Eastmoney.industry_board':'Eastmoney.security_code');
  expect(report.classification.instrument).toEqual(scope.kind==='industry_rank'?null:{namespace:'Eastmoney.security_code',exchange_mic:null});
  expect(report.period).toEqual({start:null,end:null,frequency:'unknown',calendar_timezone:'Asia/Shanghai'});
  expect(report.clocks).toMatchObject({source_observed_at:null,trade_date:null,source_released_at:null,source_updated_date:null});
  expect(report.clocks.fetched_at).toBe(new Date(NOW).toISOString());expect(report.clocks.acquisition_started_at).toBe(new Date(NOW-120_000).toISOString());
  expect(report.source).toMatchObject({urls:[ASHARE_FLOW_METHODOLOGY_URL],license_url:null,raw_sha256:null});
  expect(report.measure_scope).toBe('provider_order_flow_proxy');expect(report.whole_market_capital_flow).toBe(false);
  expect(report.aggregation).toMatchObject({cross_source_allowed:false,total_overlaps_components:false});
  expect(report.rows.some(row=>row.role==='reported_total')).toBe(false);
  expect(report.net_direction.positive).toContain('large and extra-large');expect(report.net_direction.negative).toContain('estimated net sales');
 });
 it('does not substitute completion time for absent collection start and labels the filename as acquisition time',()=>{
  const report=projectAshareReport(ashareReportFixture({scope:stockScope,collection:false}))!;
  expect(report.clocks.acquisition_started_at).toBeNull();expect(report.native_snapshot.collection_started_at).toBeUndefined();
  expect(ashareExportFilename(report)).toBe('eastmoney-ashare-BK9000-acquired-20261108T080000000Z-organized.json');
  const root=projectAshareReport(ashareReportFixture())!;
  expect(ashareExportFilename(root)).toContain('eastmoney_level_1-acquired-');
 });
 it('omits unknown row properties instead of exporting passthrough private fields',()=>{
  const input=ashareReportFixture();input.rows[0].private_token='synthetic-omit-me';input.rows[0].extra={nested:'also-omit-me'};
  const report=projectAshareReport(input)!;
  expect(Object.keys(report.native_snapshot.rows[0]).sort()).toEqual(['f12','f14',...numericFields].sort());
  expect(JSON.stringify(report)).not.toContain('synthetic-omit-me');expect(JSON.stringify(report)).not.toContain('also-omit-me');
  expect(report.native_retention).toMatchObject({unknown_row_fields:'omitted',raw_provider_payload:false});
  expect(input.rows[0].private_token).toBe('synthetic-omit-me');
 });
 it('rejects invalid schemas, extra top-level fields, inconsistent scopes/units, incomplete rows and invented dates',()=>{
  const input=ashareReportFixture();
  for(const invalid of [{...input,private_token:'synthetic'}, {...input,unit:'CNY_100_million'}, {...input,trade_date:'2026-11-08'}, {...input,source_observed_at:input.fetched_at}, {...input,field_units:{...input.field_units,f2:'CNY'}}, {...input,scope:{...ROOT,classification_level:'eastmoney_level_2'}}, {...input,source_total:8}, {...input,rows:[{...input.rows[0],f62:undefined}]}])expect(()=>projectAshareReport(invalid)).toThrow();
  expect(projectAshareReport(null)).toBeNull();
 });
});
describe('A-share export visibility is current scope, permission and acquisition bounded',()=>{
 it('uses the existing 24h policy from the oldest acquisition clock, including the exact boundary',()=>{
  const state=ready(),expiry=NOW-120_000+SNAPSHOT_MAX_AGE_MS;
  expect(ashareExportExpiresAt(state.snapshot!)).toBe(expiry);
  expect(visibleAshareExportSnapshot(state,ROOT,expiry-1)).toBe(state.snapshot);
  expect(visibleAshareExportSnapshot(state,ROOT,expiry)).toBeNull();
  expect(visibleAshareExportSnapshot(state,ROOT,NOW-1)).toBeNull();
  expect(visibleAshareExportSnapshot(state,ROOT,null)).toBeNull();expect(visibleAshareExportSnapshot(state,ROOT,NaN)).toBeNull();
  expect(ashareExportExpiresAt(ashareReportFixture({collection:false}))).toBe(NOW+SNAPSHOT_MAX_AGE_MS);
 });
 it.each(['error','blocked','empty'] as const)('does not export inaccessible retained bytes when status is %s',status=>{
  expect(visibleAshareExportSnapshot({...ready(),status},ROOT,NOW)).toBeNull();
 });
 it('suppresses a stopped source and the old-scope snapshot immediately',()=>{
  expect(visibleAshareExportSnapshot({...ready(),recovery:{mode:'stopped',code:'source_denied',retryAt:null,httpStatus:403}},ROOT,NOW)).toBeNull();
  expect(visibleAshareExportSnapshot(ready(),stockScope,NOW)).toBeNull();
  expect(visibleAshareExportSnapshot(ready(),{...ROOT,classification_level:'eastmoney_level_2'},NOW)).toBeNull();
 });
 it('retains marked temporary-failure evidence without rewriting native clocks or flags',()=>{
  const state={...ready(),status:'stale' as const,retainedAfterFailure:true,recovery:{mode:'retry' as const,code:'browser_network',retryAt:NOW+60_000,httpStatus:null}};
  const report=projectAshareReport(visibleAshareExportSnapshot(state,ROOT,NOW),true)!;
  expect(report.presentation.stale).toBe(true);expect(report.native_snapshot.stale).toBe(false);expect(report.native_snapshot.fetched_at).toBe(state.snapshot!.fetched_at);
 });
});
