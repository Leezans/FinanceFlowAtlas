import {and,eq,lte,isNull,isNotNull,or} from 'drizzle-orm';
import {getDb} from '@/db';
import {ticCache} from '@/db/schema';
import {type CacheRepository,DAY_MS,FAILURE_BACKOFF_MS} from './cache';
const KEY='tic-equity-2026-08';
export function repository():CacheRepository{
 const db=getDb();
 return {
  async ensure(){await db.insert(ticCache).values({id:KEY}).onConflictDoNothing()},
  async load(){return (await db.select().from(ticCache).where(eq(ticCache.id,KEY)).limit(1))[0]||null},
  async claim(now,token){const rows=await db.update(ticCache).set({leaseUntilMs:now+30_000,leaseToken:token,lastAttemptMs:now}).where(and(eq(ticCache.id,KEY),lte(ticCache.leaseUntilMs,now),or(isNull(ticCache.lastAttemptMs),and(isNotNull(ticCache.error),lte(ticCache.lastAttemptMs,now-FAILURE_BACKOFF_MS)),and(isNull(ticCache.error),isNotNull(ticCache.payload),lte(ticCache.lastAttemptMs,now-DAY_MS)),and(isNull(ticCache.error),isNull(ticCache.payload),lte(ticCache.lastAttemptMs,now-30_000))))).returning({id:ticCache.id});return rows.length===1},
  async success(token,snapshot,now){await db.update(ticCache).set({payload:JSON.stringify(snapshot),version:snapshot.version,lastSuccessMs:now,error:null,leaseUntilMs:0,leaseToken:null}).where(and(eq(ticCache.id,KEY),eq(ticCache.leaseToken,token)))},
  async failure(token,error){await db.update(ticCache).set({error,leaseUntilMs:0,leaseToken:null}).where(and(eq(ticCache.id,KEY),eq(ticCache.leaseToken,token)))},
 };
}
