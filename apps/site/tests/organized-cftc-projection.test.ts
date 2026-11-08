import {describe,expect,it} from 'vitest';
import {projectCftcReport} from '../lib/evidence/cftc-projection';
import {CFTC_DATASET,CFTC_SCHEDULE,CONTRACTS,MAX_CACHE_AGE_MS,MAX_REPORT_AGE_DAYS,visibleSnapshot} from '../lib/futures/model';
import {reply,legacyReply,NOW} from './cftc-fixture';
function nativeValue(snapshot:unknown,path:string){return path.replace(/\[(\d+)\]/g,'.$1').split('.').reduce((value,key)=>(value as Record<string,unknown>)[key],snapshot);}

describe('CFTC current-snapshot organization',()=>{
 it.each([false,true])('retains exact values, contract identity, specification and observation paths (legacy=%s)',legacy=>{
  const snapshot=(legacy?legacyReply():reply()).snapshot!,report=projectCftcReport(snapshot)!;
  expect(report.native_snapshot).toEqual(snapshot);expect(report.native_snapshot).not.toBe(snapshot);
  expect(report.rows).toHaveLength(snapshot.rows.length*16);expect(new Set(report.rows.map(row=>row.id)).size).toBe(report.rows.length);
  for(const row of report.rows){
   expect(nativeValue(report.native_snapshot,row.native_locator)).toBe(row.value);
   expect(nativeValue(report.native_snapshot,row.dimension.native_locator)).toBe(row.dimension.id);
   expect(nativeValue(report.native_snapshot,row.dimension.label_native_locator)).toBe(row.dimension.label);
   expect(nativeValue(report.native_snapshot,row.contract.units_native_locator)).toBe(row.contract.units);
   expect(nativeValue(report.native_snapshot,row.observation.native_locator)).toBe(row.observation.date);
   expect(row.native_locator).toMatch(new RegExp(`\\.${row.observation.slot}\\.${row.metric_id.split('.')[1]}$`));
   expect(row.state).toBe('reported');expect(row.value_origin).toBe('retained_source_position');
  }
  for(const market of snapshot.rows){
   const rows=report.rows.filter(row=>row.dimension.id===market.code);expect(rows).toHaveLength(16);
   expect(rows.filter(row=>row.observation.slot==='current')).toHaveLength(8);expect(rows.filter(row=>row.observation.slot==='previous')).toHaveLength(8);
  }
 });
 it('keeps legacy four-market coverage with differing previous dates without manufacturing 48 missing markets',()=>{
  const snapshot=legacyReply().snapshot!;snapshot.rows[1].previous.date='2026-10-18';
  const report=projectCftcReport(snapshot)!;
  expect(report.native_schema).toBe('cftc-legacy-futures/1');expect(report.coverage).toEqual({scope:'four_selected_us_cftc_futures_markets',market_count:4,category_count:4,legacy:true,global_coverage:false});
  expect(report.period.previous_report_dates).toEqual(['2026-10-18','2026-10-20']);
  expect(report.rows.filter(row=>row.dimension.id===snapshot.rows[1].code&&row.observation.slot==='previous').every(row=>row.observation.date==='2026-10-18')).toBe(true);
  expect(new Set(report.rows.map(row=>row.dimension.id))).toEqual(new Set(snapshot.rows.map(row=>row.code)));
  const expanded=reply().snapshot!;expanded.rows[1].previous.date='2026-10-18';expect(()=>projectCftcReport(expanded)).toThrow();
 });
 it('does not invent a seven-day transaction period, publication clock or domicile',()=>{
  const snapshot=reply().snapshot!;snapshot.rows.forEach(row=>row.previous.date='2026-10-25');
  const report=projectCftcReport(snapshot,true)!;
  expect(report.period).toMatchObject({start:'2026-10-27',end:'2026-10-27',frequency:'weekly',calendar_timezone:null,date_semantics:'point_in_time_positions',current_report_date:'2026-10-27',previous_report_dates:['2026-10-25']});
  expect(report.period.frequency_note).toContain('not a guaranteed seven-day interval');
  expect(report.geography).toEqual({iso3:'USA',role:'reporting_market',underlying_domicile:null});
  expect(report.clocks).toEqual({source_released_at:null,source_updated_date:null,acquisition_started_at:snapshot.acquisition_started_at,fetched_at:snapshot.fetched_at});
  expect(report.presentation).toEqual({stale:true,basis:'current_visible_page_snapshot',row_selection:'all_retained_markets_periods_position_fields'});
 });
 it('retains application categories separately from source classification and keeps each contract specification verbatim',()=>{
  const report=projectCftcReport(reply().snapshot)!;
  expect(report.coverage).toMatchObject({market_count:52,category_count:8,legacy:false,scope:'fifty_two_selected_us_cftc_futures_markets'});
  expect(report.classification.industry).toBeNull();expect(report.classification.category.source_classification).toBe(false);
  expect(new Set(report.rows.map(row=>row.category.id)).size).toBe(8);
  for(const row of report.rows){
   expect(row.category.namespace).toBe('FinanceFlowAtlas.futures_navigation');expect(row.category.origin).toBe('application_manifest');expect(row.category.source_classification).toBe(false);
   expect(row.contract.units).toBe(CONTRACTS.find(contract=>contract.code===row.dimension.id)!.units);expect(row.contract.expiry_scope).toBe('all_expiry_months');
  }
  expect(report.rows.find(row=>row.dimension.id==='146021')!.contract.units).toBe('(50 Index Points)');
  expect(report.unit).toEqual({code:'contracts',currency:null,currency_multiplier:null});
 });
 it('exports only retained positive or zero position fields without calculated net, changes, totals, volume or cash-flow estimates',()=>{
  const snapshot=reply().snapshot!;snapshot.rows[0].current.noncommercial_long=0;snapshot.rows[0].current.commercial_long=700;
  const report=projectCftcReport(snapshot)!;
  expect(report.rows.find(row=>row.dimension.id===snapshot.rows[0].code&&row.observation.slot==='current'&&row.metric_id==='cftc.noncommercial_long')).toMatchObject({value:0,state:'reported'});
  expect(new Set(report.rows.map(row=>row.metric_id))).toEqual(new Set(['open_interest','noncommercial_long','noncommercial_short','spreading','commercial_long','commercial_short','nonreportable_long','nonreportable_short'].map(field=>`cftc.${field}`)));
  expect(report.rows.every(row=>row.role==='position_measure')).toBe(true);
  expect(report.rows.find(row=>row.metric_id==='cftc.spreading')!.position).toEqual({group:'noncommercial',side:'both_sides'});
  expect(report.rows.find(row=>row.metric_id==='cftc.open_interest')!.position).toEqual({group:'all',side:'both_sides'});
  expect(report.aggregation).toMatchObject({cross_source_allowed:false,total_overlaps_components:true,cross_market_allowed:false});
  expect(report.aggregation.rule).toContain('each side separately reconciles');expect(report.aggregation.rule).toContain('spreading enters both side identities');
  expect(report.measure_scope).toBe('futures_positions');expect(report.whole_market_capital_flow).toBe(false);expect(report.net_capital_flow).toBeNull();
 });
 it('preserves correct dataset and release schedule without claiming a license or raw hash',()=>{
  const report=projectCftcReport(reply().snapshot)!;
  expect(report.source).toMatchObject({name:'CFTC',dataset:'6dca-aqww',report_type:'futures_only',urls:[CFTC_DATASET,CFTC_SCHEDULE],license_url:null,raw_sha256:null});
  expect(report.native_retention).toEqual({schema_validation:'strict',unknown_fields:'rejected',raw_provider_payload:false});
 });
 it.each([false,true])('rejects private extras and invalid native fields at every level (legacy=%s)',legacy=>{
  const input=(legacy?legacyReply():reply()).snapshot!;
  const invalid=[{...input,private_token:'synthetic'},{...input,unit:'USD'},{...input,report_type:'combined'}, {...input,rows:input.rows.slice(1)}, {...input,rows:[input.rows[0],...input.rows.slice(0,-1)]},
   ...[{private_token:'synthetic'},{code:'unknown'},{market_name:'invented'},{contract_units:'USD'},{current:{...input.rows[0].current,private_token:'synthetic'}},{previous:{...input.rows[0].previous,private_token:'synthetic'}},{current:{...input.rows[0].current,open_interest:1001}},{current:{...input.rows[0].current,noncommercial_long:null}},{previous:{...input.rows[0].previous,date:input.rows[0].current.date}}].map(patch=>({...input,rows:[{...input.rows[0],...patch},...input.rows.slice(1)]}))];
  for(const value of invalid)expect(()=>projectCftcReport(value)).toThrow();expect(projectCftcReport(null)).toBeNull();
 });
 it('obeys the unchanged inclusive 24-hour cache and 35-day report visibility bounds',()=>{
  const response=reply();expect(projectCftcReport(visibleSnapshot(response,NOW+MAX_CACHE_AGE_MS))).not.toBeNull();
  expect(projectCftcReport(visibleSnapshot(response,NOW+MAX_CACHE_AGE_MS+1))).toBeNull();expect(projectCftcReport(visibleSnapshot(response,NOW-1))).toBeNull();
  const boundary=Date.parse(response.snapshot!.rows[0].current.date)+MAX_REPORT_AGE_DAYS*86_400_000;
  response.snapshot!.fetched_at=response.status.fetched_at=new Date(boundary).toISOString();
  expect(projectCftcReport(visibleSnapshot(response,boundary))).not.toBeNull();expect(projectCftcReport(visibleSnapshot(response,boundary+1))).toBeNull();
  for(const state of ['denied','unavailable'] as const)expect(projectCftcReport(visibleSnapshot({...response,status:{...response.status,state}},boundary))).toBeNull();
 });
});
