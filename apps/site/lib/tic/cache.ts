import {normalize,snapshotSchema,SOURCE_URL,type FlowSnapshot} from './adapter';
import type {SourceGateView, SourceOutcome, TicSourceGate} from './source-gate';
export const DAY_MS=86_400_000;
export const FAILURE_BACKOFF_MS=300_000;
export const SOURCE_TIMEOUT_MS=12_000;
export type CacheRow={payload:string|null;version:string|null;lastAttemptMs:number|null;lastSuccessMs:number|null;error:string|null;leaseUntilMs:number;leaseToken:string|null};
export interface CacheRepository<T extends {version:string}=FlowSnapshot>{sourceGate:TicSourceGate;load():Promise<CacheRow|null>;ensure():Promise<void>;claim(now:number,token:string):Promise<boolean>;success(token:string,snapshot:T,now:number):Promise<void>;failure(token:string,error:string):Promise<void>}
export type TicStatus={state:'available'|'stale'|'unavailable';last_checked_at:string|null;error:string|null;source_status?:SourceGateView['state'];next_retry_at?:string|null};
export function readCachedSource<T>(row:CacheRow|null,now:number,parse:(value:unknown)=>T):{snapshot:T|null;status:TicStatus}{
 let snapshot:T|null=null;let invalid=false;
 if(row?.payload){try{snapshot=parse(JSON.parse(row.payload))}catch{invalid=true}}
 return {snapshot,status:{state:!snapshot?'unavailable':row?.error||!row?.lastSuccessMs||now-row.lastSuccessMs>2*DAY_MS?'stale':'available',last_checked_at:row?.lastAttemptMs?new Date(row.lastAttemptMs).toISOString():null,error:invalid?'Cached snapshot failed schema validation.':row?.error||null}};
}
export function readCached(row:CacheRow|null,now:number){return readCachedSource(row,now,value=>snapshotSchema.parse(value))}
class SourceFailure extends Error {constructor(message:string,readonly outcome:SourceOutcome){super(message)}}
function retryWait(header:string|null):Pick<SourceOutcome,'delayMs'|'retryAtMs'> {
 if(header===null)return {};
 const value=header.trim();
 if(/^\d+$/.test(value)){
  const delayMs=Number(value)*1000;
  if(!Number.isSafeInteger(delayMs)||delayMs>8.64e15-Date.now())throw new SourceFailure('Treasury retry deadline is outside the supported range.',{state:'uncertain'});
  return {delayMs};
 }
 // Preserve the server's absolute date. The durable gate compares it with its own DB clock.
 const retryAtMs=Date.parse(value);
 return Number.isFinite(retryAtMs)?{retryAtMs:Math.max(0,retryAtMs)}:{};
}
async function acquireSource(fetcher:typeof fetch):Promise<Uint8Array>{
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
 const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{
  controller.abort();reject(new SourceFailure('Treasury request timed out; its outcome is unconfirmed. Acquisition stopped.',{state:'uncertain'}));
 },SOURCE_TIMEOUT_MS)});
 const operation=(async()=>{
  const response=await fetcher(SOURCE_URL,{signal:controller.signal,headers:{'User-Agent':'FinanceFlowAtlas/0.2 (public statistical data)'},redirect:'manual',cache:'no-store'});
  if(controller.signal.aborted)throw new Error('Expired Treasury request');
  if(response.redirected||response.type==='opaqueredirect'||response.status>=300&&response.status<400)
   throw new SourceFailure(`Treasury source redirect rejected (HTTP ${response.status})`,{state:'denied'});
  if([401,403,407,429,451].includes(response.status))throw new SourceFailure(`Treasury source HTTP ${response.status}; acquisition stopped.`,{state:'denied'});
  if(!response.ok){const wait=retryWait(response.headers.get('Retry-After'));throw new SourceFailure(`Treasury source HTTP ${response.status}`,{state:'cooldown',...wait,delayMs:Math.max(FAILURE_BACKOFF_MS,wait.delayMs??0)});}
  if(Number(response.headers.get('Content-Length')||0)>10_000_000)throw new Error('TIC source exceeds size limit');
  if(!response.body)throw new Error('Empty Treasury response body');
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{while(true){const {value,done}=await reader.read();if(controller.signal.aborted)throw new Error('Expired Treasury request');if(done)break;size+=value.byteLength;if(size>10_000_000)throw new Error('TIC source exceeds size limit');chunks.push(value)}}
  finally{void reader.cancel().catch(()=>{});reader.releaseLock()}
  const raw=new Uint8Array(size);let offset=0;for(const chunk of chunks){raw.set(chunk,offset);offset+=chunk.byteLength}
  const prefix=new TextDecoder().decode(raw.subarray(0,20000));
  if(/<\s*(?:!doctype|html|head|body)\b/i.test(prefix)&&/captcha|access\s*denied|verify.{0,30}human|log\s*in|sign\s*in|challenge/i.test(prefix))
   throw new SourceFailure('Treasury access challenge detected; acquisition stopped.',{state:'denied'});
  return raw;
 })();
 try{return await Promise.race([operation,deadline])}
 catch(error){if(error instanceof SourceFailure)throw error;throw new SourceFailure('Treasury transport outcome is unconfirmed; acquisition stopped.',{state:'uncertain'});}
 finally{clearTimeout(timer!)}
}
/** Read-through only. Both cache keys and every instance share one persistent Treasury gate. */
export async function getCachedSource<T extends {version:string;period?:string;end_period?:string}>(repo:CacheRepository<T>,parse:(value:unknown)=>T,normalizeSource:(raw:Uint8Array,retrievedAt:string)=>Promise<T>,fetcher:typeof fetch=fetch,now=Date.now()){
 const read=(row:CacheRow|null,gate:SourceGateView)=>{
  const result=readCachedSource(row,now,parse);
  result.status.source_status=gate.state;
  result.status.next_retry_at=gate.retryAt===null?null:new Date(gate.retryAt).toISOString();
  if(gate.state!=='ready'){
   result.status.state=result.snapshot?'stale':'unavailable';
   result.status.error=gate.error||({checking:'Treasury source check is pending; no parallel acquisition is permitted.',cooldown:'Treasury source check is cooling down.',denied:'Treasury access was refused; acquisition stopped.',uncertain:'Treasury request outcome is unconfirmed; acquisition stopped.',coordination_unavailable:'Treasury source coordination is unavailable; acquisition stopped.'}[gate.state]);
  }
  if(gate.checkedAt!==null)result.status.last_checked_at=new Date(gate.checkedAt).toISOString();
  return result;
 };
 const unavailable:SourceGateView={state:'coordination_unavailable',retryAt:null,error:null,checkedAt:null};
 await repo.ensure();let row=await repo.load();
 let gate:SourceGateView;
 try{await repo.sourceGate.ensure();gate=await repo.sourceGate.inspect(now)}catch{return read(row,unavailable)}
 if(gate.state!=='ready')return read(row,gate);
 if(row&&row.lastAttemptMs!==null&&now-row.lastAttemptMs<(row.error?FAILURE_BACKOFF_MS:row.payload?DAY_MS:30_000))return read(row,gate);
 const token=crypto.randomUUID();
 try{if(!await repo.sourceGate.claim(now,token))return read(row,await repo.sourceGate.inspect(now))}catch{return read(row,unavailable)}
 // No source operation is allowed before both claims are confirmed.
 try{
  if(!await repo.claim(now,token)){
   await repo.sourceGate.finish(token,{state:'ready'},now);
   return read(await repo.load(),await repo.sourceGate.inspect(now));
  }
 }catch{return read(row,unavailable)}
 let outcome:SourceOutcome={state:'ready'};
 try{
  const raw=await acquireSource(fetcher);
  const snapshot=await normalizeSource(raw,new Date(now).toISOString());
  const previous=readCachedSource(row,now,parse).snapshot,previousPeriod=previous?.period??previous?.end_period,nextPeriod=snapshot.period??snapshot.end_period;
  if(previousPeriod&&nextPeriod&&nextPeriod<previousPeriod)throw new Error(`Treasury observation month regressed from ${previousPeriod} to ${nextPeriod}; retaining last validated snapshot`);
  // A publication failure is not an ordinary upstream error: its result may be unknown.
  try{await repo.success(token,snapshot,now)}catch{throw new SourceFailure('TIC cache publication outcome is unconfirmed; acquisition stopped.',{state:'uncertain'})}
 }catch(error){
  const message=error instanceof Error?error.message:'Public source check failed';
  outcome=error instanceof SourceFailure?{...error.outcome,error:message}:{state:'cooldown',delayMs:FAILURE_BACKOFF_MS,error:message};
  try{await repo.failure(token,message.slice(0,500))}catch{return read(row,unavailable)}
 }
 try{await repo.sourceGate.finish(token,outcome,now);gate=await repo.sourceGate.inspect(now)}catch{return read(await repo.load(),unavailable)}
 row=await repo.load();return read(row,gate);
}
export function getTic(repo:CacheRepository,fetcher:typeof fetch=fetch,now=Date.now()){
 return getCachedSource(repo,value=>snapshotSchema.parse(value),(raw,retrievedAt)=>normalize(raw,undefined,retrievedAt),fetcher,now);
}
