import {CONTRACTS,positionSchema,snapshotSchema,type CftcSnapshot} from './model';
export class CftcError extends Error {constructor(readonly code:string,readonly denied=false,readonly retryAfterMs=0){super(code);}}
function fail(code:string):never{throw new CftcError(code);}
const fields={open_interest:'open_interest_all',noncommercial_long:'noncomm_positions_long_all',noncommercial_short:'noncomm_positions_short_all',spreading:'noncomm_postions_spread_all',commercial_long:'comm_positions_long_all',commercial_short:'comm_positions_short_all',nonreportable_long:'nonrept_positions_long_all',nonreportable_short:'nonrept_positions_short_all'} as const;
const selected=['market_and_exchange_names','report_date_as_yyyy_mm_dd','cftc_contract_market_code','contract_units','futonly_or_combined',...Object.values(fields)];
const params=new URLSearchParams({'$select':selected.join(','),'$where':`cftc_contract_market_code in(${CONTRACTS.map(c=>`'${c.code}'`).join(',')})`,'$order':'report_date_as_yyyy_mm_dd DESC,cftc_contract_market_code','$limit':'16'});
export const CFTC_URL=`https://publicreporting.cftc.gov/resource/6dca-aqww.json?${params}`;
function object(value:unknown){if(!value||typeof value!=='object'||Array.isArray(value))fail('invalid_schema');return value as Record<string,unknown>;}
export function parseCftc(payload:unknown,started:string,fetched:string):CftcSnapshot{
 if(!Array.isArray(payload)||payload.length<8||payload.length>16)fail('incomplete_report_set');
 const byCode=new Map<string,ReturnType<typeof positionSchema.parse>[]>(),keys=new Set<string>();
 for(const value of payload){
  const raw=object(value),contract=CONTRACTS.find(c=>c.code===raw.cftc_contract_market_code);
  if(!contract||raw.market_and_exchange_names!==contract.name||raw.contract_units!==contract.units||raw.futonly_or_combined!=='FutOnly')fail('unexpected_contract');
  const date=raw.report_date_as_yyyy_mm_dd;
  if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}T00:00:00(?:\.000)?$/.test(date))fail('invalid_report_date');
  const key=contract.code+date;if(keys.has(key))fail('duplicate_report');keys.add(key);
  const position:Record<string,unknown>={date:date.slice(0,10)};
  for(const [field,source] of Object.entries(fields)){
   const v=raw[source];if(typeof v!=='string'||!/^(?:0|[1-9]\d{0,9})$/.test(v))fail('invalid_contract_count');position[field]=Number(v);
  }
  const result=positionSchema.safeParse(position);if(!result.success)fail('invalid_position_balance');
  const rows=byCode.get(contract.code)??[];rows.push(result.data);byCode.set(contract.code,rows);
 }
 const rows=CONTRACTS.map(contract=>{
  const points=byCode.get(contract.code)?.sort((a,b)=>b.date.localeCompare(a.date));if(!points||points.length<2)fail('incomplete_report_set');
  return {code:contract.code,market_name:contract.name,contract_units:contract.units,current:points[0],previous:points[1]};
 });
 const result=snapshotSchema.safeParse({schema:'cftc-legacy-futures/1',source:'CFTC',dataset:'6dca-aqww',coverage:'four_selected_us_cftc_futures_markets',report_type:'futures_only',unit:'contracts',source_released_at:null,acquisition_started_at:started,fetched_at:fetched,net_capital_flow:null,rows});
 if(!result.success)fail('invalid_snapshot');return result.data;
}
