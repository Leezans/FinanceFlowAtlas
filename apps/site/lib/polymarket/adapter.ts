import type {PolymarketCoverage} from './transport';
import {strictJSON} from '../ashare/strict-json';
import {marketSchema,keysetSnapshotSchema,MAX_MARKETS,type PolymarketMarket,type PolymarketKeysetSnapshot} from './model';
export class PolymarketError extends Error {
 constructor(readonly code:string,readonly denied=false,readonly retryAfterMs=0){super(code);}
}
function fail(code:string):never{throw new PolymarketError(code);}
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))fail('invalid_schema');return value as Record<string,unknown>;}
function list(value:unknown):unknown[]{
 if(typeof value==='string'){if(value.length>16_384)fail('invalid_outcomes');value=strictJSON(value);}
 if(!Array.isArray(value)||value.length<2||value.length>16)fail('invalid_outcomes');return value;
}
function nullableInstant(value:unknown):string|null{
 if(value==null||value==='')return null;
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))fail('invalid_timestamp');
 return new Date(value).toISOString();
}
function parseMarket(value:unknown,fetched:string):PolymarketMarket|null{
 const row=object(value);
 // Open does not mean currently accepting orders; expose that independently.
 if(row.active!==true||row.closed!==false||row.archived===true)return null;
 const outcomes=list(row.outcomes),prices=row.outcomePrices==null||row.outcomePrices===''?outcomes.map(()=>null):list(row.outcomePrices);
 if(outcomes.length!==prices.length)fail('invalid_outcomes');
 const rawTags=row.tags??[];if(!Array.isArray(rawTags)||rawTags.length>100)fail('invalid_tags');
 const tags=rawTags.map(value=>{const tag=object(value);if(typeof tag.slug!=='string')fail('invalid_tags');return {slug:tag.slug as string,label:tag.label};}).sort((a,b)=>a.slug<b.slug?-1:a.slug>b.slug?1:0);
 // Do not infer categories from question text. Preserve the provider's category
 // or, if absent, the tag with the smallest slug. This is a display grouping, not an
 // exhaustive, mutually exclusive provider taxonomy.
 const direct=typeof row.category==='string'&&row.category.trim()?row.category.trim():null;
 const category=direct??tags[0]?.label??'未分类';
 const candidate=marketSchema.safeParse({
  id:row.id,question:row.question,category,category_basis:direct?'source_category':tags.length?'source_tag':'unclassified',tags,
  outcomes:outcomes.map((name,index)=>({name,price:prices[index]})),
  volume_24h:row.volume24hr??null,volume_unit:'source_reported',
  source_record_updated_at:nullableInstant(row.updatedAt),source_observed_at:null,
  accepting_orders:row.acceptingOrders??null,
 });
 if(!candidate.success)fail('invalid_market');
 if(candidate.data.source_record_updated_at&&Date.parse(candidate.data.source_record_updated_at)>Date.parse(fetched)+60_000)fail('future_record_timestamp');
 return candidate.data;
}
/** One explicitly bounded sample, not a complete Polymarket universe or totals. */
export function parsePolymarket(payload:unknown,started:string,fetched:string,coverage?:PolymarketCoverage):PolymarketKeysetSnapshot{
 if(!Array.isArray(payload)||payload.length===0||payload.length>MAX_MARKETS)fail('invalid_market_sample');
 const rows:PolymarketMarket[]=[],seen=new Set<string>();let excluded=0;
 for(const value of payload){
  let row:PolymarketMarket|null;
  try{row=parseMarket(value,fetched);}catch(error){if(!(error instanceof PolymarketError))throw error;excluded++;continue;}
  if(!row){excluded++;continue;}
  if(seen.has(row.id))fail('duplicate_market');seen.add(row.id);rows.push(row);
 }
 const candidate=keysetSnapshotSchema.safeParse({schema:'polymarket-gamma/2',source:'Polymarket Gamma',coverage:'bounded_active_market_sample',sample_limit:MAX_MARKETS,source_market_count:payload.length,excluded_market_count:excluded,ordering:'source_id_descending',complete_universe:false,total_market_count:null,pagination:'keyset',source_page_count:coverage?.pageSizes.length??1,source_page_sizes:coverage?.pageSizes??[payload.length],stop_reason:coverage?.stopReason??'source_exhausted',has_more:coverage?.hasMore??false,grouping:'source_category_else_smallest_tag_slug',acquisition_started_at:started,fetched_at:fetched,source_observed_at:null,net_capital_flow:null,rows});
 if(!candidate.success)fail('invalid_snapshot');return candidate.data;
}
