import {type Scope,type ValidEvidence,scopeKey,validateEvidence} from './model';
import {safeSourceCode,isSourceStopped,describeRecovery} from '@/lib/ashare/recovery';
export type Recovery={code:string;mode:'retry'|'stopped';retryAt:number|null;httpStatus:number|null};
export type EvidenceState={snapshot:ValidEvidence|null;etag:string|null;status:'ready'|'stale'|'blocked'|'error'|'empty';message:string;recovery?:Recovery;retainedAfterFailure?:boolean;retainedDuringCollection?:boolean};
export type WireReply={status:number;etag?:string;payload?:unknown;errorCode?:string;recoveryMode?:string;retryAfter?:string};
export type Transport=(request:{ifNoneMatch?:string;scope:Scope})=>Promise<WireReply>;
export const emptyState=():EvidenceState=>({snapshot:null,etag:null,status:'empty',message:'尚未接入来源'});
/** Retry-After can be seconds or an HTTP date. Never shorten a valid cooldown. */
export function retryAt(value:string|undefined,now:number):number {
 if(value&&/^\d+$/.test(value)){const seconds=Number(value);if(Number.isSafeInteger(seconds)&&Number.isSafeInteger(now+seconds*1000))return now+Math.max(1000,seconds*1000);}
 const date=value&&!/^\d+$/.test(value)?Date.parse(value):NaN;
 return Number.isFinite(date)?Math.max(now+1000,date):now+60_000;
}
function recoveryFor(reply:WireReply,now:number,fallback?:string):Recovery|undefined {
 const payload=reply.payload;
 const bodyCode=payload&&typeof payload==='object'&&'error_code'in payload?payload.error_code:undefined;
 const code=safeSourceCode(reply.errorCode)??safeSourceCode(bodyCode)??(reply.recoveryMode==='stopped'?'collection_failed':fallback);
 if(!code)return;
 const stopped=reply.recoveryMode==='stopped'||isSourceStopped(code);
 return {code,mode:stopped?'stopped':'retry',retryAt:stopped?null:retryAt(reply.retryAfter,now),httpStatus:reply.status||null};
}
function failure(previous:EvidenceState,scope:Scope,recovery:Recovery):EvidenceState {
 const message=describeRecovery(recovery.code).message;
 if(recovery.mode==='stopped')return {snapshot:null,etag:null,status:'blocked',message,recovery};
 if(previous.snapshot&&scopeKey(previous.snapshot.scope)===scopeKey(scope))return {...previous,status:'stale',message,recovery,retainedAfterFailure:recovery.code!=='collection_in_progress',retainedDuringCollection:recovery.code==='collection_in_progress'};
 return {snapshot:null,etag:null,status:'error',message,recovery};
}
export function consumeReply(previous:EvidenceState,reply:WireReply,scope:Scope,now=Date.now()):EvidenceState {
 const clear=(status:EvidenceState['status'],message:string):EvidenceState=>({snapshot:null,etag:null,status,message});
 if(reply.status===401||reply.status===403)return {...clear('blocked',reply.status===401?'当前登录已失效，已清空缓存数据；请重新登录。':'来源展示权限未建立，已清空缓存数据'),recovery:{code:'disabled',mode:'stopped',retryAt:null,httpStatus:reply.status}};
 const recovery=recoveryFor(reply,now);
 if(recovery?.mode==='stopped')return failure(previous,scope,recovery);
 if(reply.status===304){
  if(!previous.snapshot||scopeKey(previous.snapshot.scope)!==scopeKey(scope))return clear('error','304没有匹配scope的已验证缓存');
  // Retained browser bytes remain unchanged under their ETag. A successful
  // revalidation removes only the browser's temporary failure marker.
  const snapshot=previous.snapshot;
  const issue=recovery??(snapshot.has_error?recoveryFor(reply,now,'collection_failed'):undefined);
  return {snapshot,etag:reply.etag||previous.etag,status:snapshot.stale||issue?'stale':'ready',message:snapshot.stale?'明确标记的陈旧快照；不是最新行情':'',...(issue?{recovery:issue}:{})};
 }
 if(reply.status>=500&&reply.status<=599)return failure(previous,scope,recovery??recoveryFor(reply,now,'collection_failed')!);
 if(reply.status!==200)return clear('error',`来源响应失败（HTTP ${reply.status}），已清空缓存数据`);
 try {
  const snapshot=validateEvidence(reply.payload,scope);
  if(snapshot.has_error&&!snapshot.stale)return clear('error','错误响应没有明确标记stale，已清空');
  const issue=recovery??(snapshot.has_error?recoveryFor(reply,now,'collection_failed'):undefined);
  return {snapshot,etag:reply.etag||null,status:snapshot.stale||issue?'stale':'ready',message:snapshot.stale?'明确标记的陈旧快照；不是最新行情':'',...(issue?{recovery:issue}:{})};
 }catch{return clear('error','来源数据校验失败，已清空缓存数据');}
}
/** Memory-only, same-scope retention. No local storage or new source access. */
export function createEvidenceClient(transport:Transport,now=()=>Date.now()) {
 let state=emptyState(),generation=0,currentScope:string|null=null;
 const canLoad=(scope:Scope)=>scopeKey(scope)!==currentScope||(!state.recovery||state.recovery.mode==='retry'&&now()>=state.recovery.retryAt!);
 return {
  getState:()=>state,canLoad,
  clear(){generation++;currentScope=null;state=emptyState();},
  async load(scope:Scope){
   if(!canLoad(scope))return state;
   const id=++generation,key=scopeKey(scope);
   if(key!==currentScope){currentScope=key;state=emptyState();}
   const prior=state;
   try{const reply=await transport({scope,...(prior.etag?{ifNoneMatch:prior.etag}:{})});if(id===generation)state=consumeReply(prior,reply,scope,now());}
   catch{if(id===generation)state=failure(prior,scope,{code:'browser_network',mode:'retry',retryAt:now()+60_000,httpStatus:null});}
   return state;
  },
 };
}
