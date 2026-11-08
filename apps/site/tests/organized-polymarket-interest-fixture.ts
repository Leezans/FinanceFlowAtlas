/** Synthetic contracts only; no captured provider records. */
import {parseHotPolymarket} from '../lib/polymarket/adapter';
import {legacyInterestSnapshotSchema,batchedInterestSnapshotSchema,interestSelection,snapshotCacheTime,type PolymarketInterestSnapshot,type PolymarketHotSnapshot,type PolymarketReply} from '../lib/polymarket/model';
import {market,NOW,ISO} from './polymarket-fixture';
export {NOW,ISO};
export const iso=(at:number)=>new Date(at).toISOString();
export const condition=(n:number)=>`0x${String(n).padStart(64,'0')}`;
export function interestDiscovery(count=45,at=NOW){
 return parseHotPolymarket(Array.from({length:count},(_,index)=>market(String(count-index),{conditionId:condition(count-index),question:`Synthetic OI market ${count-index}?`,volume24hr:count-index,updatedAt:iso(at-60_000)})),iso(at-8_000),iso(at-7_000));
}
export function organizedInterest(kind:'legacy'|'batched'='batched',at=NOW,discovery:PolymarketHotSnapshot=interestDiscovery(45,at)){
 const limit=kind==='legacy'?20:40,rows=interestSelection(discovery.rows,limit);
 // Returned order deliberately differs from selected order within each batch.
 const all=rows.flatMap((row,index)=>index===9||index===29?[]:[{condition_id:row.condition_id!,value:index===19?0:index+0.125}]);
 const batches=Array.from({length:Math.ceil(rows.length/20)},(_,index)=>{
  const condition_ids=rows.slice(index*20,(index+1)*20).map(row=>row.condition_id!);
  return {condition_ids,returned_condition_ids:all.filter(value=>condition_ids.includes(value.condition_id)).reverse().map(value=>value.condition_id),requested_at:iso(at-(index===0?6_000:3_000)),fetched_at:iso(at-(index===0&&rows.length>20?4_000:0))};
 });
 const values=batches.flatMap(batch=>batch.returned_condition_ids.map(id=>all.find(value=>value.condition_id===id)!));
 const base={schema:'polymarket-open-interest/1',source:'Polymarket Data API v2',coverage:'bounded_hot_market_open_interest',complete_universe:false,total_market_count:null,sample_limit:20,selection:'first_distinct_standard_conditions_in_hot_window',metric:'priced_gross_open_interest',currency:'USDC',discovery,rows,values,acquisition_started_at:discovery.acquisition_started_at,oi_request_started_at:batches[0].requested_at,fetched_at:iso(at),source_observed_at:null,net_capital_flow:null};
 return kind==='legacy'?legacyInterestSnapshotSchema.parse(base):batchedInterestSnapshotSchema.parse({...base,schema:'polymarket-open-interest/2',sample_limit:40,batch_size:20,batches});
}
export function interestReply(snapshot:PolymarketInterestSnapshot=organizedInterest()):PolymarketReply{
 return {snapshot,status:{state:'available',error_code:null,last_attempt_at:snapshot.acquisition_started_at,fetched_at:snapshot.fetched_at,cache_age_ms:Date.now()-snapshotCacheTime(snapshot),refresh_ms:300_000,max_cache_age_ms:600_000,next_retry_at:iso(Date.parse(snapshot.fetched_at)+300_000),source_next_retry_at:iso(Date.parse(snapshot.fetched_at)+30_000)}};
}
