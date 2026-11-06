import {parseTaifex} from '../lib/options/taifex/adapter';
import {PARTICIPANTS,PRODUCTS,REFRESH_MS,MAX_CACHE_AGE_MS,type TaifexReply} from '../lib/options/taifex/model';
export const at=Date.parse('2026-11-06T03:00:00Z'),iso=new Date(at).toISOString();
/** Entirely synthetic fixture, never a captured source observation. */
export function taifexPayload():Record<string,string>[] {
 return PRODUCTS.flatMap((product,p)=>['CALL','PUT'].flatMap((type,t)=>PARTICIPANTS.map((participant,i)=>{
  const zero=product.id==='teo',buy=zero?0:12+p*10+t*7+i*3,sell=zero?0:9+p*2+t*3+i*5;
  return {
   Date:'20261105',ContractCode:product.label,CallPut:type,Item:participant.label,
   'TradingVolume(Long)':String(zero?0:10+p+t+i),'TradingValue(Long)(Thousands)':String(buy),
   'TradingVolume(Short)':String(zero?0:7+p+t+i),'TradingValue(Short)(Thousands)':String(sell),
   'TradingVolume(Net)':String(zero?0:3),'TradingValue(Net)(Thousands)':String(buy-sell+(p===0&&t===0&&i===0?1:0)),
   'OpenInterest(Long)':String(zero?0:5+p+t+i),'ContractValueofOpenInterest(Long)(Thousands)':String(zero?0:15+p+t+i),
   'OpenInterest(Short)':String(zero?0:2+p+t+i),'ContractValueofOpenInterest(Short)(Thousands)':String(zero?0:6+p+t+i),
   'OpenInterest(Net)':String(zero?0:3),'ContractValueofOpenInterest(Net)(Thousands)':String(zero?0:9),
  };
 })));
}
export function taifexReply():TaifexReply{return {
 snapshot:parseTaifex(taifexPayload(),iso,iso),
 status:{state:'available',error_code:null,last_attempt_at:iso,fetched_at:iso,cache_age_ms:0,refresh_ms:REFRESH_MS,max_cache_age_ms:MAX_CACHE_AGE_MS,next_retry_at:new Date(at+REFRESH_MS).toISOString()},
};}
