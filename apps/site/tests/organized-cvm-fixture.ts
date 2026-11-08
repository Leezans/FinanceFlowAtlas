/** Entirely synthetic normalized CVM display data, never downloaded observations. */
import {ATTRIBUTION,MAX_CACHE_AGE_MS,REFRESH_MS,sourceUrls,type CvmReply,type CvmSnapshot} from '../lib/cvm/model';
export const NOW=Date.parse('2026-11-05T00:01:00Z');
export function cvmSnapshot():CvmSnapshot{return {
 schema:'cvm-fund-equity/1',source:'CVM',license:'ODbL-1.0',attribution:ATTRIBUTION,
 source_urls:sourceUrls('2026-09'),source_sha256:{cda:'a'.repeat(64),fca:'b'.repeat(64)},market:'Brazil_B3_equities',unit:'BRL_cents',
 period:'2026-09',report_date:'2026-09-30',classification_date:'2026-11-05',classification_point_in_time:false,
 source_released_at:null,acquisition_started_at:'2026-11-05T00:00:00Z',fetched_at:'2026-11-05T00:01:00Z',net_capital_flow:null,coverage:'public_disclosed_fund_transactions_only',
 counts:{source_rows:6,matched_rows:5,unmatched_rows:0,ambiguous_rows:0,null_amount_rows:1,duplicate_rows:1,confidential_rows:2,public_funds:4,confidential_funds:1},
 rows:[
  {code:'ALPH3',name:'Synthetic Alpha',industry:'Bancos',flow:{buy:2001,sell:1002,net:999},source_rows:2},
  {code:'BETA4',name:'Synthetic Beta',industry:'Energia',flow:null,source_rows:0},
  {code:'GAMM3',name:'Synthetic Gamma',industry:'Bancos',flow:null,source_rows:1},
  {code:'ZERO3',name:'Synthetic Zero',industry:'Bancos',flow:{buy:0,sell:0,net:0},source_rows:1},
  {code:'SELL4',name:'Synthetic Sell',industry:'Energia',flow:{buy:100,sell:500,net:-400},source_rows:1},
 ],
};}
export function cvmReply(snapshot=cvmSnapshot()):CvmReply&{snapshot:CvmSnapshot}{return {snapshot,status:{state:'available',error_code:null,last_attempt_at:snapshot.acquisition_started_at,fetched_at:snapshot.fetched_at,cache_age_ms:0,refresh_ms:REFRESH_MS,max_cache_age_ms:MAX_CACHE_AGE_MS,next_retry_at:null}};}
export function manyCvmSecurities(count:number){
 const snapshot=cvmSnapshot();snapshot.rows=Array.from({length:count},(_,i)=>({...snapshot.rows[0],code:`TEST${String(i).padStart(4,'0')}`}));
 snapshot.counts={source_rows:count*2,matched_rows:count*2,unmatched_rows:0,ambiguous_rows:0,null_amount_rows:0,duplicate_rows:0,confidential_rows:0,public_funds:count,confidential_funds:0};return snapshot;
}
