import {SourceGateError,type GateD1,type D1Result} from '../ashare/source-gate';
import {strictJSON} from '../ashare/strict-json';
import {CHECK_INTERVAL_MS,RETRY_INTERVAL_MS,CACHE_TTL_MS,fxSnapshotSchema,fxErrorCode,type FxSnapshot,type FxErrorCode} from './model';
export type FxOutcome={kind:'success';snapshot:FxSnapshot}|{kind:'temporary_failure';error:FxErrorCode}|{kind:'denied'};
export type FxGateState={state:'idle'|'busy'|'blocked';retryAt:number;nowMs:number;checkedAt:string|null;snapshot:FxSnapshot|null;expired:boolean;errorCode:FxErrorCode|null};
export interface FxGate {inspect():Promise<FxGateState>;acquire(signal?:AbortSignal):Promise<{token:string}>;release(token:string,outcome:FxOutcome):Promise<void>}
const NOW="(CAST(strftime('%s','now') AS INTEGER)*1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER))";
const MAX_CACHE_BYTES=32_768;
const temporaryErrors=new Set<FxErrorCode>(['network_error','source_unavailable','invalid_source','source_older']);
/** Independent ECB gate and public reference cache. One guarded UPDATE publishes
 * the validated snapshot and cooldown together. Busy/denied never expire/reset.
 * Use the primary D1 binding, never an eventually consistent replica session. */
export const FX_SQL={
 acquire:`UPDATE ecb_fx_source_gate SET status='busy', lease_token=?, updated_ms=${NOW} WHERE id='daily_reference' AND status='idle' AND not_before_ms<=${NOW} RETURNING status`,
 inspect:`SELECT status, not_before_ms, payload, expires_ms, checked_ms, error_code, ${NOW} AS now_ms FROM ecb_fx_source_gate WHERE id='daily_reference'`,
 finish:`UPDATE ecb_fx_source_gate SET status=?, lease_token=NULL, updated_ms=${NOW}, not_before_ms=${NOW}+?,
  payload=CASE WHEN ? THEN NULL ELSE COALESCE(?,payload) END,
  expires_ms=CASE WHEN ? THEN 0 WHEN ? IS NOT NULL THEN ? ELSE expires_ms END,
  checked_ms=${NOW}, error_code=?
  WHERE id='daily_reference' AND status='busy' AND lease_token=?
  AND (? IS NULL OR payload IS NULL OR json_extract(payload,'$.reference_date')<=?) RETURNING status`,
};
export class D1FxGate implements FxGate{
 constructor(private readonly db:GateD1){}
 private async run(sql:string,...values:unknown[]):Promise<D1Result>{try{const result=await this.db.prepare(sql).bind(...values).run();if(!result.success)throw new Error();return result;}catch{throw new SourceGateError('source_gate_unavailable');}}
 async inspect():Promise<FxGateState>{
  const row=(await this.run(FX_SQL.inspect)).results?.[0];
  const validMs=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=8_640_000_000_000_000;
  if(!row||!['idle','busy','blocked'].includes(String(row.status))||!validMs(row.not_before_ms)||!validMs(row.now_ms)||!validMs(row.checked_ms)||!validMs(row.expires_ms)||row.checked_ms>row.now_ms)throw new SourceGateError('source_gate_unavailable');
  const state=row.status as FxGateState['state'];
  // No cached bytes can escape an unconfirmed, busy or denied gate.
  if(state!=='idle')return {state,retryAt:row.not_before_ms,nowMs:row.now_ms,checkedAt:row.checked_ms?new Date(row.checked_ms).toISOString():null,snapshot:null,expired:false,errorCode:state==='blocked'?'source_stopped':'source_busy'};
  let snapshot:FxSnapshot|null=null,errorCode:FxErrorCode|null=null;
  try{
   if(row.error_code!==null){errorCode=fxErrorCode.parse(row.error_code);if(!temporaryErrors.has(errorCode))throw new Error();}
   if(row.payload!==null){
    if(typeof row.payload!=='string'||new TextEncoder().encode(row.payload).byteLength>MAX_CACHE_BYTES)throw new Error();
    snapshot=fxSnapshotSchema.parse(strictJSON(row.payload));
    const retrieved=Date.parse(snapshot.retrieved_at);
    if(!row.checked_ms||retrieved>row.checked_ms+60_000||row.expires_ms!==retrieved+CACHE_TTL_MS)throw new Error();
   }else if(row.expires_ms!==0)throw new Error();
  }catch{throw new SourceGateError('source_gate_unavailable');}
  return {state,retryAt:row.not_before_ms,nowMs:row.now_ms,checkedAt:row.checked_ms?new Date(row.checked_ms).toISOString():null,snapshot,expired:!!snapshot&&row.expires_ms<=row.now_ms,errorCode};
 }
 async acquire(signal?:AbortSignal){
  if(signal?.aborted)throw new SourceGateError('source_aborted');
  const token=crypto.randomUUID(),result=await this.run(FX_SQL.acquire,token);
  if(result.meta?.changes===1){if(signal?.aborted){await this.release(token,{kind:'temporary_failure',error:'network_error'});throw new SourceGateError('source_aborted');}return {token};}
  if(result.meta?.changes!==0)throw new SourceGateError('source_gate_unavailable');
  const state=await this.inspect();
  if(state.state==='blocked')throw new SourceGateError('source_denied');
  if(state.state==='busy')throw new SourceGateError('source_busy');
  if(state.retryAt>state.nowMs)throw new SourceGateError('source_cooldown');
  throw new SourceGateError('source_gate_unavailable');
 }
 async release(token:string,outcome:FxOutcome){
  if(!token||!['success','temporary_failure','denied'].includes(outcome.kind))throw new SourceGateError('source_gate_unavailable');
  let payload:string|null=null,expires=0,referenceDate:string|null=null;
  if(outcome.kind==='success'){
   const candidate=fxSnapshotSchema.safeParse(outcome.snapshot);if(!candidate.success)throw new SourceGateError('source_gate_unavailable');
   payload=JSON.stringify(candidate.data);expires=Date.parse(candidate.data.retrieved_at)+CACHE_TTL_MS;referenceDate=candidate.data.reference_date;
   if(new TextEncoder().encode(payload).byteLength>MAX_CACHE_BYTES||!Number.isSafeInteger(expires))throw new SourceGateError('source_gate_unavailable');
  }else if(outcome.kind==='temporary_failure'&&!temporaryErrors.has(outcome.error))throw new SourceGateError('source_gate_unavailable');
  const denied=outcome.kind==='denied',delay=outcome.kind==='success'?CHECK_INTERVAL_MS:RETRY_INTERVAL_MS;
  const result=await this.run(FX_SQL.finish,denied?'blocked':'idle',delay,denied?1:0,payload,denied?1:0,payload,expires,outcome.kind==='temporary_failure'?outcome.error:null,token,referenceDate,referenceDate);
  if(result.meta?.changes===0)throw new SourceGateError('source_stale_lease');if(result.meta?.changes!==1)throw new SourceGateError('source_gate_unavailable');
 }
}
