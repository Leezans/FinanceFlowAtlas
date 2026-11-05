import {SourceGateError,type GateD1,type D1Result} from '../ashare/source-gate';
import {REFRESH_MS,snapshotSchema,type CvmSnapshot} from './model';
import {strictJSON} from '../ashare/strict-json';
import type {CvmGate,CvmOutcome} from './handler';
const NOW="(CAST(strftime('%s','now') AS INTEGER)*1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER))";
/** Independent acquisition gate with validated public official report cache. Denied/busy states never expire or reset. */
export const CVM_SQL={
 acquire:`UPDATE cvm_source_gate SET status='busy', lease_token=?, updated_ms=${NOW} WHERE id='monthly_fund_equity' AND status='idle' AND not_before_ms<=${NOW} RETURNING status`,
 inspect:`SELECT status, not_before_ms, payload, ${NOW} AS now_ms FROM cvm_source_gate WHERE id='monthly_fund_equity'`,
 finish:`UPDATE cvm_source_gate SET status=?, lease_token=NULL, updated_ms=${NOW}, not_before_ms=${NOW}+?, payload=CASE WHEN ? THEN NULL ELSE COALESCE(?,payload) END WHERE id='monthly_fund_equity' AND status='busy' AND lease_token=? RETURNING status`,
};
export class D1CvmGate implements CvmGate{
 constructor(private readonly db:GateD1){}
 private async run(sql:string,...values:unknown[]):Promise<D1Result>{try{const result=await this.db.prepare(sql).bind(...values).run();if(!result.success)throw new Error();return result;}catch{throw new SourceGateError('source_gate_unavailable');}}
 async inspect(){
  const row=(await this.run(CVM_SQL.inspect)).results?.[0];
  if(!row||!['idle','busy','blocked'].includes(String(row.status))||typeof row.not_before_ms!=='number'||!Number.isSafeInteger(row.not_before_ms)||row.not_before_ms<0)throw new SourceGateError('source_gate_unavailable');
  const state=row.status as 'idle'|'busy'|'blocked';let snapshot:CvmSnapshot|null=null;
  if(state!=='blocked'&&row.payload!==null){
   try{if(typeof row.payload!=='string'||row.payload.length>2_000_000)throw new Error();snapshot=snapshotSchema.parse(strictJSON(row.payload));}
   catch{throw new SourceGateError('source_gate_unavailable');}
  }
  return {state,retryAt:row.not_before_ms,snapshot};
 }
 async acquire(signal?:AbortSignal){
  if(signal?.aborted)throw new SourceGateError('source_aborted');
  const token=crypto.randomUUID(),result=await this.run(CVM_SQL.acquire,token);
  if(result.meta?.changes===1){if(signal?.aborted){await this.release(token,{kind:'temporary_failure'});throw new SourceGateError('source_aborted');}return {token};}
  if(result.meta?.changes!==0)throw new SourceGateError('source_gate_unavailable');
  const row=(await this.run(CVM_SQL.inspect)).results?.[0];
  if(row?.status==='blocked')throw new SourceGateError('source_denied');
  if(row?.status==='busy')throw new SourceGateError('source_busy');
  if(row?.status==='idle'&&typeof row.now_ms==='number'&&typeof row.not_before_ms==='number'&&row.not_before_ms>row.now_ms)throw new SourceGateError('source_cooldown');
  throw new SourceGateError('source_gate_unavailable');
 }
 async release(token:string,outcome:CvmOutcome){
  const delay=Math.max(REFRESH_MS,outcome.retryAfterMs??0);
  if(!token||!['success','temporary_failure','denied'].includes(outcome.kind)||!Number.isSafeInteger(delay)||delay<0)throw new SourceGateError('source_gate_unavailable');
  let payload:string|null=null;
  if(outcome.kind==='success'){
   const candidate=snapshotSchema.safeParse(outcome.snapshot);if(!candidate.success)throw new SourceGateError('source_gate_unavailable');
   payload=JSON.stringify(candidate.data);if(payload.length>2_000_000)throw new SourceGateError('source_gate_unavailable');
  }else if(outcome.snapshot)throw new SourceGateError('source_gate_unavailable');
  const result=await this.run(CVM_SQL.finish,outcome.kind==='denied'?'blocked':'idle',delay,outcome.kind==='denied'?1:0,payload,token);
  if(result.meta?.changes===0)throw new SourceGateError('source_stale_lease');if(result.meta?.changes!==1)throw new SourceGateError('source_gate_unavailable');
 }
}
