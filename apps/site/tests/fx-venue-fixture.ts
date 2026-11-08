import {parseKrakenTicker,parseKrakenUniverse,MAX_CACHE_AGE_MS,type KrakenReply} from '../lib/crypto/kraken';
import {parseKrakenTrades,tradeSnapshot} from '../lib/crypto/trades';
import {FX_VENUE_PAIRS} from '../lib/fx/venue';
import {pairMetadata} from './kraken-fixture';
// Entirely synthetic observations. Never captured provider quotes.
export const fxVenueAt=Date.parse('2026-11-05T03:00:00Z');
export const fxVenueCatalog=()=>({error:[],result:{AUDUSD:pairMetadata('ZAUD','AUD'),ZEURZUSD:pairMetadata('ZEUR','EUR'),ZGBPZUSD:pairMetadata('ZGBP','GBP'),XXBTZUSD:pairMetadata('XXBT','XBT'),USDCUSD:pairMetadata('USDC')}});
export const fxVenueTicker=()=>({error:[],result:Object.fromEntries(Object.keys(fxVenueCatalog().result).map((source,index)=>[source,{c:[String(index+2),'1'],v:['999','7.12500'],p:['999','3'],t:[999,7]}]))});
export function fxVenueReply(window:'1m'|'5m'='5m',at=fxVenueAt):KrakenReply{
 const iso=new Date(at).toISOString(),universe=parseKrakenUniverse(fxVenueCatalog(),iso),snapshot=parseKrakenTicker(fxVenueTicker(),iso,iso,universe);
 const ms=window==='1m'?60_000:300_000;
 const rows=snapshot.rows.filter(row=>(FX_VENUE_PAIRS as readonly string[]).includes(row.pair)).map(pair=>parseKrakenTrades({error:[],result:{[pair.source_pair]:[['3','2',(at-10_000)/1000,'b','m','',1]],last:String(BigInt(at)*BigInt(1_000_000))}},{source_pair:pair.source_pair,pair:pair.pair,base:pair.base,quote:pair.quote},at-ms,at,at));
 return {requested_pairs:[...FX_VENUE_PAIRS],...(window==='1m'?{requested_window:window}:{}),snapshot,trade_snapshot:tradeSnapshot(rows,at,at,FX_VENUE_PAIRS,window),status:{state:'available',error_code:null,last_attempt_at:iso,fetched_at:iso,cache_age_ms:0,refresh_ms:60_000,max_cache_age_ms:MAX_CACHE_AGE_MS,next_retry_at:iso}};
}
