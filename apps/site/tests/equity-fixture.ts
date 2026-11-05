import {INDICATORS,REFRESH_MS,MAX_CACHE_AGE_MS,type EquityReply} from '../lib/equity/model';
import {parseEquity} from '../lib/equity/adapter';
// Test-only invented values. No captured provider observations are committed.
export const NOW=Date.parse('2026-11-05T06:00:00Z'),ISO=new Date(NOW).toISOString();
export function sourceRow(iso3='USA',iso2='US',indicator:string=INDICATORS.capitalization,year=2025,value:number|null=1_000_000_000){return {indicator:{id:indicator,value:'Synthetic indicator'},country:{id:iso2,value:'Synthetic country'},countryiso3code:iso3,date:String(year),value,unit:'',obs_status:'',decimal:0};}
export function fixture(){
 const observations=[sourceRow(),sourceRow('USA','US',INDICATORS.traded_value,2025,2_000_000_000),sourceRow('USA','US',INDICATORS.capitalization,2024,900_000_000),sourceRow('JPN','JP',INDICATORS.capitalization,2025,200_000_000),sourceRow('JPN','JP',INDICATORS.traded_value,2025,null),sourceRow('JPN','JP',INDICATORS.traded_value,2024,150_000_000),sourceRow('WLD','1W',INDICATORS.capitalization,2025,5_000_000_000),sourceRow('','XD',INDICATORS.capitalization,2025,3_000_000_000),sourceRow('','XM',INDICATORS.capitalization,2025,3_000_000_000)];
 return [{page:1,pages:1,per_page:5000,total:observations.length,lastupdated:'2026-10-01'},observations] as const;
}
export function reply():EquityReply{return {snapshot:parseEquity(fixture(),ISO,ISO),status:{state:'available',error_code:null,last_attempt_at:ISO,fetched_at:ISO,cache_age_ms:0,refresh_ms:REFRESH_MS,max_cache_age_ms:MAX_CACHE_AGE_MS,next_retry_at:new Date(NOW+REFRESH_MS).toISOString()}};}
