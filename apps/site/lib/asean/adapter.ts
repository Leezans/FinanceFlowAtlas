import {z} from 'zod';
import {HOSTS,SECTORS,YEARS} from './dimensions';
import {numericValue,snapshotSchema,type FdiCell,type FdiSnapshot} from './model';
export const FLOW_URL='https://data.aseanstats.org/api/trade';
export const requestBody=()=>new URLSearchParams({Reporter:HOSTS.map(h=>h.code).join(','),Partner:SECTORS.map(s=>s.code).join(','),Year:YEARS.join(','),Frequency:'A',Period:'00',Flow:'F',Commodity:'1',Unit:'114'}).toString();
export class FdiError extends Error{constructor(public readonly code:string,public readonly denied=false,public readonly retryAfterMs=0){super(code);}}
const rowSchema=z.object({Reporter_Code:z.string(),Reporter:z.string().min(1).max(80),Year:z.number().int(),Code:z.string(),ActivityLong:z.string().min(1).max(180),Value:z.string().max(80)}).strict();
const envelope=z.object({CsvUrl:z.literal(''),Trade:z.array(rowSchema).min(1).max(5000),RowLimit:z.null(),RowCount:z.null()}).strict();
export function parseFdi(input:unknown,started:string,fetched:string):FdiSnapshot{
 const parsed=envelope.safeParse(input);if(!parsed.success)throw new FdiError('invalid_source_schema');
 const observations=new Map<string,string[]>();
 for(const row of parsed.data.Trade){
  const host=HOSTS.find(h=>h.code===row.Reporter_Code),sector=SECTORS.find(s=>s.code===row.Code);
  if(!host||!sector||!YEARS.includes(row.Year as typeof YEARS[number])||row.Reporter.trim()!==host.source||row.ActivityLong.trim()!==`[${sector.code}] ${sector.source}`)throw new FdiError('unexpected_source_dimension');
  if(row.Value!=='n.a'&&numericValue(row.Value)===null)throw new FdiError('invalid_source_value');
  const key=`${row.Year}/${host.code}/${sector.code}`,values=observations.get(key)??[];values.push(row.Value);observations.set(key,values);
 }
 const cells:FdiCell[]=YEARS.flatMap(year=>SECTORS.flatMap(sector=>HOSTS.map(host=>{
  const raw_values=observations.get(`${year}/${host.code}/${sector.code}`)??[];
  const state=raw_values.length>1?'duplicate':raw_values.length===0?'missing':raw_values[0]==='n.a'?'source_na':'reported';
  return {host:host.code,sector:sector.code,year,state,value:state==='reported'?numericValue(raw_values[0]):null,raw_values};
 })));
 const result=snapshotSchema.safeParse({schema:'asean-fdi/1',source:'ASEANstats',measure:'annual_net_inward_fdi',unit:'million_USD',source_released_at:null,notes_verified_on:'2026-11-05',portal_update_observed_on:'2026-07-01',acquisition_started_at:started,fetched_at:fetched,source_row_count:parsed.data.Trade.length,cells});
 if(!result.success)throw new FdiError('invalid_snapshot');return result.data;
}
