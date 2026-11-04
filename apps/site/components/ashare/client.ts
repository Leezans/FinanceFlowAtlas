import {type Scope,type ValidEvidence,scopeKey,validateEvidence} from './model';
export type EvidenceState={snapshot:ValidEvidence|null;etag:string|null;status:'ready'|'stale'|'blocked'|'error'|'empty';message:string};
export type WireReply={status:number;etag?:string;payload?:unknown};
export type Transport=(request:{ifNoneMatch?:string;scope:Scope})=>Promise<WireReply>;
export const emptyState=():EvidenceState=>({snapshot:null,etag:null,status:'empty',message:'尚未接入来源'});
export function consumeReply(previous:EvidenceState,reply:WireReply,scope:Scope):EvidenceState{
 const clear=(status:EvidenceState['status'],message:string):EvidenceState=>({snapshot:null,etag:null,status,message});
 if(reply.status===403)return clear('blocked','来源展示权限未建立，已清空缓存数据');
 if(reply.status===304){if(!previous.snapshot||scopeKey(previous.snapshot.scope)!==scopeKey(scope))return clear('error','304没有匹配scope的已验证缓存');return {...previous,etag:reply.etag||previous.etag}}
 if(reply.status!==200)return clear('error',`来源响应失败（HTTP ${reply.status}），不沿用旧数据`);
 try{const snapshot=validateEvidence(reply.payload,scope);if(snapshot.has_error&&!snapshot.stale)return clear('error','错误响应没有明确标记stale，已清空');return {snapshot,etag:reply.etag||null,status:snapshot.stale?'stale':'ready',message:snapshot.stale?'明确标记的陈旧快照；不是最新行情':''}}catch(error){return clear('error',error instanceof Error?error.message:'Invalid snapshot')}
}
/** Injected transport only. No global fetch, endpoint, schedule, provider access or rights approval. */
export function createEvidenceClient(transport:Transport){let state=emptyState(),generation=0;return {getState:()=>state,clear(){generation++;state=emptyState()},async load(scope:Scope){const id=++generation;if(state.snapshot&&scopeKey(state.snapshot.scope)!==scopeKey(scope))state=emptyState();const prior=state;try{const reply=await transport({scope,...(prior.etag?{ifNoneMatch:prior.etag}:{})});if(id===generation)state=consumeReply(prior,reply,scope)}catch{if(id===generation)state={snapshot:null,etag:null,status:'error',message:'请求失败，旧数据已清空'}}return state}}}
