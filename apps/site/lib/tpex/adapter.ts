import {flowSchema,snapshotSchema,type Flow,type TpexSnapshot} from './model';
export const FLOW_URL='https://www.tpex.org.tw/openapi/v1/tpex_3insti_daily_trading';
export const COMPANY_URL='https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O';
export class TpexError extends Error {constructor(readonly code:string,readonly denied=false,readonly retryAfterMs=0){super(code);}}
function fail(code:string):never{throw new TpexError(code);}
function object(value:unknown){if(!value||typeof value!=='object'||Array.isArray(value))fail('invalid_schema');return value as Record<string,unknown>;}
function text(value:unknown){if(typeof value!=='string'||!value.trim()||value.length>100)fail('invalid_text');return value.trim();}
function code(value:unknown){const v=text(value);if(!/^[A-Z0-9]{4,8}$/.test(v))fail('invalid_security_code');return v;}
function count(value:unknown){if(typeof value!=='string'||! /^-?(?:0|[1-9]\d{0,12})$/.test(value))fail('invalid_share_count');const n=Number(value);if(!Number.isSafeInteger(n))fail('invalid_share_count');return n;}
export function rocDate(value:unknown){if(typeof value!=='string'||!/^\d{7}$/.test(value))fail('invalid_report_date');const date=`${Number(value.slice(0,3))+1911}-${value.slice(3,5)}-${value.slice(5,7)}`;if(!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)fail('invalid_report_date');return date;}
function rows(payload:unknown){if(!Array.isArray(payload)||payload.length===0||payload.length>3000)fail('invalid_row_count');return payload.map(object);}
// Exact provider field names, including its leading space. Foreign dealers are already
// included in dealers: adding them to foreign a second time would double count.
const foreign='Foreign Investors include Mainland Area Investors (Foreign Dealers excluded)-';
export function parseTpex(flowPayload:unknown,companyPayload:unknown,started:string,fetched:string):TpexSnapshot{
 const flows=new Map<string,Flow>(),companies=new Map<string,{code:string;name:string;industry_code:string}>(),flowDates=new Set<string>(),companyDates=new Set<string>();
 for(const raw of rows(flowPayload)){
  const id=code(raw.SecuritiesCompanyCode);if(flows.has(id))fail('duplicate_security');flowDates.add(rocDate(raw.Date));
  const foreignFlow={buy:count(raw[foreign+'Total Buy']),sell:count(raw[' '+foreign+'Total Sell']),net:count(raw[foreign+'Difference'])};
  const trust={buy:count(raw['SecuritiesInvestmentTrustCompanies-TotalBuy']),sell:count(raw['SecuritiesInvestmentTrustCompanies-TotalSell']),net:count(raw['SecuritiesInvestmentTrustCompanies-Difference'])};
  const dealer={buy:count(raw['Dealers-TotalBuy']),sell:count(raw['Dealers-TotalSell']),net:count(raw['Dealers-Difference'])};
  const parsed=flowSchema.safeParse({foreign:foreignFlow,trust,dealer,total:{buy:foreignFlow.buy+trust.buy+dealer.buy,sell:foreignFlow.sell+trust.sell+dealer.sell,net:count(raw.TotalDifference)}});
  if(!parsed.success)fail('invalid_share_balance');flows.set(id,parsed.data);
 }
 for(const raw of rows(companyPayload)){
  const id=code(raw.SecuritiesCompanyCode);if(companies.has(id))fail('duplicate_company');companyDates.add(rocDate(raw.Date));
  const industry=text(raw.SecuritiesIndustryCode);if(!/^\d{2}$/.test(industry))fail('invalid_industry_code');
  companies.set(id,{code:id,name:text(raw.CompanyAbbreviation),industry_code:industry});
 }
 if(flowDates.size!==1||companyDates.size!==1||[...flowDates][0]!==[...companyDates][0])fail('report_date_mismatch');
 const output=[...companies.values()].sort((a,b)=>a.code.localeCompare(b.code)).map(c=>({...c,flow:flows.get(c.code)??null}));
 const parsed=snapshotSchema.safeParse({schema:'tpex-institutional/1',source:'TPEx',market:'Taiwan_OTC_listed_companies',unit:'shares',report_date:[...flowDates][0],classification_date:[...companyDates][0],source_released_at:null,acquisition_started_at:started,fetched_at:fetched,net_capital_flow:null,source_security_count:flows.size,excluded_security_count:[...flows.keys()].filter(id=>!companies.has(id)).length,rows:output});
 if(!parsed.success)fail('invalid_snapshot');return parsed.data;
}
