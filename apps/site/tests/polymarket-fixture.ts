import {parsePolymarket} from '../lib/polymarket/adapter';
import {REFRESH_MS,MAX_CACHE_AGE_MS,type PolymarketReply} from '../lib/polymarket/model';
export const NOW=Date.parse('2026-11-05T12:00:00.000Z'),ISO=new Date(NOW).toISOString();
export function market(id='1',extra:Record<string,unknown>={}){return {id,question:`Synthetic informational market ${id}?`,active:true,closed:false,archived:false,acceptingOrders:true,outcomes:'["No","Yes"]',outcomePrices:'["0.35","0.65"]',volume24hr:1234.56,updatedAt:'2026-11-05T11:59:00.000Z',tags:[{slug:'economy',label:'Economy'}],...extra};}
export function fixture(){return [market(),market('2',{category:'Science',outcomes:'["Up","Down"]',outcomePrices:'["0","1"]',volume24hr:0}),market('3',{outcomePrices:null,volume24hr:null,updatedAt:null,tags:[],acceptingOrders:false})];}
export const snapshot=()=>parsePolymarket(fixture(),ISO,ISO);
export const reply=():PolymarketReply=>({snapshot:snapshot(),status:{state:'available',error_code:null,last_attempt_at:ISO,fetched_at:ISO,cache_age_ms:0,refresh_ms:REFRESH_MS,max_cache_age_ms:MAX_CACHE_AGE_MS,next_retry_at:new Date(NOW+REFRESH_MS).toISOString()}});
