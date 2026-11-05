import {SourceGateError,type GateD1,type D1Result} from '../ashare/source-gate';
import {REFRESH_MS,type KrakenGate,type KrakenOutcome} from './contract';
const NOW="(CAST(strftime('%s','now') AS INTEGER)*1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER))";
/** Independent metadata-only gate. Denied/busy states never expire or reset. */
export const KRAKEN_SQL={
 acquire:`UPDATE kraken_source_gate SET status='busy', lease_token=?, updated_ms=${NOW} WHERE id='spot_usd' AND status='idle' AND not_before_ms<=${NOW} RETURNING status`,
 inspect:`SELECT status, not_before_ms, ${NOW} AS now_ms FROM kraken_source_gate WHERE id='spot_usd'`,
 finish:`UPDATE kraken_source_gate SET status=?, lease_token=NULL, updated_ms=${NOW}, not_before_ms=${NOW}+? WHERE id='spot_usd' AND status='busy' AND lease_token=? RETURNING status`,
};
export class D1KrakenGate implements KrakenGate{
 constructor(private readonly db:GateD1){}
 private async run(sql:string,...values:unknown[]):Promise<D1Result>{try{const result=await this.db.prepare(sql).bind(...values).run();if(!result.success)throw new Error();return result;}catch{throw new SourceGateError('source_gate_unavailable');}}
 async inspect(){const row=(await this.run(KRAKEN_SQL.inspect)).results?.[0];if(!row||!['idle','busy','blocked'].includes(String(row.status)))throw new SourceGateError('source_gate_unavailable');return row.status as 'idle'|'busy'|'blocked';}
 async acquire(signal?:AbortSignal){
  if(signal?.aborted)throw new SourceGateError('source_aborted');
  const token=crypto.randomUUID(),result=await this.run(KRAKEN_SQL.acquire,token);
  if(result.meta?.changes===1){if(signal?.aborted){await this.release(token,{kind:'temporary_failure'});throw new SourceGateError('source_aborted');}return {token};}
  if(result.meta?.changes!==0)throw new SourceGateError('source_gate_unavailable');
  const row=(await this.run(KRAKEN_SQL.inspect)).results?.[0];
  if(row?.status==='blocked')throw new SourceGateError('source_denied');
  if(row?.status==='busy')throw new SourceGateError('source_busy');
  if(row?.status==='idle'&&typeof row.now_ms==='number'&&typeof row.not_before_ms==='number'&&row.not_before_ms>row.now_ms)throw new SourceGateError('source_cooldown');
  throw new SourceGateError('source_gate_unavailable');
 }
 async release(token:string,outcome:KrakenOutcome){
  const delay=Math.max(REFRESH_MS,outcome.retryAfterMs??0);
  if(!token||!['success','temporary_failure','denied'].includes(outcome.kind)||!Number.isSafeInteger(delay)||delay<0)throw new SourceGateError('source_gate_unavailable');
  const result=await this.run(KRAKEN_SQL.finish,outcome.kind==='denied'?'blocked':'idle',delay,token);
  if(result.meta?.changes===0)throw new SourceGateError('source_stale_lease');if(result.meta?.changes!==1)throw new SourceGateError('source_gate_unavailable');
 }
}
