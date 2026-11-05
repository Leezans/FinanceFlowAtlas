import {z} from 'zod';
import {snapshotSchema,MAX_SNAPSHOT_CHARS,type CboeSnapshot} from './model';
import {MAX_CACHE_AGE_MS} from './service-model';

/** An empty collection is a check, not a replacement price observation. */
export const cacheSchema=z.object({
 schema:z.literal('cboe-cache/1'),snapshot:snapshotSchema,latestEmptyCheck:snapshotSchema.nullable(),
}).strict().superRefine((cache,ctx)=>{
 const check=cache.latestEmptyCheck;
 if(check&&(check.rows.length!==0||cache.snapshot.rows.length===0||Date.parse(check.windowEnd)<Date.parse(cache.snapshot.windowEnd)||Date.parse(check.fetchedAt)<Date.parse(cache.snapshot.fetchedAt))){
  ctx.addIssue({code:'custom',message:'invalid_retained_evidence'});
 }
});
export type CboeCache=z.infer<typeof cacheSchema>;
export type CboeRetentionEvidence={safeEmptyWindow:boolean;reportedTradeKeys:readonly string[]};
export const tradeKey=(row:{publicationVenue:string;tradeTime:string;tradeId:string})=>`${row.publicationVenue}:${row.tradeTime.slice(0,10)}:${row.tradeId}`;
/** Read legacy v45 snapshots without inventing retention evidence. */
export function parseCboeCache(value:unknown):CboeCache{
 const legacy=snapshotSchema.safeParse(value);
 return legacy.success?{schema:'cboe-cache/1',snapshot:legacy.data,latestEmptyCheck:null}:cacheSchema.parse(value);
}
/** Pure bounded transition. No cross-window merging or acquisition clock renewal. */
export function nextCboeCache(previous:CboeCache|null,candidate:CboeSnapshot,evidence?:CboeRetentionEvidence):CboeCache{
 // A cold owner can observe a newer shared check than its initial inspection.
 // Never roll that evidence backwards or give it a new acquisition clock.
 if(previous&&Date.parse(candidate.windowEnd)<Date.parse((previous.latestEmptyCheck??previous.snapshot).windowEnd))return previous;
 let snapshot=candidate,latestEmptyCheck:CboeSnapshot|null=null;
 const prior=previous?.snapshot,age=prior?Date.parse(candidate.fetchedAt)-Date.parse(prior.fetchedAt):NaN;
 if(candidate.rows.length===0&&prior?.rows.length&&evidence?.safeEmptyWindow&&age>=0&&age<=MAX_CACHE_AGE_MS&&
    Date.parse(candidate.windowEnd)>=Date.parse((previous?.latestEmptyCheck??prior).windowEnd)){
  const reported=new Set(evidence.reportedTradeKeys);
  // A later report with a retained trade identity may revise that price. Clear
  // rather than guess a cross-file correction/replacement chain.
  if(prior.rows.every(row=>!reported.has(tradeKey(row)))){snapshot=prior;latestEmptyCheck=candidate;}
 }
 let result:CboeCache={schema:'cboe-cache/1',snapshot,latestEmptyCheck};
 // Metadata must fit the existing single-row payload cap. Never grow storage
 // or reject a valid latest empty result merely to retain older evidence.
 if(JSON.stringify(result).length>MAX_SNAPSHOT_CHARS&&latestEmptyCheck)result={schema:'cboe-cache/1',snapshot:candidate,latestEmptyCheck:null};
 return cacheSchema.parse(result);
}
