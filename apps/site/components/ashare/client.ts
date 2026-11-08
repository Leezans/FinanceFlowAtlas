import {ashareSnapshotExpired} from '@/lib/ashare/retention';
import {type Scope,type ValidEvidence,scopeKey,validateEvidence} from './model';
import {safeSourceCode,isSourceStopped,describeRecovery} from '@/lib/ashare/recovery';
import {collectionContinuationAt} from '@/lib/ashare/collection-batch';
export type Recovery={code:string;mode:'retry'|'stopped';retryAt:number|null;httpStatus:number|null};
export type EvidenceState={snapshot:ValidEvidence|null;etag:string|null;status:'ready'|'stale'|'blocked'|'error'|'empty';message:string;recovery?:Recovery;retainedAfterFailure?:boolean;retainedDuringCollection?:boolean;nextCheckAt?:number;continuationAt?:number};
export type WireReply={status:number;etag?:string;payload?:unknown;errorCode?:string;recoveryMode?:string;retryAfter?:string;refreshAfter?:string};
export type Transport=(request:{ifNoneMatch?:string;scope:Scope})=>Promise<WireReply>;
/** Browser-to-application timeout only; never a claim about the provider outcome. */
export class BrowserTimeoutError extends Error {constructor(readonly retryNotBefore?:number){super('browser_timeout');this.name='BrowserTimeoutError';}}
export const emptyState=():EvidenceState=>({snapshot:null,etag:null,status:'empty',message:'尚未接入来源'});
/** Retry-After can be seconds or an HTTP date. Never shorten a valid cooldown. */
export function retryAt(value:string|undefined,now:number):number {
 if(value&&/^\d+$/.test(value)){const seconds=Number(value);if(Number.isSafeInteger(seconds)&&Number.isSafeInteger(now+seconds*1000))return now+Math.max(1000,seconds*1000);}
 const date=value&&!/^\d+$/.test(value)?Date.parse(value):NaN;
 return Number.isFinite(date)?Math.max(now+1000,date):now+60_000;
}
/** A server-relative cache check hint, not a market observation timestamp.
 * Ignore malformed/out-of-range hints; recovery and Retry-After always win. */
function checkTime(reply:WireReply,now:number):{nextCheckAt?:number} {
 const seconds=reply.refreshAfter&&/^[0-9]{1,2}$/.test(reply.refreshAfter)?Number(reply.refreshAfter):NaN;
 return Number.isInteger(seconds)&&seconds>=1&&seconds<=60&&Number.isSafeInteger(now+seconds*1000)?{nextCheckAt:now+seconds*1000}:{};
}
function recoveryFor(reply:WireReply,now:number,fallback?:string):Recovery|undefined {
 const payload=reply.payload;
 const bodyCode=payload&&typeof payload==='object'&&'error_code'in payload?payload.error_code:undefined;
 const headerCode=safeSourceCode(reply.errorCode),payloadCode=safeSourceCode(bodyCode);
 // Either explicit stop must win, even when the other diagnostic says retry.
 const code=[headerCode,payloadCode].find(value=>value!==null&&isSourceStopped(value))??headerCode??payloadCode??(reply.recoveryMode==='stopped'?'collection_failed':fallback);
 if(!code)return;
 const stopped=reply.recoveryMode==='stopped'||isSourceStopped(code);
 return {code,mode:stopped?'stopped':'retry',retryAt:stopped?null:retryAt(reply.retryAfter,now),httpStatus:reply.status||null};
}
function failure(previous:EvidenceState,scope:Scope,recovery:Recovery,now:number):EvidenceState {
 previous=expireEvidenceState(previous,now);
 const message=describeRecovery(recovery.code).message;
 if(recovery.mode==='stopped')return {snapshot:null,etag:null,status:'blocked',message,recovery};
 if(previous.snapshot&&scopeKey(previous.snapshot.scope)===scopeKey(scope))return {...previous,continuationAt:undefined,status:'stale',message,recovery,retainedAfterFailure:recovery.code!=='collection_in_progress',retainedDuringCollection:recovery.code==='collection_in_progress'};
 return {snapshot:null,etag:null,status:'error',message,recovery};
}
/** Evict bytes only. Recovery and scheduling remain independent of retention. */
export function expireEvidenceState(state:EvidenceState,now=Date.now()):EvidenceState {
 if(!state.snapshot||!ashareSnapshotExpired(state.snapshot,now))return state;
 return {...state,snapshot:null,etag:null,status:state.status==='blocked'?'blocked':'error',
  message:'快照已超过24小时保留期限，已清空缓存数据。',retainedAfterFailure:undefined,retainedDuringCollection:undefined};
}
export function consumeReply(previous:EvidenceState,reply:WireReply,scope:Scope,now=Date.now()):EvidenceState {
 return expireEvidenceState(consumeCurrentReply(previous,reply,scope,now),now);
}
function consumeCurrentReply(previous:EvidenceState,reply:WireReply,scope:Scope,now:number):EvidenceState {
 const clear=(status:EvidenceState['status'],message:string):EvidenceState=>({snapshot:null,etag:null,status,message});
 if(reply.status===401||reply.status===403)return {...clear('blocked',reply.status===401?'当前登录已失效，已清空缓存数据；请重新登录。':'来源展示权限未建立，已清空缓存数据'),recovery:{code:'disabled',mode:'stopped',retryAt:null,httpStatus:reply.status}};
 const recovery=recoveryFor(reply,now);
 if(recovery?.mode==='stopped')return failure(previous,scope,recovery,now);
 const continuation=()=>{const at=collectionContinuationAt(reply,now);return at===undefined?{}:{continuationAt:at};};
 if(reply.status===304){
  if(!previous.snapshot||scopeKey(previous.snapshot.scope)!==scopeKey(scope))return {...clear('error','304没有匹配scope的已验证缓存'),...(recovery?{recovery}:{})};
  // Retained browser bytes remain unchanged under their ETag. A successful
  // revalidation removes only the browser's temporary failure marker.
  const snapshot=previous.snapshot;
  const issue=recovery??(snapshot.has_error?recoveryFor(reply,now,'collection_failed'):undefined);
  return {snapshot,etag:reply.etag||previous.etag,status:snapshot.stale||issue?'stale':'ready',message:snapshot.stale?'明确标记的陈旧快照；不是最新行情':'',...(issue?{recovery:issue,...continuation()}:checkTime(reply,now))};
 }
 // A gateway/application rate limit is not evidence of a provider outcome.
 // Preserve the existing clear-on-429 behavior, but never discard its cooldown.
 if(reply.status===429)return {...clear('error','应用请求限速，已清空缓存数据'),recovery:recovery??recoveryFor(reply,now,'browser_rate_limited')!};
 if(reply.status>=500&&reply.status<=599)return {...failure(previous,scope,recovery??recoveryFor(reply,now,'collection_failed')!,now),...continuation()};
 if(reply.status!==200)return clear('error',`来源响应失败（HTTP ${reply.status}），已清空缓存数据`);
 try {
  const snapshot=validateEvidence(reply.payload,scope);
  if(snapshot.has_error&&!snapshot.stale)return clear('error','错误响应没有明确标记stale，已清空');
  const issue=recovery??(snapshot.has_error?recoveryFor(reply,now,'collection_failed'):undefined);
  return {snapshot,etag:reply.etag||null,status:snapshot.stale||issue?'stale':'ready',message:snapshot.stale?'明确标记的陈旧快照；不是最新行情':'',...(issue?{recovery:issue,...(snapshot.has_error?{}:continuation())}:checkTime(reply,now))};
 }catch{return clear('error','来源数据校验失败，已清空缓存数据');}
}
/** Memory-only, same-scope retention. No local storage or new source access. */
export function createEvidenceClient(transport:Transport,now=()=>Date.now()) {
 let state=emptyState(),generation=0,currentScope:string|null=null;
 const getState=()=>{state=expireEvidenceState(state,now());return state;};
 const canLoad=(scope:Scope)=>scopeKey(scope)!==currentScope||(!state.recovery||state.recovery.mode==='retry'&&now()>=state.recovery.retryAt!);
 return {
  getState,canLoad,
  clear(){generation++;currentScope=null;state=emptyState();},
  async load(scope:Scope){
   getState();
   if(!canLoad(scope))return state;
   const id=++generation,key=scopeKey(scope);
   if(key!==currentScope){currentScope=key;state=emptyState();}
   try{const reply=await transport({scope,...(state.etag?{ifNoneMatch:state.etag}:{})});if(id===generation)state=consumeReply(state,reply,scope,now());}
   catch(error){if(id===generation)state=failure(state,scope,{code:error instanceof BrowserTimeoutError?'browser_timeout':'browser_network',mode:'retry',retryAt:Math.max(now()+60_000,error instanceof BrowserTimeoutError?error.retryNotBefore??0:0),httpStatus:null},now());}
   return state;
  },
 };
}
