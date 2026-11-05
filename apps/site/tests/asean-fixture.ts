/** Synthetic observations only. No provider financial data committed to Git. */
import {parseFdi} from '../lib/asean/adapter';
import {HOSTS,SECTORS} from '../lib/asean/dimensions';
import {REFRESH_MS,MAX_CACHE_AGE_MS,type FdiReply} from '../lib/asean/model';
export const NOW=Date.parse('2026-11-05T07:00:00.000Z'),ISO=new Date(NOW).toISOString();
export function row(host='PH',sector='C',year=2025,value='120'){return {Reporter_Code:host,Reporter:` ${HOSTS.find(h=>h.code===host)!.source}`,Year:year,Code:sector,ActivityLong:`[${sector}] ${SECTORS.find(s=>s.code===sector)!.source}`,Value:value};}
export function fixture(){return {CsvUrl:'',Trade:[row(),row('SG','C',2025,'-45'),row('BN','C',2025,'0'),row('MY','C',2025,'n.a'),row('PH','Z',2025,'15'),row('PH','Z',2025,'-0.01'),row('PH','C',2024,'20')],RowLimit:null,RowCount:null};}
export const snapshot=()=>parseFdi(fixture(),ISO,ISO);
export const reply=():FdiReply=>({snapshot:snapshot(),status:{state:'available',error_code:null,last_attempt_at:ISO,fetched_at:ISO,cache_age_ms:0,refresh_ms:REFRESH_MS,max_cache_age_ms:MAX_CACHE_AGE_MS,next_retry_at:new Date(NOW+REFRESH_MS).toISOString()}});
