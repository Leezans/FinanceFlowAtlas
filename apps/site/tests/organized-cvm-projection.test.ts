import {describe,expect,it} from 'vitest';
import {projectCvmReport} from '../lib/evidence/cvm-projection';
import {COMPANY_DATASET,FLOW_DATASET,LICENSE,MAX_CACHE_AGE_MS,MAX_REPORT_AGE_DAYS,visibleSnapshot} from '../lib/cvm/model';
import {cvmReply,cvmSnapshot,manyCvmSecurities,NOW} from './organized-cvm-fixture';
function nativeValue(snapshot:unknown,path:string){return path.replace(/\[(\d+)\]/g,'.$1').split('.').reduce((value,key)=>(value as Record<string,unknown>)[key],snapshot);}

describe('CVM visible evidence projection',()=>{
 it('preserves every native amount in integer cents with exact identity, value and source-count locators',()=>{
  const snapshot=cvmSnapshot(),report=projectCvmReport(snapshot)!;
  expect(report.native_snapshot).toEqual(snapshot);expect(report.native_snapshot).not.toBe(snapshot);
  expect(report.rows).toHaveLength(15);expect(new Set(report.rows.map(row=>row.id)).size).toBe(15);
  for(const [index,security] of snapshot.rows.entries()){
   const rows=report.rows.filter(row=>row.dimension.id===security.code);expect(rows).toHaveLength(3);
   for(const row of rows){
    expect(nativeValue(report.native_snapshot,row.native_locator!)).toBe(row.value);
    expect(nativeValue(report.native_snapshot,row.dimension.native_locator)).toBe(row.dimension.id);
    expect(nativeValue(report.native_snapshot,row.industry.native_locator)).toBe(row.industry.id);
    expect(nativeValue(report.native_snapshot,row.source_rows_locator)).toBe(row.source_rows);
    expect(row.dimension.namespace).toBe('CVM.FCA.Codigo_Negociacao');expect(row.dimension.kind).toBe('instrument');
    expect(row.industry).toEqual({namespace:'CVM.FCA.Setor_Atividade',id:security.industry,label:security.industry,classification_date:snapshot.classification_date,classification_point_in_time:false,native_locator:`rows[${index}].industry`});
    expect(row.expected_metric_locator).toBe(`rows[${index}].flow.${row.metric_id.split('.')[1]}`);
   }
  }
  expect(report.rows.find(row=>row.dimension.id==='ALPH3'&&row.metric_id.endsWith('.buy'))!.value).toBe(2001);
  expect(report.unit).toEqual({code:'BRL_cents',currency:'BRL',currency_multiplier:0.01});
  expect(report.rows.some(row=>row.value!==null&&row.value<0)).toBe(true);
 });
 it('keeps absent or quarantined aggregates unknown, distinct from a reported zero, without inventing per-security reasons',()=>{
  const report=projectCvmReport(cvmSnapshot())!;
  const missing=report.rows.filter(row=>row.value===null);expect(missing).toHaveLength(6);
  for(const row of missing){expect(row.state).toBe('source_aggregate_unavailable');expect(row.value_origin).toBe('source_aggregate_unavailable');expect(row.native_locator).toMatch(/^rows\[[12]\]\.flow$/);}
  expect(missing.some(row=>row.source_rows===0)).toBe(true);expect(missing.some(row=>row.source_rows>0)).toBe(true);
  expect(report.rows.filter(row=>row.dimension.id==='ZERO3'&&row.value===0&&row.state==='reported')).toHaveLength(3);
  expect(report.aggregation.rule).toContain('per-security reasons are not retained');
 });
 it('labels existing adapter aggregation and difference, preserves overlap warnings, and adds no totals',()=>{
  const report=projectCvmReport(cvmSnapshot())!;
  for(const row of report.rows.filter(row=>row.state==='reported')){
   const field=row.metric_id.split('.')[1];
   expect(row.value_origin).toBe(field==='net'?'adapter_difference_of_aggregates':'adapter_sum_of_disclosed_transactions');
   expect(row.source_fields).toEqual(field==='net'?['VL_AQUIS_NEGOC','VL_VENDA_NEGOC']:field==='buy'?['VL_AQUIS_NEGOC']:['VL_VENDA_NEGOC']);
  }
  expect(report.rows.every(row=>row.role==='component')).toBe(true);
  expect(report.aggregation).toMatchObject({cross_source_allowed:false,total_overlaps_components:false});
  expect(report.aggregation.rule).toContain('industry subtotals overlap');expect(report.aggregation.rule).toContain('Public and confidential fund counts may overlap');
  expect(report.net_capital_flow).toBeNull();expect(report.whole_market_capital_flow).toBe(false);
 });
 it('retains archive hashes, licensed provenance, monthly timing and non-point-in-time classification',()=>{
  const input=cvmSnapshot(),report=projectCvmReport(input,true)!;
  expect(report.source).toEqual({name:'CVM',urls:[input.source_urls.cda,FLOW_DATASET,input.source_urls.fca,COMPANY_DATASET],license_url:LICENSE,license:input.license,attribution:input.attribution,raw_sha256:input.source_sha256,hash_scope:'source_archives'});
  expect(report.period).toEqual({observation_month:'2026-09',start:'2026-09-01',end:'2026-09-30',frequency:'monthly',calendar_timezone:null});
  expect(report.clocks).toEqual({source_released_at:null,source_updated_date:null,classification_date:'2026-11-05',acquisition_started_at:input.acquisition_started_at,fetched_at:input.fetched_at});
  expect(report.classification.industry.classification_point_in_time).toBe(false);expect(report.classification.instrument.exchange_mic).toBeNull();
  expect(report.coverage).toEqual({market:input.market,scope:input.coverage,security_count:5,known_security_count:3,unavailable_security_count:2,counts:input.counts});
  expect(report.presentation).toEqual({stale:true,basis:'current_visible_page_snapshot',row_selection:'all_catalog_securities'});
 });
 it('does not merge identical security labels or differently named industry identities',()=>{
  const input=cvmSnapshot();input.rows[1].name=input.rows[0].name;input.rows[1].industry='Bancos ';
  const report=projectCvmReport(input)!;expect(new Set(report.rows.map(row=>row.id)).size).toBe(15);
  expect(new Set(report.rows.filter(row=>row.dimension.label===input.rows[0].name).map(row=>row.industry.id))).toEqual(new Set(['Bancos','Bancos ']));
 });
 it('rejects private extras at every native level and invalid units, periods, provenance and aggregate balances',()=>{
  const input=cvmSnapshot();
  const invalid=[{...input,private_token:'synthetic'}, {...input,unit:'BRL'}, {...input,classification_point_in_time:true}, {...input,classification_date:input.report_date}, {...input,period:'2026-08'}, {...input,source_urls:{...input.source_urls,private_token:'synthetic'}}, {...input,source_sha256:{...input.source_sha256,private_token:'synthetic'}}, {...input,source_sha256:{...input.source_sha256,cda:'invalid'}}, {...input,counts:{...input.counts,fund_ids:['synthetic']}}, {...input,rows:[{...input.rows[0],CNPJ_FUNDO_CLASSE:'synthetic'},...input.rows.slice(1)]}, {...input,rows:[{...input.rows[0],flow:{...input.rows[0].flow,private_token:'synthetic'}},...input.rows.slice(1)]}, {...input,rows:[{...input.rows[0],flow:{...input.rows[0].flow,net:0}},...input.rows.slice(1)]}, {...input,rows:[...input.rows,input.rows[0]]}];
  for(const value of invalid)expect(()=>projectCvmReport(value)).toThrow();
  expect(projectCvmReport(null)).toBeNull();
  expect(projectCvmReport(input)!.native_retention).toEqual({schema_validation:'strict',unknown_fields:'rejected',raw_provider_payload:false});
 });
 it('retains all 3000 allowed securities without introducing a partial export',()=>{
  const report=projectCvmReport(manyCvmSecurities(3000))!;
  expect(report.rows).toHaveLength(9000);expect(report.native_snapshot.rows).toHaveLength(3000);
  expect(report.coverage.known_security_count).toBe(3000);expect(new Set(report.rows.map(row=>row.id)).size).toBe(9000);
 });
 it('uses the unchanged inclusive 7-day cache and 180-day report visibility policy',()=>{
  const reply=cvmReply();expect(projectCvmReport(visibleSnapshot(reply,NOW+MAX_CACHE_AGE_MS))).not.toBeNull();
  expect(projectCvmReport(visibleSnapshot(reply,NOW+MAX_CACHE_AGE_MS+1))).toBeNull();expect(projectCvmReport(visibleSnapshot(reply,NOW-1))).toBeNull();
  const boundary=Date.parse(reply.snapshot.report_date)+MAX_REPORT_AGE_DAYS*86_400_000;
  reply.snapshot.fetched_at=reply.status.fetched_at=new Date(boundary).toISOString();reply.snapshot.classification_date=reply.snapshot.fetched_at.slice(0,10);
  expect(projectCvmReport(visibleSnapshot(reply,boundary))).not.toBeNull();expect(projectCvmReport(visibleSnapshot(reply,boundary+1))).toBeNull();
  for(const state of ['denied','unavailable'] as const)expect(projectCvmReport(visibleSnapshot({...reply,status:{...reply.status,state}},boundary))).toBeNull();
 });
});
