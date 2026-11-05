/** Synthetic only, no captured financial observations. */
import {parseTpex} from '../lib/tpex/adapter';
import {REFRESH_MS,MAX_CACHE_AGE_MS,type TpexReply} from '../lib/tpex/model';
export const NOW=Date.parse('2026-11-05T07:00:00.000Z'),ISO=new Date(NOW).toISOString();
export function flowRow(code='1001',net=60){return {Date:'1151104',SecuritiesCompanyCode:code,CompanyName:'Synthetic',
 'Foreign Investors include Mainland Area Investors (Foreign Dealers excluded)-Total Buy':String(100+net),
 ' Foreign Investors include Mainland Area Investors (Foreign Dealers excluded)-Total Sell':'100',
 'Foreign Investors include Mainland Area Investors (Foreign Dealers excluded)-Difference':String(net),
 'SecuritiesInvestmentTrustCompanies-TotalBuy':'20','SecuritiesInvestmentTrustCompanies-TotalSell':'10','SecuritiesInvestmentTrustCompanies-Difference':'10',
 'Dealers-TotalBuy':'30','Dealers-TotalSell':'40','Dealers-Difference':'-10',TotalDifference:String(net),
 // These informational foreign-dealer fields must never be double counted.
 'Foreign Dealers-Total Buy':'999','Foreign Dealers-TotalSell':'1','ForeignDealers-Difference':'998'};}
export function company(code='1001',industry='24'){return {Date:'1151104',SecuritiesCompanyCode:code,CompanyAbbreviation:`测试${code}`,SecuritiesIndustryCode:industry};}
export function fixture(){return {flows:[flowRow('1001',60),flowRow('1002',-30),flowRow('00999B',10)],companies:[company('1001'),company('1002','22'),company('1003','24')]};}
export function snapshot(){const f=fixture();return parseTpex(f.flows,f.companies,ISO,ISO);}
export function reply():TpexReply{return {snapshot:snapshot(),status:{state:'available',error_code:null,last_attempt_at:ISO,fetched_at:ISO,cache_age_ms:0,refresh_ms:REFRESH_MS,max_cache_age_ms:MAX_CACHE_AGE_MS,next_retry_at:new Date(NOW+REFRESH_MS).toISOString()}};}
