/** Public informational Gamma records. No wallets, positions, orders or flow inference. */
import {z} from 'zod';
export const SOURCE_URL='https://gamma-api.polymarket.com/markets?limit=200&offset=0&active=true&closed=false&archived=false&order=volume24hr&ascending=false&include_tag=true';
export const SOURCE_DOCS='https://docs.polymarket.com/api-reference/markets/list-markets';
export const SOURCE_TERMS='https://polymarket.com/tos';
export const REFRESH_MS=30_000,MAX_CACHE_AGE_MS=300_000,MAX_MARKETS=200;
const instant=z.string().datetime({offset:true});
const text=z.string().min(1).max(1000).refine(v=>!/[\u0000-\u001f\u007f]/.test(v));
const probability=z.string().regex(/^(?:0(?:\.\d{1,12})?|1(?:\.0{1,12})?)$/);
const outcome=z.object({name:text,price:probability.nullable()}).strict();
export const marketSchema=z.object({
 id:z.string().regex(/^\d{1,24}$/),question:text,
 category:z.string().min(1).max(200),category_basis:z.enum(['source_category','source_tag','unclassified']),
 tags:z.array(z.object({slug:z.string().min(1).max(100),label:z.string().min(1).max(200)}).strict()).max(100),
 outcomes:z.array(outcome).min(2).max(16),
 volume_24h:z.number().finite().nonnegative().max(1e15).nullable(),volume_unit:z.literal('source_reported'),
 source_record_updated_at:instant.nullable(),source_observed_at:z.null(),
 accepting_orders:z.boolean().nullable(),
}).strict().refine(r=>new Set(r.outcomes.map(o=>o.name.toLowerCase())).size===r.outcomes.length&&new Set(r.tags.map(t=>t.slug)).size===r.tags.length);
export type PolymarketMarket=z.infer<typeof marketSchema>;
export const snapshotSchema=z.object({
 schema:z.literal('polymarket-gamma/1'),source:z.literal('Polymarket Gamma'),coverage:z.literal('bounded_active_market_sample'),
 sample_limit:z.literal(MAX_MARKETS),source_market_count:z.number().int().min(0).max(MAX_MARKETS),excluded_market_count:z.number().int().min(0).max(MAX_MARKETS),
 ordering:z.literal('source_volume24hr_descending'),complete_universe:z.literal(false),
 acquisition_started_at:instant,fetched_at:instant,source_observed_at:z.null(),net_capital_flow:z.null(),
 rows:z.array(marketSchema).min(1).max(MAX_MARKETS),
}).strict().refine(s=>Date.parse(s.fetched_at)>=Date.parse(s.acquisition_started_at)&&s.rows.length+s.excluded_market_count===s.source_market_count&&new Set(s.rows.map(r=>r.id)).size===s.rows.length&&s.rows.every(r=>!r.source_record_updated_at||Date.parse(r.source_record_updated_at)<=Date.parse(s.fetched_at)+60_000));
export type PolymarketSnapshot=z.infer<typeof snapshotSchema>;
export const statusSchema=z.object({state:z.enum(['available','stale','unavailable','denied']),error_code:z.string().regex(/^[a-z_]{1,64}$/).nullable(),last_attempt_at:instant.nullable(),fetched_at:instant.nullable(),cache_age_ms:z.number().int().safe().nullable(),refresh_ms:z.literal(REFRESH_MS),max_cache_age_ms:z.literal(MAX_CACHE_AGE_MS),next_retry_at:instant.nullable()}).strict();
export const replySchema=z.object({status:statusSchema,snapshot:snapshotSchema.nullable()}).strict().refine(r=>(r.status.state==='available'||r.status.state==='stale')===!!r.snapshot&&(!r.snapshot||r.snapshot.fetched_at===r.status.fetched_at));
export type PolymarketReply=z.infer<typeof replySchema>;
export function visibleSnapshot(reply:PolymarketReply|null,now:number):PolymarketSnapshot|null{
 const s=reply?.snapshot;if(!s||!['available','stale'].includes(reply.status.state))return null;
 const age=now-Date.parse(s.fetched_at);return age>=0&&age<=MAX_CACHE_AGE_MS?s:null;
}
