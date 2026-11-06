import {z} from 'zod';
import {parseHotPolymarket,PolymarketError} from './adapter';
import {conditionSchema,interestSelection,legacyInterestSnapshotSchema,batchedInterestSnapshotSchema,interestBatchSchema,INTEREST_BATCH_SIZE,INTEREST_MARKETS,LEGACY_INTEREST_MARKETS,INTEREST_COLLECTION_BUDGET_MS,type PolymarketHotSnapshot,type PolymarketInterestSnapshot,type PolymarketBatchedInterestSnapshot,type PolymarketInterestBatch} from './model';
import {fetchHotPolymarket,fetchOpenInterest} from './transport';
const responseSchema=z.object({data:z.array(z.object({condition_id:conditionSchema,value:z.number().finite().nonnegative().max(1e15)}).strict()).max(INTEREST_BATCH_SIZE)}).strict();
/** Historical single-batch decoder, retained for legacy cache compatibility tests. */
export function parseOpenInterest(payload:unknown,discovery:PolymarketHotSnapshot,oiStarted:string,fetched:string):PolymarketInterestSnapshot{
 const response=responseSchema.safeParse(payload);
 if(!response.success)throw new PolymarketError('invalid_open_interest');
 const candidate=legacyInterestSnapshotSchema.safeParse({schema:'polymarket-open-interest/1',source:'Polymarket Data API v2',coverage:'bounded_hot_market_open_interest',complete_universe:false,total_market_count:null,sample_limit:LEGACY_INTEREST_MARKETS,selection:'first_distinct_standard_conditions_in_hot_window',metric:'priced_gross_open_interest',currency:'USDC',discovery,rows:interestSelection(discovery.rows,LEGACY_INTEREST_MARKETS),values:response.data.data,acquisition_started_at:discovery.acquisition_started_at,oi_request_started_at:oiStarted,fetched_at:fetched,source_observed_at:null,net_capital_flow:null});
 if(!candidate.success)throw new PolymarketError('invalid_open_interest');
 return candidate.data;
}
/** A batch validates independently before any following source request. */
export function parseOpenInterestBatch(payload:unknown,conditions:string[],started:string,fetched:string){
 const response=responseSchema.safeParse(payload);
 if(!response.success)throw new PolymarketError('invalid_open_interest');
 const batch=interestBatchSchema.safeParse({condition_ids:conditions,returned_condition_ids:response.data.data.map(row=>row.condition_id),requested_at:started,fetched_at:fetched});
 if(!batch.success)throw new PolymarketError('invalid_open_interest');
 return {batch:batch.data,values:response.data.data};
}
/** One discovery and at most two sequential OI batches share the caller's
 * existing lease, abort signal, 12s deadline and combined byte budget.
 * Nothing is published until every planned batch validates. */
export async function acquireOpenInterest(fetcher:typeof fetch,signal:AbortSignal,now:()=>number,started:number):Promise<PolymarketBatchedInterestSnapshot>{
 const budget={bytes:0};
 const checkBudget=()=>{if(signal.aborted)throw new PolymarketError('source_aborted');if(now()-started>=INTEREST_COLLECTION_BUDGET_MS)throw new PolymarketError('timeout');};
 checkBudget();
 const raw=await fetchHotPolymarket(fetcher,signal,now,budget);
 const discovery=parseHotPolymarket(raw,new Date(started).toISOString(),new Date(now()).toISOString());
 // This fixed cohort is never replenished or reranked between requests.
 const selected=interestSelection(discovery.rows),batches:PolymarketInterestBatch[]=[],values:PolymarketInterestSnapshot['values']=[];
 if(!selected.length)throw new PolymarketError('no_eligible_conditions');
 for(let offset=0;offset<selected.length;offset+=INTEREST_BATCH_SIZE){
  checkBudget();
  const conditions=selected.slice(offset,offset+INTEREST_BATCH_SIZE).map(row=>row.condition_id!);
  const requested=new Date(now()).toISOString();
  const payload=await fetchOpenInterest(conditions,fetcher,signal,now,budget);
  const parsed=parseOpenInterestBatch(payload,conditions,requested,new Date(now()).toISOString());
  checkBudget();batches.push(parsed.batch);values.push(...parsed.values);
 }
 const candidate=batchedInterestSnapshotSchema.safeParse({schema:'polymarket-open-interest/2',source:'Polymarket Data API v2',coverage:'bounded_hot_market_open_interest',complete_universe:false,total_market_count:null,sample_limit:INTEREST_MARKETS,selection:'first_distinct_standard_conditions_in_hot_window',metric:'priced_gross_open_interest',currency:'USDC',discovery,rows:selected,values,batch_size:INTEREST_BATCH_SIZE,batches,acquisition_started_at:discovery.acquisition_started_at,oi_request_started_at:batches[0].requested_at,fetched_at:batches[batches.length-1].fetched_at,source_observed_at:null,net_capital_flow:null});
 if(!candidate.success)throw new PolymarketError('invalid_open_interest');
 return candidate.data;
}
