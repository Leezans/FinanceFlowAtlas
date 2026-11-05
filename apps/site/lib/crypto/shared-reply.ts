/** Rendering the shared read never changes selection/window or cache clocks. */
import {MAX_CACHE_AGE_MS,REFRESH_MS,type KrakenReply} from './contract';
import type {TradeSelection} from './selection';
import type {KrakenSnapshotRead} from './snapshot-store';

type LocalAttempt={denied:boolean;error:string|null;lastAttempt:number|null;retryAt:number;aborted:boolean};
export function sharedKrakenReply(read:KrakenSnapshotRead,selection:TradeSelection,includeTrades:boolean,local:LocalAttempt):KrakenReply{
 const denied=local.denied||read.code==='source_denied';
 const bundle=!denied&&!local.aborted?read.bundle:undefined;
 const snapshot=bundle?.snapshot??null,age=read.ageMs??null;
 // A local failed refresh stays visible only until a newer successful cohort
 // supersedes it. Cold readers never invent an upstream error or attempt time.
 const localFailure=local.error&&local.lastAttempt!==null&&(!snapshot||local.lastAttempt>=Date.parse(snapshot.fetched_at))?local.error:null;
 const error=denied?(read.code==='source_denied'?'source_denied':local.error??'source_denied'):local.aborted?'aborted':read.code==='source_cooldown'?(localFailure??read.code):read.code??localFailure;
 const state=denied?'denied':!snapshot?'unavailable':error||age===null||age>REFRESH_MS?'stale':'available';
 const trades=includeTrades&&bundle?.key===selection.key&&bundle.trades?{...bundle.trades}:null;
 if(trades&&!selection.explicit){delete trades.selected_pairs;trades.schema='kraken-trades/1';}
 const retry=Math.max(read.nextRetryMs??0,localFailure?local.retryAt:0);
 return {...(selection.explicit?{requested_pairs:[...selection.pairs]}:{}),...(selection.windowExplicit?{requested_window:selection.timeframe}:{}),
  ...(includeTrades?{trade_snapshot:trades}:{}),snapshot,status:{state,error_code:error??null,
   last_attempt_at:local.lastAttempt===null?null:new Date(local.lastAttempt).toISOString(),fetched_at:snapshot?.fetched_at??null,
   cache_age_ms:snapshot?age:null,refresh_ms:REFRESH_MS,max_cache_age_ms:MAX_CACHE_AGE_MS,
   next_retry_at:denied||retry<=0||retry>8.64e15?null:new Date(retry).toISOString()}};
}
