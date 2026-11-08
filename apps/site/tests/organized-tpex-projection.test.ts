import {describe,expect,it} from 'vitest';
import {projectTpexShareReport} from '../lib/evidence/tpex-share-projection';
import {COMPANY_DATASET,FLOW_DATASET,LICENSE,PARTICIPANTS,MAX_CACHE_AGE_MS,MAX_REPORT_AGE_DAYS,DAY_MS,visibleSnapshot} from '../lib/tpex/model';
import {COMPANY_URL,FLOW_URL} from '../lib/tpex/adapter';
import {INDUSTRY_REFERENCE} from '../lib/tpex/industries';
import {NOW,ISO} from './tpex-fixture';
import {tpexShareSnapshot,tpexShareReply} from './organized-tpex-fixture';
function nativeValue(snapshot:unknown,path:string){return path.replace(/\[(\d+)\]/g,'.$1').split('.').reduce((value,key)=>(value as Record<string,unknown>)[key],snapshot);}

describe('TPEx company shares evidence projection',()=>{
 it('keeps all company × participant × metric rows with resolvable native values and missing-flow nulls',()=>{
  const input=tpexShareSnapshot(),report=projectTpexShareReport(input)!;
  expect(report.native_snapshot).toEqual(input);expect(report.native_snapshot).not.toBe(input);
  expect(report.rows).toHaveLength(input.rows.length*12);expect(new Set(report.rows.map(row=>row.id)).size).toBe(report.rows.length);
  for(const [index,company] of input.rows.entries()){
   const rows=report.rows.filter(row=>row.dimension.id===company.code);expect(rows).toHaveLength(12);
   expect(new Set(rows.map(row=>row.participant.id))).toEqual(new Set(PARTICIPANTS.map(p=>p.id)));
   for(const row of rows){
    expect(row.value).toBe(nativeValue(input,row.native_locator!));
    expect(row.dimension).toEqual({namespace:'TPEx.security_code',kind:'instrument',id:company.code,label:company.name,native_locator:`rows[${index}].code`});
    expect(row.industry).toMatchObject({namespace:'TPEx.industry_code',id:company.industry_code,classification_date:input.classification_date,native_locator:`rows[${index}].industry_code`});
    expect(nativeValue(input,row.industry.native_locator)).toBe(row.industry.id);
    expect(row.expected_metric_locator).toBe(`rows[${index}].flow.${row.participant.id}.${row.metric_id.split('.')[1]}`);
    expect(row.role).toBe(row.participant.id==='total'?'participant_total':'component');
    if(company.flow===null){expect(row.state).toBe('source_record_missing');expect(row.native_locator).toBe(`rows[${index}].flow`);expect(row.value_origin).toBe('source_record_missing');}
    else expect(row.state).toBe('reported');
   }
  }
  expect(report.rows.filter(row=>row.value===null)).toHaveLength(12);
  expect(report.rows.filter(row=>row.dimension.id==='1004'&&row.value===0&&row.state==='reported')).toHaveLength(12);
  expect(report.rows.some(row=>row.value!==null&&row.value<0)).toBe(true);
 });
 it('preserves participant overlap and adapter-derived total buy/sell without calling them official reported totals',()=>{
  const report=projectTpexShareReport(tpexShareSnapshot())!;
  expect(report.rows.filter(row=>row.value_origin==='adapter_sum_of_participants')).toHaveLength(6);
  for(const row of report.rows.filter(row=>row.state==='reported'))expect(row.value_origin).toBe(row.participant.id==='total'&&row.metric_id!=='tpex-shares.net'?'adapter_sum_of_participants':'source_reported');
  expect(report.rows.find(row=>row.dimension.id==='1001'&&row.participant.id==='total'&&row.metric_id==='tpex-shares.buy')?.value).toBe(210);
  expect(report.rows.filter(row=>row.role==='reported_total')).toHaveLength(0);
  expect(report.aggregation).toMatchObject({cross_source_allowed:false,total_overlaps_components:true});
  expect(report.aggregation.rule).toContain('Foreign excludes foreign dealers');
  expect(report.rows.find(row=>row.participant.id==='foreign')?.participant.label).toContain('不含外资自营商');
 });
 it('retains share units, exact coverage, source links and distinct report/classification/acquisition clocks',()=>{
  const input=tpexShareSnapshot(),report=projectTpexShareReport(input,true)!;
  expect(report.source_id).toBe('tpex-shares');expect(report.native_schema).toBe('tpex-institutional/1');
  expect(report.unit).toEqual({code:'shares',currency:null,currency_multiplier:null});
  expect(report.period).toEqual({start:input.report_date,end:input.report_date,frequency:'daily',calendar_timezone:'Asia/Taipei'});
  expect(report.clocks).toEqual({source_released_at:null,source_updated_date:null,classification_date:input.classification_date,acquisition_started_at:ISO,fetched_at:ISO});
  expect(report.coverage).toEqual({market:'Taiwan_OTC_listed_companies',company_count:4,matched_company_count:3,missing_company_count:1,source_security_count:4,excluded_security_count:1});
  expect(report.source).toMatchObject({urls:[FLOW_URL,FLOW_DATASET,COMPANY_URL,COMPANY_DATASET,INDUSTRY_REFERENCE],license_url:LICENSE,raw_sha256:null});
  expect(report.geography).toEqual({iso3:'TWN',role:'local_market'});expect(report.whole_market_capital_flow).toBe(false);
  expect(report.classification.industry).toEqual({namespace:'TPEx.industry_code',date:input.classification_date,reference_url:INDUSTRY_REFERENCE});
  expect(report.classification.instrument.exchange_mic).toBeNull();
  expect(report.rows.find(row=>row.industry.id==='99')?.industry.label).toContain('名称未核验');
  expect(report.presentation).toEqual({stale:true,basis:'current_visible_page_snapshot',row_selection:'all_companies_and_participants'});
  expect(report.native_snapshot).toEqual(input);expect(report.rows.every(row=>row.dimension.kind==='instrument')).toBe(true);
 });
 it('keeps source codes distinct even when company labels are identical',()=>{
  const input=tpexShareSnapshot();input.rows[1].name=input.rows[0].name;
  const report=projectTpexShareReport(input)!;
  expect(report.rows.filter(row=>row.dimension.label===input.rows[0].name)).toHaveLength(24);
  expect(new Set(report.rows.map(row=>row.id)).size).toBe(48);
  expect(new Set(report.rows.filter(row=>row.dimension.label===input.rows[0].name).map(row=>row.industry.id))).toEqual(new Set(['24','22']));
 });
 it('strictly rejects unknown fields at every native level, wrong units, dates, duplicates and changed balances',()=>{
  const input=tpexShareSnapshot();
  const invalid=[{...input,private_token:'synthetic'}, {...input,unit:'TWD'}, {...input,schema:'tpex-summary/1'}, {...input,classification_date:'2026-11-03'}, {...input,source_security_count:99}, {...input,rows:[...input.rows,input.rows[0]]}, {...input,rows:[{...input.rows[0],private_token:'synthetic'},...input.rows.slice(1)]}, {...input,rows:[{...input.rows[0],flow:{...input.rows[0].flow,extra:'synthetic'}},...input.rows.slice(1)]}, {...input,rows:[{...input.rows[0],flow:{...input.rows[0].flow,foreign:{...input.rows[0].flow!.foreign,extra:'synthetic'}}},...input.rows.slice(1)]}, {...input,rows:[{...input.rows[0],flow:{...input.rows[0].flow,total:{...input.rows[0].flow!.total,net:123}}},...input.rows.slice(1)]}];
  invalid.forEach(value=>expect(()=>projectTpexShareReport(value)).toThrow());
  expect(projectTpexShareReport(null)).toBeNull();
  expect(projectTpexShareReport(input)!.native_retention).toEqual({schema_validation:'strict',unknown_fields:'rejected',raw_provider_payload:false});
 });
 it('does not truncate the maximum valid native snapshot',()=>{
  const input=tpexShareSnapshot();input.rows=Array.from({length:3000},(_,index)=>({...input.rows[0],code:String(1000+index),flow:index===0?input.rows[0].flow:null}));input.source_security_count=1;input.excluded_security_count=0;
  const report=projectTpexShareReport(input)!;expect(report.rows).toHaveLength(36_000);expect(report.native_snapshot.rows).toHaveLength(3000);
  expect(report.coverage.missing_company_count).toBe(2999);
 });
});
describe('TPEx export uses the unchanged source visibility policy',()=>{
 it('preserves inclusive 24-hour cache and 14-day report boundaries and never exports denied states',()=>{
  const reply=tpexShareReply();
  expect(projectTpexShareReport(visibleSnapshot(reply,NOW+MAX_CACHE_AGE_MS))).not.toBeNull();
  expect(projectTpexShareReport(visibleSnapshot(reply,NOW+MAX_CACHE_AGE_MS+1))).toBeNull();
  expect(projectTpexShareReport(visibleSnapshot(reply,NOW-1))).toBeNull();
  const boundary=Date.parse(reply.snapshot.report_date)-8*3_600_000+MAX_REPORT_AGE_DAYS*DAY_MS;
  reply.snapshot.fetched_at=new Date(boundary).toISOString();reply.status.fetched_at=reply.snapshot.fetched_at;
  expect(projectTpexShareReport(visibleSnapshot(reply,boundary))).not.toBeNull();
  expect(projectTpexShareReport(visibleSnapshot(reply,boundary+1))).toBeNull();
  for(const state of ['denied','unavailable'] as const)expect(projectTpexShareReport(visibleSnapshot({...reply,status:{...reply.status,state}},boundary))).toBeNull();
 });
});
