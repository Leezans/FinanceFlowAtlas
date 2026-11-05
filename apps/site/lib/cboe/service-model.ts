import {z} from 'zod';
import {snapshotSchema} from './model';
export const REFRESH_MS=60_000, MAX_CACHE_AGE_MS=86_400_000;
const instant=z.string().datetime({offset:true});
export const statusSchema=z.object({
 state:z.enum(['available','stale','unavailable','denied']),error_code:z.string().regex(/^[a-z_]{1,64}$/).nullable(),
 last_attempt_at:instant.nullable(),fetched_at:instant.nullable(),cache_age_ms:z.number().int().safe().nullable(),
 refresh_ms:z.literal(REFRESH_MS),max_cache_age_ms:z.literal(MAX_CACHE_AGE_MS),next_retry_at:instant.nullable(),
}).strict();
export const replySchema=z.object({status:statusSchema,snapshot:snapshotSchema.nullable(),latest_empty_check:snapshotSchema.nullable().default(null)}).strict().refine(r=>
 (r.status.state==='available'||r.status.state==='stale')===!!r.snapshot&&(!r.snapshot||r.snapshot.fetchedAt===r.status.fetched_at)&&(!r.latest_empty_check||!!r.snapshot&&r.status.state==='stale'&&r.latest_empty_check.rows.length===0&&r.snapshot.rows.length>0&&Date.parse(r.latest_empty_check.fetchedAt)>=Date.parse(r.snapshot.fetchedAt)&&Date.parse(r.latest_empty_check.windowEnd)>=Date.parse(r.snapshot.windowEnd)));
export type CboeReply=z.infer<typeof replySchema>;
export function visibleSnapshot(reply:CboeReply|null,now:number){const s=reply?.snapshot;if(!s||!['available','stale'].includes(reply.status.state))return null;const age=now-Date.parse(s.fetchedAt);return age>=0&&age<=MAX_CACHE_AGE_MS?s:null;}
