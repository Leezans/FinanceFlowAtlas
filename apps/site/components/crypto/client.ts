import {MAX_CACHE_AGE_MS,type KrakenReply,type KrakenSnapshot} from '@/lib/crypto/kraken';
export {validateKrakenReply} from '@/lib/crypto/validation';

export function visibleSnapshot(reply:KrakenReply|null,now:number):KrakenSnapshot|null{
 const snapshot=reply?.snapshot;if(!snapshot||reply.status.state==='denied'||reply.status.state==='unavailable')return null;
 const age=now-Date.parse(snapshot.fetched_at);return Number.isFinite(age)&&age>=0&&age<=MAX_CACHE_AGE_MS?snapshot:null;
}
