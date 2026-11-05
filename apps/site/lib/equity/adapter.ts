import {z} from 'zod';
import {countries,day,INDICATORS,snapshotSchema,type EquitySnapshot,type EquityMetric} from './model';
export class EquityError extends Error{constructor(readonly code:string,readonly denied=false,readonly retryAfterMs=0){super(code);}}
export function sourceUrl(now:number){
 const end=new Date(now).getUTCFullYear()-1;
 return `https://api.worldbank.org/v2/country/all/indicator/CM.MKT.LCAP.CD;CM.MKT.TRAD.CD?source=2&date=${end-2}:${end}&format=json&per_page=5000`;
}
const integer=z.union([z.number(),z.string().regex(/^\d+$/)]).transform(Number).refine(Number.isSafeInteger);
const header=z.object({page:integer,pages:integer,per_page:integer,total:integer,lastupdated:day});
const sourceRow=z.object({indicator:z.object({id:z.enum(['CM.MKT.LCAP.CD','CM.MKT.TRAD.CD']),value:z.string()}),country:z.object({id:z.string(),value:z.string()}),countryiso3code:z.string(),date:z.string().regex(/^\d{4}$/),value:z.number().finite().nonnegative().max(1e15).nullable(),unit:z.literal(''),scale:z.literal('').optional(),obs_status:z.literal(''),decimal:z.literal(0)});
/** A complete bounded API page only; unknown schema, pagination and duplicates fail closed. */
export function parseEquity(value:unknown,started:string,fetched:string):EquitySnapshot{
 const parsed=z.tuple([header,z.array(sourceRow).min(1).max(5000)]).safeParse(value);
 if(!parsed.success)throw new EquityError('invalid_source_schema');
 const [meta,observations]=parsed.data,end=new Date(started).getUTCFullYear()-1;
 if(meta.page!==1||meta.pages!==1||meta.total!==observations.length||meta.per_page<meta.total)throw new EquityError('incomplete_source_page');
 const rows=new Map<string,EquitySnapshot['rows'][number]>(),seen=new Set<string>(),indicators=new Set<string>();
 for(const o of observations){
  const year=Number(o.date),key=`${o.country.id}:${o.indicator.id}:${year}`;
  if(year<end-2||year>end||seen.has(key))throw new EquityError('inconsistent_source_rows');
  seen.add(key);indicators.add(o.indicator.id);
  // The all-country API includes regional/income aggregates. Never turn those into countries.
  const country=countries.get(o.countryiso3code);if(!country)continue;
  if(country.iso2!==o.country.id)throw new EquityError('country_code_mismatch');
  if(o.value===null)continue;
  const metric=(Object.keys(INDICATORS) as EquityMetric[]).find(m=>INDICATORS[m]===o.indicator.id)!;
  const row=rows.get(o.countryiso3code)??{iso3:o.countryiso3code,capitalization:null,traded_value:null};
  if(row[metric]===null||year>row[metric]!.year)row[metric]={year,usd:o.value};
  rows.set(o.countryiso3code,row);
 }
 if(indicators.size!==2)throw new EquityError('missing_indicator');
 const result=snapshotSchema.safeParse({schema:'worldbank-equity/1',source:'World Bank / WFE',license:'CC BY 4.0',frequency:'annual',unit:'current USD',net_capital_flow:null,window_start:end-2,window_end:end,dataset_updated:meta.lastupdated,source_released_at:null,acquisition_started_at:started,fetched_at:fetched,rows:[...rows.values()].sort((a,b)=>a.iso3.localeCompare(b.iso3))});
 if(!result.success)throw new EquityError('invalid_snapshot');return result.data;
}
