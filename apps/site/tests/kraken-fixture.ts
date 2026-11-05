import {parseKrakenUniverse,parseKrakenTicker} from '../lib/crypto/kraken';
// Independently generated synthetic records. No captured market observations.
export function pairMetadata(base:string,wsBase=base){return {aclass_base:'currency',aclass_quote:'currency',base,quote:'ZUSD',wsname:`${wsBase}/USD`,status:'online'};}
export const catalog=()=>({error:[],result:{XXBTZUSD:pairMetadata('XXBT','XBT'),XETHZUSD:pairMetadata('XETH','ETH')}});
export const universe=(at:string)=>parseKrakenUniverse(catalog(),at);
export const parseTicker=(raw:unknown,started:string,fetched:string)=>parseKrakenTicker(raw,started,fetched,universe(started));
