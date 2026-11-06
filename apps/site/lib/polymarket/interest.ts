import {z} from 'zod';
import {parseHotPolymarket,PolymarketError} from './adapter';
import {conditionSchema,interestSelection,interestSnapshotSchema,INTEREST_MARKETS,type PolymarketHotSnapshot,type PolymarketInterestSnapshot} from './model';
import {fetchHotPolymarket,fetchOpenInterest} from './transport';
const responseSchema=z.object({data:z.array(z.object({condition_id:conditionSchema,value:z.number().finite().nonnegative().max(1e15)}).strict()).max(INTEREST_MARKETS)}).strict();
/** Missing conditions remain absent, not zero. Duplicate/foreign/global rows reject the batch. */
export function parseOpenInterest(payload:unknown,discovery:PolymarketHotSnapshot,oiStarted:string,fetched:string):PolymarketInterestSnapshot{
 const response=responseSchema.safeParse(payload);
 if(!response.success)throw new PolymarketError('invalid_open_interest');
 const candidate=interestSnapshotSchema.safeParse({schema:'polymarket-open-interest/1',source:'Polymarket Data API v2',coverage:'bounded_hot_market_open_interest',complete_universe:false,total_market_count:null,sample_limit:INTEREST_MARKETS,selection:'first_distinct_standard_conditions_in_hot_window',metric:'priced_gross_open_interest',currency:'USDC',discovery,rows:interestSelection(discovery.rows),values:response.data.data,acquisition_started_at:discovery.acquisition_started_at,oi_request_started_at:oiStarted,fetched_at:fetched,source_observed_at:null,net_capital_flow:null});
 if(!candidate.success)throw new PolymarketError('invalid_open_interest');
 return candidate.data;
}
/** Two bounded requests in the caller's existing lease, deadline and combined byte budget. */
export async function acquireOpenInterest(fetcher:typeof fetch,signal:AbortSignal,now:()=>number,started:number):Promise<PolymarketInterestSnapshot>{
 const budget={bytes:0};
 const raw=await fetchHotPolymarket(fetcher,signal,now,budget);
 const discovery=parseHotPolymarket(raw,new Date(started).toISOString(),new Date(now()).toISOString());
 const selected=interestSelection(discovery.rows);
 if(!selected.length)throw new PolymarketError('no_eligible_conditions');
 const oiStarted=new Date(now()).toISOString();
 const payload=await fetchOpenInterest(selected.map(row=>row.condition_id!),fetcher,signal,now,budget);
 return parseOpenInterest(payload,discovery,oiStarted,new Date(now()).toISOString());
}
