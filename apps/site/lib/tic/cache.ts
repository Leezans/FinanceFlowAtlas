import {normalize,snapshotSchema,SOURCE_URL,type FlowSnapshot} from './adapter';
export const DAY_MS=86_400_000;
export const FAILURE_BACKOFF_MS=300_000;
export type CacheRow={payload:string|null;version:string|null;lastAttemptMs:number|null;lastSuccessMs:number|null;error:string|null;leaseUntilMs:number;leaseToken:string|null};
export interface CacheRepository<T extends {version:string}=FlowSnapshot>{load():Promise<CacheRow|null>;ensure():Promise<void>;claim(now:number,token:string):Promise<boolean>;success(token:string,snapshot:T,now:number):Promise<void>;failure(token:string,error:string):Promise<void>}
export type TicStatus={state:'available'|'stale'|'unavailable';last_checked_at:string|null;error:string|null};
export function readCachedSource<T>(row:CacheRow|null,now:number,parse:(value:unknown)=>T):{snapshot:T|null;status:TicStatus}{
 let snapshot:T|null=null;let invalid=false;
 if(row?.payload){try{snapshot=parse(JSON.parse(row.payload))}catch{invalid=true}}
 return {snapshot,status:{state:!snapshot?'unavailable':row?.error||!row?.lastSuccessMs||now-row.lastSuccessMs>2*DAY_MS?'stale':'available',last_checked_at:row?.lastAttemptMs?new Date(row.lastAttemptMs).toISOString():null,error:invalid?'Cached snapshot failed schema validation.':row?.error||null}};
}
export function readCached(row:CacheRow|null,now:number){return readCachedSource(row,now,value=>snapshotSchema.parse(value))}
/** Read-through only: requests may check the fixed public source at most daily. No scheduler. */
export async function getCachedSource<T extends {version:string}>(repo:CacheRepository<T>,parse:(value:unknown)=>T,normalizeSource:(raw:Uint8Array,retrievedAt:string)=>Promise<T>,fetcher:typeof fetch=fetch,now=Date.now()){
 const read=(row:CacheRow|null)=>readCachedSource(row,now,parse);
 await repo.ensure();let row=await repo.load();
 if(row&&row.lastAttemptMs!==null&&now-row.lastAttemptMs<(row.error?FAILURE_BACKOFF_MS:row.payload?DAY_MS:30_000))return read(row);
 const token=crypto.randomUUID();if(!await repo.claim(now,token))return read(await repo.load());
 try{
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),12000);
  let raw:Uint8Array;
  try{const response=await fetcher(SOURCE_URL,{signal:controller.signal,headers:{'User-Agent':'FinanceFlowAtlas/0.2 (public statistical data)'},redirect:'manual',cache:'no-store'});
   if(response.status>=300&&response.status<400)throw new Error(`Treasury source redirect rejected (HTTP ${response.status})`);
   if(!response.ok)throw new Error(`Treasury source HTTP ${response.status}`);
   if(Number(response.headers.get('Content-Length')||0)>10_000_000)throw new Error('TIC source exceeds size limit');
   if(!response.body)throw new Error('Empty Treasury response body');
   const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
   try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>10_000_000)throw new Error('TIC source exceeds size limit');chunks.push(value)}}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
   raw=new Uint8Array(size);let offset=0;for(const chunk of chunks){raw.set(chunk,offset);offset+=chunk.byteLength}
  }finally{clearTimeout(timeout)}
  const snapshot=await normalizeSource(raw,new Date(now).toISOString());await repo.success(token,snapshot,now);
 }catch(error){const message=error instanceof Error?error.message:'Public source check failed';await repo.failure(token,message.slice(0,500))}
 row=await repo.load();return read(row);
}

export function getTic(repo:CacheRepository,fetcher:typeof fetch=fetch,now=Date.now()){
 return getCachedSource(repo,value=>snapshotSchema.parse(value),(raw,retrievedAt)=>normalize(raw,undefined,retrievedAt),fetcher,now);
}
