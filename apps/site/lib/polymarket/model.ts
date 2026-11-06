/** Public informational Gamma records. No wallets, positions, orders or flow inference. */
import {z} from 'zod';
export const SOURCE_URL='https://gamma-api.polymarket.com/markets/keyset?limit=100&closed=false&order=id&ascending=false&include_tag=true';
export const HOT_SOURCE_URL='https://gamma-api.polymarket.com/markets?limit=100&active=true&closed=false&order=volume24hr&ascending=false&include_tag=true';
export const HOT_SOURCE_DOCS='https://docs.polymarket.com/api-reference/markets/list-markets';
export const HOT_MARKETS=100;
export type PolymarketView='hot'|'newest'|'interest';
export const INTEREST_SOURCE_URL='https://data-api.polymarket.com/v2/oi';
export const INTEREST_SOURCE_DOCS='https://docs.polymarket.com/market-data/public-analytics#open-interest';
export const INTEREST_MARKETS=20,INTEREST_REFRESH_MS=300_000,INTEREST_MAX_CACHE_AGE_MS=600_000;
export const refreshInterval=(view:PolymarketView)=>view==='interest'?INTEREST_REFRESH_MS:REFRESH_MS;
export const maximumCacheAge=(view:PolymarketView)=>view==='interest'?INTEREST_MAX_CACHE_AGE_MS:MAX_CACHE_AGE_MS;
export const conditionSchema=z.string().regex(/^0x[0-9a-f]{64}$/);
export const SOURCE_DOCS='https://docs.polymarket.com/api-reference/markets/list-markets-keyset-pagination';
export const SOURCE_TERMS='https://polymarket.com/tos';
export const REFRESH_MS=30_000,MAX_CACHE_AGE_MS=300_000,MAX_MARKETS=500;
export const PAGE_SIZE=100,MAX_PAGES=5,MAX_CACHE_BYTES=2_000_000;
const instant=z.string().datetime({offset:true});
const text=z.string().min(1).max(1000).refine(v=>!/[\u0000-\u001f\u007f]/.test(v));
const probability=z.string().regex(/^(?:0(?:\.\d{1,12})?|1(?:\.0{1,12})?)$/);
const outcome=z.object({name:text,price:probability.nullable()}).strict();
export const marketSchema=z.object({
 id:z.string().regex(/^\d{1,24}$/),question:text,
 // Optional for historical Gamma caches; invalid/unsupported source IDs stay unknown.
 condition_id:conditionSchema.nullable().optional(),
 category:z.string().min(1).max(200),category_basis:z.enum(['source_category','source_tag','unclassified']),
 tags:z.array(z.object({slug:z.string().min(1).max(100),label:z.string().min(1).max(200)}).strict()).max(100),
 outcomes:z.array(outcome).min(2).max(16),
 volume_24h:z.number().finite().nonnegative().max(1e15).nullable(),volume_unit:z.literal('source_reported'),
 source_record_updated_at:instant.nullable(),source_observed_at:z.null(),
 accepting_orders:z.boolean().nullable(),
}).strict().refine(r=>new Set(r.outcomes.map(o=>o.name.toLowerCase())).size===r.outcomes.length&&new Set(r.tags.map(t=>t.slug)).size===r.tags.length);
export type PolymarketMarket=z.infer<typeof marketSchema>;
export const legacySnapshotSchema=z.object({
 schema:z.literal('polymarket-gamma/1'),source:z.literal('Polymarket Gamma'),coverage:z.literal('bounded_active_market_sample'),
 sample_limit:z.literal(200),source_market_count:z.number().int().min(0).max(200),excluded_market_count:z.number().int().min(0).max(200),
 ordering:z.literal('source_volume24hr_descending'),complete_universe:z.literal(false),
 acquisition_started_at:instant,fetched_at:instant,source_observed_at:z.null(),net_capital_flow:z.null(),
 rows:z.array(marketSchema).min(1).max(200),
}).strict().refine(s=>Date.parse(s.fetched_at)>=Date.parse(s.acquisition_started_at)&&s.rows.length+s.excluded_market_count===s.source_market_count&&new Set(s.rows.map(r=>r.id)).size===s.rows.length&&s.rows.every(r=>!r.source_record_updated_at||Date.parse(r.source_record_updated_at)<=Date.parse(s.fetched_at)+60_000));
export const keysetSnapshotSchema=z.object({
 schema:z.literal('polymarket-gamma/2'),source:z.literal('Polymarket Gamma'),coverage:z.literal('bounded_active_market_sample'),
 sample_limit:z.literal(MAX_MARKETS),source_market_count:z.number().int().min(0).max(MAX_MARKETS),excluded_market_count:z.number().int().min(0).max(MAX_MARKETS),
 ordering:z.literal('source_id_descending'),complete_universe:z.literal(false),
 total_market_count:z.null(),pagination:z.literal('keyset'),source_page_count:z.number().int().min(1).max(MAX_PAGES),
 source_page_sizes:z.array(z.number().int().min(0).max(PAGE_SIZE)).min(1).max(MAX_PAGES),
 stop_reason:z.enum(['source_exhausted','page_limit','time_budget']),has_more:z.boolean(),
 grouping:z.literal('source_category_else_smallest_tag_slug'),
 acquisition_started_at:instant,fetched_at:instant,source_observed_at:z.null(),net_capital_flow:z.null(),
 rows:z.array(marketSchema).min(1).max(MAX_MARKETS),
}).strict().refine(s=>Date.parse(s.fetched_at)>=Date.parse(s.acquisition_started_at)&&s.source_page_sizes.length===s.source_page_count&&s.source_page_sizes.reduce((a,b)=>a+b,0)===s.source_market_count&&(s.stop_reason==='source_exhausted'?s.has_more===false:s.has_more===true)&&(s.stop_reason!=='page_limit'||s.source_page_count===MAX_PAGES)&&s.rows.length+s.excluded_market_count===s.source_market_count&&new Set(s.rows.map(r=>r.id)).size===s.rows.length&&s.rows.every((r,i)=>/^(?:0|[1-9]\d{0,23})$/.test(r.id)&&(i===0||s.rows[i-1].id.length>r.id.length||s.rows[i-1].id.length===r.id.length&&s.rows[i-1].id>r.id))&&s.rows.every(r=>!r.source_record_updated_at||Date.parse(r.source_record_updated_at)<=Date.parse(s.fetched_at)+60_000));
/** A distinct source-ranked window, never newest rows relabeled as hot. */
function descendingKnownVolume(rows:PolymarketMarket[]):boolean{
 let previous=Infinity;
 for(const row of rows){if(row.volume_24h===null)continue;if(row.volume_24h>previous)return false;previous=row.volume_24h;}
 return true;
}
export const hotSnapshotSchema=z.object({
 schema:z.literal('polymarket-gamma/hot/1'),source:z.literal('Polymarket Gamma'),coverage:z.literal('bounded_active_market_sample'),
 sample_limit:z.literal(HOT_MARKETS),source_market_count:z.number().int().min(1).max(HOT_MARKETS),excluded_market_count:z.number().int().min(0).max(HOT_MARKETS),
 ordering:z.literal('source_volume24hr_descending'),complete_universe:z.literal(false),
 total_market_count:z.null(),pagination:z.literal('single_page'),source_page_count:z.literal(1),
 source_page_sizes:z.tuple([z.number().int().min(1).max(HOT_MARKETS)]),
 stop_reason:z.enum(['sample_limit','source_short_page']),has_more:z.null(),
 grouping:z.literal('source_category_else_smallest_tag_slug'),
 acquisition_started_at:instant,fetched_at:instant,source_observed_at:z.null(),net_capital_flow:z.null(),
 rows:z.array(marketSchema).min(1).max(HOT_MARKETS),
}).strict().refine(s=>Date.parse(s.fetched_at)>=Date.parse(s.acquisition_started_at)&&s.source_page_sizes[0]===s.source_market_count&&s.rows.length+s.excluded_market_count===s.source_market_count&&(s.stop_reason==='sample_limit')===(s.source_market_count===HOT_MARKETS)&&descendingKnownVolume(s.rows)&&new Set(s.rows.map(r=>r.id)).size===s.rows.length&&s.rows.every(r=>!r.source_record_updated_at||Date.parse(r.source_record_updated_at)<=Date.parse(s.fetched_at)+60_000));
/** Select one bounded source-ranked cohort, never a full market or OI ranking. */
export function interestSelection(rows:PolymarketMarket[]):PolymarketMarket[]{
 const seen=new Set<string>();
 return rows.filter(row=>{if(!row.condition_id||seen.has(row.condition_id))return false;seen.add(row.condition_id);return true;}).slice(0,INTEREST_MARKETS);
}
export const interestSnapshotSchema=z.object({
 schema:z.literal('polymarket-open-interest/1'),source:z.literal('Polymarket Data API v2'),
 coverage:z.literal('bounded_hot_market_open_interest'),complete_universe:z.literal(false),total_market_count:z.null(),
 sample_limit:z.literal(INTEREST_MARKETS),selection:z.literal('first_distinct_standard_conditions_in_hot_window'),
 metric:z.literal('priced_gross_open_interest'),currency:z.literal('USDC'),
 discovery:hotSnapshotSchema,rows:z.array(marketSchema).min(1).max(INTEREST_MARKETS),
 values:z.array(z.object({condition_id:conditionSchema,value:z.number().finite().nonnegative().max(1e15)}).strict()).max(INTEREST_MARKETS),
 acquisition_started_at:instant,oi_request_started_at:instant,fetched_at:instant,source_observed_at:z.null(),net_capital_flow:z.null(),
}).strict().refine(s=>s.acquisition_started_at===s.discovery.acquisition_started_at&&Date.parse(s.oi_request_started_at)>=Date.parse(s.discovery.fetched_at)&&Date.parse(s.fetched_at)>=Date.parse(s.oi_request_started_at)&&JSON.stringify(s.rows)===JSON.stringify(interestSelection(s.discovery.rows))&&new Set(s.values.map(r=>r.condition_id)).size===s.values.length&&s.values.every(v=>s.rows.some(r=>r.condition_id===v.condition_id)));
export type PolymarketInterestSnapshot=z.infer<typeof interestSnapshotSchema>;
export const snapshotSchema=z.union([keysetSnapshotSchema,legacySnapshotSchema,hotSnapshotSchema,interestSnapshotSchema]);
export function snapshotView(snapshot:PolymarketSnapshot):PolymarketView{return snapshot.schema==='polymarket-open-interest/1'?'interest':snapshot.schema==='polymarket-gamma/hot/1'?'hot':'newest';}
export type PolymarketHotSnapshot=z.infer<typeof hotSnapshotSchema>;
// Both modes use the existing single durable lease and bounded payload. No
// table, permission state or cooldown is reset during this cache evolution.
export const discoveryCacheSchema=z.object({
 schema:z.literal('polymarket-discovery/1'),
 newest:z.union([keysetSnapshotSchema,legacySnapshotSchema]).nullable(),
 hot:hotSnapshotSchema.nullable(),
}).strict().refine(s=>s.newest!==null||s.hot!==null);
export const interestCacheSchema=z.object({
 schema:z.literal('polymarket-discovery/2'),
 newest:z.union([keysetSnapshotSchema,legacySnapshotSchema]).nullable(),hot:hotSnapshotSchema.nullable(),interest:interestSnapshotSchema.nullable(),
}).strict().refine(s=>s.newest!==null||s.hot!==null||s.interest!==null);
export const storedCacheSchema=z.union([interestCacheSchema,discoveryCacheSchema,snapshotSchema]);
export type PolymarketStoredCache=z.infer<typeof storedCacheSchema>;
export function selectSnapshot(cache:PolymarketStoredCache|null,view:PolymarketView):PolymarketSnapshot|null{
 if(!cache)return null;
 if(cache.schema==='polymarket-discovery/2')return cache[view];
 if(cache.schema==='polymarket-discovery/1')return view==='interest'?null:cache[view];
 return snapshotView(cache)===view?cache:null;
}
export function updateStoredCache(cache:PolymarketStoredCache|null,snapshot:PolymarketSnapshot):PolymarketStoredCache{
 const view=snapshotView(snapshot),at=Date.parse(snapshot.fetched_at);
 // Reclaim only evidence already beyond its own display lifetime, as part of
 // this successful replacement. Expired companion windows must not pin the
 // shared byte budget forever. A temporary acquisition failure still leaves stored bytes intact.
 const retained=(mode:PolymarketView)=>{const prior=selectSnapshot(cache,mode);return prior&&at-Date.parse(prior.fetched_at)>maximumCacheAge(mode)?null:prior;};
 const interest=view==='interest'?snapshot:retained('interest');
 if(interest)return interestCacheSchema.parse({schema:'polymarket-discovery/2',interest,hot:view==='hot'?snapshot:retained('hot'),newest:view==='newest'?snapshot:retained('newest')});
 const opposite=retained(view==='hot'?'newest':'hot');
 if(!opposite)return snapshot;
 return discoveryCacheSchema.parse({schema:'polymarket-discovery/1',newest:view==='newest'?snapshot:opposite,hot:view==='hot'?snapshot:opposite});
}
export function latestCacheTime(cache:PolymarketStoredCache):number{
 return Math.max(...(['hot','newest','interest'] as const).map(view=>Date.parse(selectSnapshot(cache,view)?.fetched_at??'')||0));
}
export type PolymarketKeysetSnapshot=z.infer<typeof keysetSnapshotSchema>;
export type PolymarketSnapshot=z.infer<typeof snapshotSchema>;
export const statusSchema=z.object({state:z.enum(['available','stale','unavailable','denied']),error_code:z.string().regex(/^[a-z_]{1,64}$/).nullable(),last_attempt_at:instant.nullable(),fetched_at:instant.nullable(),cache_age_ms:z.number().int().safe().nullable(),refresh_ms:z.union([z.literal(REFRESH_MS),z.literal(INTEREST_REFRESH_MS)]),max_cache_age_ms:z.union([z.literal(MAX_CACHE_AGE_MS),z.literal(INTEREST_MAX_CACHE_AGE_MS)]),next_retry_at:instant.nullable(),source_next_retry_at:instant.nullable().optional()}).strict();
export const replySchema=z.object({status:statusSchema,snapshot:snapshotSchema.nullable()}).strict().refine(r=>(r.status.state==='available'||r.status.state==='stale')===!!r.snapshot&&(!r.snapshot||r.snapshot.fetched_at===r.status.fetched_at&&r.status.refresh_ms===refreshInterval(snapshotView(r.snapshot))&&r.status.max_cache_age_ms===maximumCacheAge(snapshotView(r.snapshot))));
export type PolymarketReply=z.infer<typeof replySchema>;
export function visibleSnapshot(reply:PolymarketReply|null,now:number):PolymarketSnapshot|null{
 const s=reply?.snapshot;if(!s||!['available','stale'].includes(reply.status.state))return null;
 const age=now-Date.parse(s.fetched_at);return age>=0&&age<=maximumCacheAge(snapshotView(s))?s:null;
}
