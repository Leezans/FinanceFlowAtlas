import {CONTRACTS,LEGACY_CONTRACT_CODES,REFRESH_MS,MAX_CACHE_AGE_MS,type CftcReply} from '../lib/futures/model';
import {parseCftc} from '../lib/futures/adapter';
// Synthetic balanced counts only, not captured provider observations.
export const NOW=Date.parse('2026-11-05T05:00:00Z'),ISO=new Date(NOW).toISOString();
export function fixture(){return CONTRACTS.flatMap((c,i)=>['2026-10-27','2026-10-20'].map((date,j)=>({market_and_exchange_names:c.name,cftc_contract_market_code:c.code,contract_units:c.units,futonly_or_combined:'FutOnly',report_date_as_yyyy_mm_dd:`${date}T00:00:00.000`,open_interest_all:'1000',noncomm_positions_long_all:String(300+(i%10)*20-j*10),noncomm_positions_short_all:'200',noncomm_postions_spread_all:'100',comm_positions_long_all:String(400-(i%10)*20+j*10),comm_positions_short_all:'500',nonrept_positions_long_all:'200',nonrept_positions_short_all:'200'})));}
export function reply():CftcReply{return {snapshot:parseCftc(fixture(),ISO,ISO),status:{state:'available',error_code:null,last_attempt_at:ISO,fetched_at:ISO,cache_age_ms:0,refresh_ms:REFRESH_MS,max_cache_age_ms:MAX_CACHE_AGE_MS,next_retry_at:new Date(NOW+REFRESH_MS).toISOString()}};}

export function legacyReply():CftcReply{const value=reply();return {...value,snapshot:{...value.snapshot!,schema:'cftc-legacy-futures/1',coverage:'four_selected_us_cftc_futures_markets',rows:value.snapshot!.rows.filter(row=>LEGACY_CONTRACT_CODES.some(code=>code===row.code))}};}
