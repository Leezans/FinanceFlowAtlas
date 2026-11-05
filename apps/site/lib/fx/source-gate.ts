import {SourceGateError,type GateD1,type D1Result} from '../ashare/source-gate';
import {CHECK_INTERVAL_MS,RETRY_INTERVAL_MS} from './model';
export type FxOutcome={kind:'success'|'temporary_failure'|'denied'};
export interface FxGate {inspect():Promise<'idle'|'busy'|'blocked'>;acquire(signal?:AbortSignal):Promise<{token:string}>;release(token:string,outcome:FxOutcome):Promise<void>}
const NOW="(CAST(strftime('%s','now') AS INTEGER)*1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER))";
/** Independent metadata-only gate. Denied/busy states never expire or reset. */
export const FX_SQL={
 acquire:`UPDATE ecb_fx_source_gate SET status='busy', lease_token=?, updated_ms=${NOW} WHERE id='daily_reference' AND status='idle' AND not_before_ms<=${NOW} RETURNING status`,
 inspect:`SELECT status, not_before_ms, ${NOW} AS now_ms FROM ecb_fx_source_gate WHERE id='daily_reference'`,
 finish:`UPDATE ecb_fx_source_gate SET status=?, lease_token=NULL, updated_ms=${NOW}, not_before_ms=${NOW}+? WHERE id='daily_reference' AND status='busy' AND lease_token=? RETURNING status`,
};
export class D1FxGate implements FxGate{
 constructor(private readonly db:GateD1){}
 private async run(sql:string,...values:unknown[]):Promise<D1Result>{try{const result=await this.db.prepare(sql).bind(...values).run();if(!result.success)throw new Error();return result;}catch{throw new SourceGateError('source_gate_unavailable');}}
 async inspect(){const row=(await this.run(FX_SQL.inspect)).results?.[0];if(!row||!['idle','busy','blocked'].includes(String(row.status)))throw new SourceGateError('source_gate_unavailable');return row.status as 'idle'|'busy'|'blocked';}
 async acquire(signal?:AbortSignal){
  if(signal?.aborted)throw new SourceGateError('source_aborted');
  const token=crypto.randomUUID(),result=await this.run(FX_SQL.acquire,token);
  if(result.meta?.changes===1){if(signal?.aborted){await this.release(token,{kind:'temporary_failure'});throw new SourceGateError('source_aborted');}return {token};}
  if(result.meta?.changes!==0)throw new SourceGateError('source_gate_unavailable');
  const row=(await this.run(FX_SQL.inspect)).results?.[0];
  if(row?.status==='blocked')throw new SourceGateError('source_denied');
  if(row?.status==='busy')throw new SourceGateError('source_busy');
  if(row?.status==='idle'&&typeof row.now_ms==='number'&&typeof row.not_before_ms==='number'&&row.not_before_ms>row.now_ms)throw new SourceGateError('source_cooldown');
  throw new SourceGateError('source_gate_unavailable');
 }
 async release(token:string,outcome:FxOutcome){
  const delay=outcome.kind==='success'?CHECK_INTERVAL_MS:RETRY_INTERVAL_MS;
  if(!token||!['success','temporary_failure','denied'].includes(outcome.kind)||!Number.isSafeInteger(delay)||delay<0)throw new SourceGateError('source_gate_unavailable');
  const result=await this.run(FX_SQL.finish,outcome.kind==='denied'?'blocked':'idle',delay,token);
  if(result.meta?.changes===0)throw new SourceGateError('source_stale_lease');if(result.meta?.changes!==1)throw new SourceGateError('source_gate_unavailable');
 }
}
