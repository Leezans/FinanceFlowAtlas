import {and,eq,lte,isNull,isNotNull,or} from 'drizzle-orm';
import {getDb} from '@/db';
import {LATEST_CACHE_KEY, legacyCacheKey, seedLegacyCache} from './migration';
import {ticCache} from '@/db/schema';
import {sourceGate} from './source-gate';
import type {FlowSnapshot} from './adapter';
import {type CacheRepository,DAY_MS,FAILURE_BACKOFF_MS} from './cache';
export function repository<T extends {version:string}=FlowSnapshot>(key=LATEST_CACHE_KEY):CacheRepository<T>{
 const db=getDb();
 return {
  sourceGate:sourceGate(db),
  async ensure(){
   const existing=(await db.select({id:ticCache.id}).from(ticCache).where(eq(ticCache.id,key)).limit(1))[0];
   if(existing)return;
   const oldKey=legacyCacheKey(key);
   const previous=oldKey?(await db.select().from(ticCache).where(eq(ticCache.id,oldKey)).limit(1))[0]||null:null;
   const seed=seedLegacyCache(key,previous);
   // Concurrent initial requests cannot overwrite the first seed or an already refreshed row.
   await db.insert(ticCache).values({id:key,...seed}).onConflictDoNothing();
  },
  async load(){return (await db.select().from(ticCache).where(eq(ticCache.id,key)).limit(1))[0]||null},
  async claim(now,token){const rows=await db.update(ticCache).set({leaseUntilMs:now+30_000,leaseToken:token,lastAttemptMs:now}).where(and(eq(ticCache.id,key),lte(ticCache.leaseUntilMs,now),or(isNull(ticCache.lastAttemptMs),and(isNotNull(ticCache.error),lte(ticCache.lastAttemptMs,now-FAILURE_BACKOFF_MS)),and(isNull(ticCache.error),isNotNull(ticCache.payload),lte(ticCache.lastAttemptMs,now-DAY_MS)),and(isNull(ticCache.error),isNull(ticCache.payload),lte(ticCache.lastAttemptMs,now-30_000))))).returning({id:ticCache.id});return rows.length===1},
  async success(token,snapshot,now){const rows=await db.update(ticCache).set({payload:JSON.stringify(snapshot),version:snapshot.version,lastSuccessMs:now,error:null,leaseUntilMs:0,leaseToken:null}).where(and(eq(ticCache.id,key),eq(ticCache.leaseToken,token))).returning({id:ticCache.id});if(rows.length!==1)throw new Error("TIC cache lease publication was not confirmed")},
  async failure(token,error){const rows=await db.update(ticCache).set({error,leaseUntilMs:0,leaseToken:null}).where(and(eq(ticCache.id,key),eq(ticCache.leaseToken,token))).returning({id:ticCache.id});if(rows.length!==1)throw new Error("TIC cache lease publication was not confirmed")},
 };
}
