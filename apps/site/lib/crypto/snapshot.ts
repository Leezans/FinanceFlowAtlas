/** Durable public-source evidence, never account data or a substitute source. */
import {z} from 'zod';
import {strictJSON} from '../ashare/strict-json';
import {KrakenSnapshotValidationError,MAX_CACHE_AGE_MS,MAX_PAIRS,MAX_SOURCE_PAIRS,REFRESH_MS,type KrakenSnapshot,type KrakenUniverse} from './contract';
import {tradeEvidenceKey} from './selection';
import {tradeSnapshotSchema} from './trade-validation';
import {krakenSnapshotSchema,validateKrakenReply} from './validation';
import type {KrakenTradeSnapshot} from './trades';

export const KRAKEN_SNAPSHOT_MAX_BYTES=2_000_000;
export const KRAKEN_SNAPSHOT_MAX_SELECTIONS=16;
export type KrakenSnapshotBundle={snapshot:KrakenSnapshot;universe:KrakenUniverse;trades:KrakenTradeSnapshot|null;key:string|null};
const code=z.string().regex(/^[A-Z0-9][A-Z0-9.]{0,31}$/);
const pair=z.object({source_pair:code,pair:z.string().regex(/^[A-Z0-9][A-Z0-9.]{0,31}\/USD$/),base:code,quote:z.literal('USD')}).strict();
const universe=z.object({pairs:z.array(pair).min(1).max(MAX_PAIRS),source_pair_count:z.number().int().min(1).max(MAX_SOURCE_PAIRS),fetched_at:z.string().datetime({offset:true})}).strict();
const bundleSchema=z.object({snapshot:krakenSnapshotSchema,universe,trades:tradeSnapshotSchema.nullable(),key:z.string().max(113).nullable()}).strict().refine(bundle=>{
 const {snapshot,universe,trades,key}=bundle;
 if(Date.parse(snapshot.fetched_at)-Date.parse(snapshot.acquisition_started_at)>12_000||snapshot.catalog_fetched_at!==universe.fetched_at||snapshot.universe_pair_count!==universe.pairs.length||snapshot.catalog_pair_count!==universe.source_pair_count)return false;
 if(new Set(universe.pairs.map(pair=>pair.pair)).size!==universe.pairs.length||new Set(universe.pairs.map(pair=>pair.source_pair)).size!==universe.pairs.length)return false;
 if(universe.pairs.some((pair,index)=>pair.pair!==`${pair.base}/USD`||index>0&&universe.pairs[index-1].pair>=pair.pair))return false;
 const catalog=new Map(universe.pairs.map(pair=>[pair.pair,pair]));
 if([...snapshot.rows,...snapshot.missing].some(row=>!catalog.has(row.pair))||snapshot.rows.some(row=>catalog.get(row.pair)?.source_pair!==row.source_pair))return false;
 if(!trades)return key===null;
 if(trades.schema!=='kraken-trades/2'||!trades.selected_pairs||key!==tradeEvidenceKey(trades.selected_pairs,trades.window_ms===60_000?'1m':'5m'))return false;
 try{
  validateKrakenReply({requested_pairs:trades.selected_pairs,requested_window:trades.window_ms===60_000?'1m':'5m',snapshot,trade_snapshot:trades,status:{state:'available',error_code:null,last_attempt_at:snapshot.acquisition_started_at,fetched_at:snapshot.fetched_at,cache_age_ms:0,refresh_ms:REFRESH_MS,max_cache_age_ms:MAX_CACHE_AGE_MS,next_retry_at:null}});
  return trades.rows.every(row=>catalog.get(row.pair)?.source_pair===row.source_pair);
 }catch{return false;}
});
export function validateKrakenBundle(value:unknown):KrakenSnapshotBundle{return bundleSchema.parse(value);}
export function encodeKrakenBundle(value:KrakenSnapshotBundle):string{
 try{
  const payload=JSON.stringify(validateKrakenBundle(value));
  if(new TextEncoder().encode(payload).byteLength>KRAKEN_SNAPSHOT_MAX_BYTES)throw new Error();
  return payload;
 }catch{throw new KrakenSnapshotValidationError();}
}
export function decodeKrakenBundle(payload:unknown):KrakenSnapshotBundle{
 if(typeof payload!=='string'||payload.length>KRAKEN_SNAPSHOT_MAX_BYTES||new TextEncoder().encode(payload).byteLength>KRAKEN_SNAPSHOT_MAX_BYTES)throw new Error('snapshot_invalid');
 return validateKrakenBundle(strictJSON(payload));
}
