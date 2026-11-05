import {parseScope,scopeKey,validateRow,type Row,type Scope} from './snapshot';
import {strictJSON} from './strict-json';

/** Private partial acquisition, never a snapshot or permission to contact a source. */
export type Stage={
  scope:Scope;rows:Row[];source_total:number;page_count:number;started_at:string;updated_at:string;
  endpoint:'primary'|'official_redirect';redirect_count:0|1;bytes:number;
};
export const STAGE_MAX_AGE_MS=180_000;
export const STAGE_MAX_BYTES=2_000_000;
export const STAGE_MAX_SOURCE_BYTES=4_000_000;
export const STAGE_MAX_SCOPES=32;
export const STAGE_MAX_ROWS=2000;
export const STAGE_MAX_PAGES=20;
const timestamp=(value:unknown):number=>{
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))throw new Error('stage_invalid');
  const time=Date.parse(value);
  if(!Number.isSafeInteger(time)||time<0||new Date(time).toISOString()!==value)throw new Error('stage_invalid');
  return time;
};
/** Canonical scope validation is independent of a caller-supplied scope object. */
export function canonicalStageScope(scope:Scope):Scope {
  if(!scope||typeof scope!=='object')throw new Error('stage_invalid');
  let canonical:Scope;
  try{canonical=parseScope(new URL('https://scope.invalid/?scope='+scopeKey(scope)));}
  catch{throw new Error('stage_invalid');}
  if(scope.kind!==canonical.kind||scope.fs!==canonical.fs||scope.classification_level!==canonical.classification_level)
    throw new Error('stage_invalid');
  return canonical;
}
/** Validate the complete prefix, including page boundaries and the original age. */
export function validateStage(value:unknown,scope:Scope,nowMs?:number):Stage {
  const canonical=canonicalStageScope(scope);
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('stage_invalid');
  const s=value as Stage;
  if(!s.scope||s.scope.kind!==canonical.kind||s.scope.fs!==canonical.fs||s.scope.classification_level!==canonical.classification_level||
    !Number.isSafeInteger(s.source_total)||s.source_total<1||s.source_total>STAGE_MAX_ROWS||
    !Number.isSafeInteger(s.page_count)||s.page_count<1||s.page_count>STAGE_MAX_PAGES||
    !Array.isArray(s.rows)||s.rows.length!==Math.min(s.page_count*100,s.source_total)||s.rows.length>=s.source_total||
    !Number.isSafeInteger(s.bytes)||s.bytes<1||s.bytes>STAGE_MAX_SOURCE_BYTES||
    !((s.endpoint==='primary'&&s.redirect_count===0)||(s.endpoint==='official_redirect'&&s.redirect_count===1)))
    throw new Error('stage_invalid');
  const started=timestamp(s.started_at),updated=timestamp(s.updated_at);
  if(updated<started||updated-started>=STAGE_MAX_AGE_MS)throw new Error('stage_invalid');
  if(nowMs!==undefined&&(!Number.isSafeInteger(nowMs)||nowMs<updated||nowMs-started>=STAGE_MAX_AGE_MS))
    throw new Error('stage_invalid');
  let rows:Row[];
  try{rows=s.rows.map(row=>validateRow(row,canonical));}catch{throw new Error('stage_invalid');}
  if(rows.some((row,index)=>index>0&&rows[index-1].f12<=row.f12))throw new Error('stage_invalid');
  return {scope:canonical,rows,source_total:s.source_total,page_count:s.page_count,started_at:s.started_at,updated_at:s.updated_at,
    endpoint:s.endpoint,redirect_count:s.redirect_count,bytes:s.bytes};
}
export function encodeStage(stage:Stage):string {
  const payload=JSON.stringify(validateStage(stage,stage.scope));
  if(new TextEncoder().encode(payload).length>STAGE_MAX_BYTES)throw new Error('stage_invalid');
  return payload;
}
export function decodeStage(payload:unknown,scope:Scope,nowMs?:number):Stage {
  if(typeof payload!=='string'||new TextEncoder().encode(payload).length>STAGE_MAX_BYTES)throw new Error('stage_invalid');
  try{return validateStage(strictJSON(payload),scope,nowMs);}catch{throw new Error('stage_invalid');}
}
