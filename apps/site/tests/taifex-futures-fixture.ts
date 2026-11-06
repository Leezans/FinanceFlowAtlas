import {parseFutures} from '../lib/futures/taifex/adapter';
import {PARTICIPANTS,PRODUCTS,REFRESH_MS,MAX_CACHE_AGE_MS,type FuturesReply} from '../lib/futures/taifex/model';
export const NOW=Date.parse('2026-11-06T03:00:00Z'),STARTED=new Date(NOW).toISOString(),FETCHED=STARTED;
/** Entirely synthetic observations. No captured provider rows are embedded. */
export function makeFuturesFixture():Record<string,string>[] {
 return PRODUCTS.flatMap(product=>PARTICIPANTS.map(participant=>({
  Date:'20261105',ContractCode:product.label,Item:participant.label,
  'TradingVolume(Long)':'3','TradingValue(Long)(Thousands)':'3',
  'TradingVolume(Short)':'2','TradingValue(Short)(Thousands)':'2',
  'TradingVolume(Net)':'1','TradingValue(Net)(Thousands)':'1',
  'OpenInterest(Long)':'5','ContractValueofOpenInterest(Long)(Thousands)':'5',
  'OpenInterest(Short)':'4','ContractValueofOpenInterest(Short)(Thousands)':'4',
  'OpenInterest(Net)':'1','ContractValueofOpenInterest(Net)(Thousands)':'1',
 })));
}
export function futuresSnapshot(now=NOW){const iso=new Date(now).toISOString();return parseFutures(makeFuturesFixture(),iso,iso);}
export function futuresReply(now=NOW):FuturesReply{const iso=new Date(now).toISOString();return {
 snapshot:futuresSnapshot(now),
 status:{state:'available',error_code:null,last_attempt_at:iso,fetched_at:iso,cache_age_ms:0,refresh_ms:REFRESH_MS,max_cache_age_ms:MAX_CACHE_AGE_MS,next_retry_at:new Date(now+REFRESH_MS).toISOString()},
};}
