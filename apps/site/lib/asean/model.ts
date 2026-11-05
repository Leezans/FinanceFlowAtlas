import {z} from 'zod';
import {CELL_COUNT,HOST_CODES,SECTOR_CODES,YEARS} from './dimensions';
export const REFRESH_MS=86_400_000,MAX_CACHE_AGE_MS=7*86_400_000;
const instant=z.string().datetime({offset:true});
export const numericValue=(raw:string):number|null=>/^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(raw)&&Number.isFinite(Number(raw))&&Math.abs(Number(raw))<=1e12?Number(raw):null;
const rawValue=z.string().max(80).refine(s=>s==='n.a'||numericValue(s)!==null);
const cellSchema=z.object({host:z.string().refine(h=>HOST_CODES.includes(h as typeof HOST_CODES[number])),sector:z.string().refine(s=>SECTOR_CODES.includes(s as typeof SECTOR_CODES[number])),year:z.number().int().refine(y=>YEARS.includes(y as typeof YEARS[number])),state:z.enum(['reported','source_na','missing','duplicate']),value:z.number().finite().min(-1e12).max(1e12).nullable(),raw_values:z.array(rawValue).max(20)}).strict().refine(c=>{
 if(c.state==='missing')return c.value===null&&c.raw_values.length===0;
 if(c.state==='duplicate')return c.value===null&&c.raw_values.length>1;
 if(c.state==='source_na')return c.value===null&&c.raw_values.length===1&&c.raw_values[0]==='n.a';
 return c.raw_values.length===1&&c.raw_values[0]!=='n.a'&&numericValue(c.raw_values[0])===c.value;
});
export type FdiCell=z.infer<typeof cellSchema>;
export const snapshotSchema=z.object({schema:z.literal('asean-fdi/1'),source:z.literal('ASEANstats'),measure:z.literal('annual_net_inward_fdi'),unit:z.literal('million_USD'),source_released_at:z.null(),notes_verified_on:z.literal('2026-11-05'),portal_update_observed_on:z.literal('2026-07-01'),acquisition_started_at:instant,fetched_at:instant,source_row_count:z.number().int().min(1).max(5000),cells:z.array(cellSchema).length(CELL_COUNT)}).strict().refine(s=>Date.parse(s.fetched_at)>=Date.parse(s.acquisition_started_at)&&new Set(s.cells.map(c=>`${c.year}/${c.host}/${c.sector}`)).size===CELL_COUNT&&s.cells.reduce((sum,c)=>sum+c.raw_values.length,0)===s.source_row_count&&s.cells.some(c=>c.state==='reported'));
export type FdiSnapshot=z.infer<typeof snapshotSchema>;
const statusSchema=z.object({state:z.enum(['available','stale','unavailable','denied']),error_code:z.string().regex(/^[a-z_]{1,64}$/).nullable(),last_attempt_at:instant.nullable(),fetched_at:instant.nullable(),cache_age_ms:z.number().int().safe().nullable(),refresh_ms:z.literal(REFRESH_MS),max_cache_age_ms:z.literal(MAX_CACHE_AGE_MS),next_retry_at:instant.nullable()}).strict();
export const replySchema=z.object({status:statusSchema,snapshot:snapshotSchema.nullable()}).strict().refine(r=>(r.status.state==='available'||r.status.state==='stale')===!!r.snapshot&&(!r.snapshot||r.snapshot.fetched_at===r.status.fetched_at));
export type FdiReply=z.infer<typeof replySchema>;
export function visibleSnapshot(reply:FdiReply|null,now:number):FdiSnapshot|null{const s=reply?.snapshot;if(!s||!['available','stale'].includes(reply.status.state))return null;const age=now-Date.parse(s.fetched_at);return age>=0&&age<=MAX_CACHE_AGE_MS?s:null;}
