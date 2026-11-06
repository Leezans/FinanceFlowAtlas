/** One persisted TAIFEX acquisition, with independent report clocks. */
import {z} from 'zod';
import {snapshotSchema as optionsSchema,type TaifexSnapshot} from '../options/taifex/model';
import {snapshotSchema as futuresSchema,type FuturesSnapshot} from '../futures/taifex/model';
import {TaifexError} from '../options/taifex/adapter';

// The persisted byte limit matches the unchanged D1 CHECK constraint. It is
// independent of either endpoint's response-body bound.
export const MAX_CACHE_BYTES=256_000,MAX_ACQUISITION_MS=25_000;
const instant=z.string().datetime({offset:true});
export const bundleSchema=z.object({
 schema:z.literal('taifex-institutions/2'),source:z.literal('TAIFEX'),
 acquisition_started_at:instant,fetched_at:instant,
 options:optionsSchema,futures:futuresSchema,
}).strict().refine(bundle=>{
 const started=Date.parse(bundle.acquisition_started_at),fetched=Date.parse(bundle.fetched_at);
 return Number.isFinite(started)&&Number.isFinite(fetched)&&fetched>=started&&fetched-started<=MAX_ACQUISITION_MS&&
  [bundle.options,bundle.futures].every(report=>Date.parse(report.acquisition_started_at)>=started&&Date.parse(report.fetched_at)<=fetched);
},'bundle_timing');
export type TaifexBundle=z.infer<typeof bundleSchema>;
/** Legacy is exactly the original options schema, never a partial v2. */
export const cacheSchema=z.union([optionsSchema,bundleSchema]);
export type TaifexCache=z.infer<typeof cacheSchema>;
export function optionsReport(cache:TaifexCache|null):TaifexSnapshot|null{return cache?.schema==='taifex-institutions/2'?cache.options:cache;}
export function futuresReport(cache:TaifexCache|null):FuturesSnapshot|null{return cache?.schema==='taifex-institutions/2'?cache.futures:null;}
export function utf8Bytes(value:string){return new TextEncoder().encode(value).byteLength;}
/** Run before starting the irreversible release and again at the DB boundary. */
export function serializeBundle(value:unknown):string{
 const parsed=bundleSchema.safeParse(value);
 if(!parsed.success)throw new TaifexError('invalid_cache_bundle');
 const payload=JSON.stringify(parsed.data);
 if(utf8Bytes(payload)>MAX_CACHE_BYTES)throw new TaifexError('cache_byte_budget');
 return payload;
}
