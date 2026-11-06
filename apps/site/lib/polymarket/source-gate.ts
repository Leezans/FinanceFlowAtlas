import {SourceGateError,type GateD1,type D1Result} from '../ashare/source-gate';
import {strictJSON} from '../ashare/strict-json';
import {REFRESH_MS,INTEREST_REFRESH_MS,MAX_CACHE_BYTES,storedCacheSchema,type PolymarketView,type PolymarketStoredCache} from './model';
import type {PolymarketGate,PolymarketOutcome} from './handler';
const NOW="(CAST(strftime('%s','now') AS INTEGER)*1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER))";
/** Independent shared cache/admission. No automatic reset, takeover or credentials. */
export const POLYMARKET_SQL={
 acquire:`UPDATE polymarket_source_gate SET status='busy', lease_token=?, lease_view='discovery', updated_ms=${NOW} WHERE id='active_markets' AND status='idle' AND not_before_ms<=${NOW} RETURNING status`,
 acquireInterest:`UPDATE polymarket_source_gate SET status='busy', lease_token=?, lease_view='interest', updated_ms=${NOW} WHERE id='active_markets' AND status='idle' AND not_before_ms<=${NOW} AND interest_not_before_ms<=${NOW} RETURNING status`,
 inspect:`SELECT status, not_before_ms, interest_not_before_ms, interest_error_code, interest_checked_ms, payload, error_code, checked_ms, ${NOW} AS now_ms FROM polymarket_source_gate WHERE id='active_markets'`,
 finish:`UPDATE polymarket_source_gate SET status=?, lease_token=NULL, interest_not_before_ms=CASE WHEN lease_view='interest' THEN ${NOW}+? ELSE interest_not_before_ms END, interest_checked_ms=CASE WHEN lease_view='interest' THEN ${NOW} ELSE interest_checked_ms END, interest_error_code=CASE WHEN lease_view='interest' THEN ? ELSE interest_error_code END, lease_view=NULL, updated_ms=${NOW}, checked_ms=CASE WHEN lease_view='interest' THEN checked_ms ELSE ${NOW} END, not_before_ms=${NOW}+?, error_code=CASE WHEN lease_view='interest' AND ?<>'blocked' THEN error_code ELSE ? END, payload=CASE WHEN ? THEN NULL ELSE COALESCE(?,payload) END WHERE id='active_markets' AND status='busy' AND lease_token=? RETURNING status`,
};
export class D1PolymarketGate implements PolymarketGate{
 constructor(private readonly db:GateD1){}
 private async run(sql:string,...values:unknown[]):Promise<D1Result>{try{const result=await this.db.prepare(sql).bind(...values).run();if(!result.success)throw new Error();return result;}catch{throw new SourceGateError('source_gate_unavailable');}}
 async inspect(view:PolymarketView='newest'){
  const row=(await this.run(POLYMARKET_SQL.inspect)).results?.[0];
  if(!row||!['idle','busy','blocked'].includes(String(row.status))||typeof row.not_before_ms!=='number'||!Number.isSafeInteger(row.not_before_ms)||row.not_before_ms<0||typeof row.checked_ms!=='number'||!Number.isSafeInteger(row.checked_ms)||row.checked_ms<0||row.error_code!==null&&(typeof row.error_code!=='string'||! /^[a-z_]{1,64}$/.test(row.error_code)))throw new SourceGateError('source_gate_unavailable');
  if(typeof row.interest_not_before_ms!=='number'||!Number.isSafeInteger(row.interest_not_before_ms)||row.interest_not_before_ms<0||typeof row.interest_checked_ms!=='number'||!Number.isSafeInteger(row.interest_checked_ms)||row.interest_checked_ms<0||row.interest_error_code!==null&&(typeof row.interest_error_code!=='string'||! /^[a-z_]{1,64}$/.test(row.interest_error_code)))throw new SourceGateError('source_gate_unavailable');
  const state=row.status as 'idle'|'busy'|'blocked';let snapshot:PolymarketStoredCache|null=null;
  if(state==='idle'&&row.payload!==null){
   try{if(typeof row.payload!=='string'||new TextEncoder().encode(row.payload).byteLength>MAX_CACHE_BYTES)throw new Error();// Preserve valid prior v1 evidence with its own schema and semantics.
    // No lease, denial or cooldown is changed by cache compatibility.
    snapshot=storedCacheSchema.parse(strictJSON(row.payload));}
   catch{throw new SourceGateError('source_gate_unavailable');}
  }
  return {state,sharedRetryAt:row.not_before_ms,retryAt:Math.max(row.not_before_ms,view==='interest'?row.interest_not_before_ms:0),snapshot,errorCode:(view==='interest'?row.interest_error_code:row.error_code) as string|null,checkedAt:view==='interest'?row.interest_checked_ms:row.checked_ms};
 }
 async acquire(signal?:AbortSignal,view:PolymarketView='newest'){
  if(signal?.aborted)throw new SourceGateError('source_aborted');
  const token=crypto.randomUUID(),result=await this.run(view==='interest'?POLYMARKET_SQL.acquireInterest:POLYMARKET_SQL.acquire,token);
  if(result.meta?.changes===1){if(signal?.aborted){await this.release(token,{kind:'temporary_failure',errorCode:'source_aborted'});throw new SourceGateError('source_aborted');}return {token};}
  if(result.meta?.changes!==0)throw new SourceGateError('source_gate_unavailable');
  const row=(await this.run(POLYMARKET_SQL.inspect)).results?.[0];
  if(row?.status==='blocked')throw new SourceGateError('source_denied');
  if(row?.status==='busy')throw new SourceGateError('source_busy');
  if(row?.status==='idle'&&typeof row.now_ms==='number'&&typeof row.not_before_ms==='number'&&(row.not_before_ms>row.now_ms||view==='interest'&&typeof row.interest_not_before_ms==='number'&&row.interest_not_before_ms>row.now_ms))throw new SourceGateError('source_cooldown');
  throw new SourceGateError('source_gate_unavailable');
 }
 async release(token:string,outcome:PolymarketOutcome){
  const delay=Math.max(REFRESH_MS,outcome.retryAfterMs??0),interestDelay=Math.max(INTEREST_REFRESH_MS,outcome.interestRetryAfterMs??0);
  if(!token||!['success','temporary_failure','denied'].includes(outcome.kind)||!Number.isSafeInteger(delay)||delay<0||!Number.isSafeInteger(interestDelay)||interestDelay<0||outcome.errorCode!==undefined&&! /^[a-z_]{1,64}$/.test(outcome.errorCode))throw new SourceGateError('source_gate_unavailable');
  let payload:string|null=null;
  if(outcome.kind==='success'){
   const candidate=storedCacheSchema.safeParse(outcome.snapshot);if(!candidate.success)throw new SourceGateError('source_gate_unavailable');
   payload=JSON.stringify(candidate.data);if(new TextEncoder().encode(payload).byteLength>MAX_CACHE_BYTES)throw new SourceGateError('source_gate_unavailable');
  }else if(outcome.snapshot)throw new SourceGateError('source_gate_unavailable');
  const state=outcome.kind==='denied'?'blocked':'idle',error=outcome.kind==='success'?null:outcome.errorCode??'source_unavailable';
  const result=await this.run(POLYMARKET_SQL.finish,state,interestDelay,error,delay,state,error,outcome.kind==='denied'?1:0,payload,token);
  if(result.meta?.changes===0)throw new SourceGateError('source_stale_lease');if(result.meta?.changes!==1)throw new SourceGateError('source_gate_unavailable');
 }
}
