/** Synthetic contracts, not captured provider data. */
import {parseHotPolymarket,parsePolymarket} from '../lib/polymarket/adapter';
import {legacySnapshotSchema,MAX_CACHE_AGE_MS,REFRESH_MS,type PolymarketReply,type PolymarketView} from '../lib/polymarket/model';
import {fixture,ISO,NOW,market} from './polymarket-fixture';
export {ISO,NOW};
export function gammaReply(view:Exclude<PolymarketView,'interest'>='hot',at=NOW):PolymarketReply{
 const iso=new Date(at).toISOString(),snapshot=(view==='hot'?parseHotPolymarket:parsePolymarket)(fixture(),iso,iso);
 snapshot.rows[0].condition_id=`0x${'a'.repeat(64)}`;
 snapshot.rows[0].outcomes[0].price='0.123456789012';
 snapshot.rows[0].outcomes[1].price='1.000000000000';
 return {snapshot,status:{state:'available',error_code:null,last_attempt_at:iso,fetched_at:iso,cache_age_ms:0,refresh_ms:REFRESH_MS,max_cache_age_ms:MAX_CACHE_AGE_MS,next_retry_at:null}};
}
export function legacyGamma(){
 const snapshot=gammaReply('newest').snapshot!;
 const rows=snapshot.rows.map(row=>{const copy={...row};delete copy.condition_id;return copy;});
 return legacySnapshotSchema.parse({schema:'polymarket-gamma/1',source:'Polymarket Gamma',coverage:'bounded_active_market_sample',sample_limit:200,source_market_count:rows.length,excluded_market_count:0,ordering:'source_volume24hr_descending',complete_universe:false,acquisition_started_at:ISO,fetched_at:ISO,source_observed_at:null,net_capital_flow:null,rows});
}
export function largeGamma(count=500,outcomes=16){
 return parsePolymarket(Array.from({length:count},(_,index)=>market(String(count-index),{outcomes:JSON.stringify(Array.from({length:outcomes},(_,i)=>`Outcome ${i}`)),outcomePrices:JSON.stringify(Array.from({length:outcomes},(_,i)=>i===0?'0':i===1?null:'0.000000000001'))})),ISO,ISO,{pageSizes:Array.from({length:Math.ceil(count/100)},(_,index)=>Math.min(100,count-index*100)),stopReason:count===500?'page_limit':'source_exhausted',hasMore:count===500});
}
