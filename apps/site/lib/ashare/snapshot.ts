import {strictJSON} from './strict-json';
export const NUMERIC_FIELDS=['f2','f3','f62','f184','f66','f69','f72','f75','f78','f81','f84','f87'] as const;
export const FIELDS=['f12','f14',...NUMERIC_FIELDS] as const;
export type Scope={kind:'industry_rank'|'industry_stocks';fs:string;classification_level:'eastmoney_level_1'|'unknown_may_mix_levels'};
export type Row={f12:string;f14:string}&Record<typeof NUMERIC_FIELDS[number],number|null|'-'|'--'|''>;
export type Snapshot={rows:Row[];source_total:number;fetched_at:string;scope:Scope;page_count:number;collection_started_at?:string};
export const SNAPSHOT_FRESH_MS=60_000;
export const SNAPSHOT_MAX_AGE_MS=86_400_000;
export const SNAPSHOT_MAX_BYTES=2_000_000;
export const SNAPSHOT_MAX_SCOPES=32;
export function parseScope(url:URL):Scope {
  if([...url.searchParams.keys()].some(k=>k!=='scope')||url.searchParams.getAll('scope').length>1)throw new Error('invalid_scope');
  const scope=url.searchParams.get('scope')??'level1';
  if(scope==='level1')return {kind:'industry_rank',fs:'m:90+s:2+f:!50',classification_level:'eastmoney_level_1'};
  if(/^BK[0-9]{4}$/.test(scope))return {kind:'industry_stocks',fs:`b:${scope}`,classification_level:'unknown_may_mix_levels'};
  throw new Error('invalid_scope');
}
export function validateRow(value:unknown,scope:Scope):Row {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('invalid_row');
  const obj=value as Record<string,unknown>;
  if(!FIELDS.every(k=>Object.hasOwn(obj,k)))throw new Error('missing_fields');
  if(typeof obj.f12!=='string'||!(scope.kind==='industry_stocks'?/^[0-9]{6}$/:/^BK[0-9]{4}$/).test(obj.f12))throw new Error('invalid_id');
  if(typeof obj.f14!=='string'||!obj.f14.trim()||obj.f14.length>128)throw new Error('invalid_name');
  for(const key of NUMERIC_FIELDS){const v=obj[key];if(v===null||v==='-'||v==='--'||v==='')continue;if(typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>Number.MAX_SAFE_INTEGER)throw new Error('invalid_numeric');}
  if(typeof obj.f2==='number'&&obj.f2<0)throw new Error('negative_price');
  if(typeof obj.f3==='number'&&obj.f3< -100)throw new Error('invalid_return');
  return Object.fromEntries(FIELDS.map(k=>[k,obj[k]])) as Row;
}

export function scopeKey(scope:Scope):string {return scope.kind==='industry_rank'?'level1':scope.fs.slice(2);}
/** Same row contract on acquisition, durable writes and durable reads. */
export function validateSnapshot(value:unknown,scope:Scope):Snapshot {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('snapshot_invalid');
  const s=value as Snapshot;
  if(!s.scope||s.scope.kind!==scope.kind||s.scope.fs!==scope.fs||s.scope.classification_level!==scope.classification_level||
    !Number.isSafeInteger(s.source_total)||s.source_total<1||s.source_total>2000||!Array.isArray(s.rows)||s.rows.length!==s.source_total||
    s.page_count!==Math.ceil(s.source_total/100)||typeof s.fetched_at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s.fetched_at)||
    !Number.isFinite(Date.parse(s.fetched_at))||new Date(s.fetched_at).toISOString()!==s.fetched_at)throw new Error('snapshot_invalid');
  if(s.collection_started_at!==undefined&&(typeof s.collection_started_at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s.collection_started_at)||!Number.isFinite(Date.parse(s.collection_started_at))||Date.parse(s.collection_started_at)>Date.parse(s.fetched_at)||Date.parse(s.fetched_at)-Date.parse(s.collection_started_at)>180_000))throw new Error('snapshot_invalid');
  const rows=s.rows.map(value=>validateRow(value,scope));
  if(new Set(rows.map(value=>value.f12)).size!==rows.length)throw new Error('snapshot_invalid');
  return {rows,source_total:s.source_total,fetched_at:s.fetched_at,scope,page_count:s.page_count,...(s.collection_started_at?{collection_started_at:s.collection_started_at}:{})};
}
export function encodeSnapshot(snapshot:Snapshot):string {
  const canonical=parseScope(new URL('https://scope.invalid/?scope='+scopeKey(snapshot.scope)));
  const payload=JSON.stringify(validateSnapshot(snapshot,canonical));
  if(new TextEncoder().encode(payload).length>SNAPSHOT_MAX_BYTES)throw new Error('snapshot_invalid');
  return payload;
}
export function decodeSnapshot(payload:unknown,scope:Scope):Snapshot {
  if(typeof payload!=='string'||new TextEncoder().encode(payload).length>SNAPSHOT_MAX_BYTES)throw new Error('snapshot_invalid');
  return validateSnapshot(strictJSON(payload),scope);
}
