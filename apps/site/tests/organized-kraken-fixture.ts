/** Independently generated synthetic records, never captured market observations. */
import {MAX_CACHE_AGE_MS,parseKrakenTicker,parseKrakenUniverse,type KrakenReply} from '../lib/crypto/kraken';
import {parseKrakenTrades,tradeSnapshot,type KrakenTradeSnapshot} from '../lib/crypto/trades';
import {type TradeTimeframe} from '../lib/crypto/selection';
import {pairMetadata} from './kraken-fixture';
export const at=Date.parse('2026-11-05T03:00:00.000Z'),iso=new Date(at).toISOString();
export function krakenTradeReply({end=at,fetched=end,selected,timeframe='5m',missing=[]}:{end?:number;fetched?:number;selected?:string[];timeframe?:TradeTimeframe;missing?:string[]}={}):KrakenReply{
 const endIso=new Date(end).toISOString(),fetchIso=new Date(fetched).toISOString(),names=['ADA','BTC','ETH','SOL','XRP'].filter(base=>!missing.includes(`${base}/USD`));
 const universe=parseKrakenUniverse({error:[],result:Object.fromEntries(names.map(base=>[base+'USD',pairMetadata(base)]))},endIso);
 const snapshot=parseKrakenTicker({error:[],result:Object.fromEntries(names.map(base=>[base+'USD',{c:['10','1'],v:['1','1'],p:['1','10'],t:[1,1]}]))},endIso,fetchIso,universe);
 const rows=universe.pairs.filter(pair=>(selected??['BTC/USD','ETH/USD','SOL/USD']).includes(pair.pair)).map(pair=>parseKrakenTrades({error:[],result:{[pair.source_pair]:[['10.000000000001','0.000000000001',(end-1000)/1000,'b','m','',1]],last:'1793847600000000001'}},pair,end-(timeframe==='1m'?60_000:300_000),end,fetched));
 return {snapshot,trade_snapshot:tradeSnapshot(rows,end,fetched,selected,timeframe),...(selected?{requested_pairs:selected}:{}),...(timeframe==='1m'?{requested_window:timeframe}:{}),status:{state:'available',error_code:null,last_attempt_at:endIso,fetched_at:fetchIso,cache_age_ms:0,refresh_ms:60_000,max_cache_age_ms:MAX_CACHE_AGE_MS,next_retry_at:fetchIso}};
}
export function legacyTrades():KrakenTradeSnapshot{
 const snapshot=krakenTradeReply().trade_snapshot!;
 delete snapshot.page_limit;
 snapshot.rows.forEach(row=>{delete row.page_count;delete row.last_page_count;});
 return snapshot;
}
export function variedTrades():KrakenTradeSnapshot{
 const snapshot=krakenTradeReply().trade_snapshot!;
 Object.assign(snapshot.rows[0],{buy_notional_usd:'0',sell_notional_usd:'0',imbalance_usd:'0',imbalance_pct:null,returned_count:0,trade_count:0,last_page_count:0,first_trade_at:null,last_trade_at:null});
 Object.assign(snapshot.rows[1],{coverage:'capped_response',buy_notional_usd:null,sell_notional_usd:null,imbalance_usd:null,imbalance_pct:null,returned_count:2000,trade_count:1999,excluded_after_window_count:1,page_count:2,last_page_count:1000});
 Object.assign(snapshot.rows[2],{buy_notional_usd:'9007199254740993.000000000000000000000001',sell_notional_usd:'9007199254740993',imbalance_usd:'0.000000000000000000000001',imbalance_pct:0,returned_count:1001,trade_count:1000,excluded_after_window_count:1,page_count:2,last_page_count:1});
 return snapshot;
}
