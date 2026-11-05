import {SourceGateError,type GateD1,type D1Result} from '../ashare/source-gate';
import {REFRESH_MS,type SinaGate,type SinaOutcome} from './industry';
const NOW="(CAST(strftime('%s','now') AS INTEGER)*1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER))";
/** Separate table: a Sina success can never reset an Eastmoney denial, or vice versa.
 * Metadata only. No expiry, takeover, reset operation, or market payload storage.
 */
export const SINA_SQL={
  acquire:`UPDATE sina_source_gate SET status='busy', lease_token=?, updated_ms=${NOW}
    WHERE id='industry_0' AND status='idle' AND not_before_ms<=${NOW} RETURNING status`,
  inspect:`SELECT status, not_before_ms, ${NOW} AS now_ms FROM sina_source_gate WHERE id='industry_0'`,
  finish:`UPDATE sina_source_gate SET status=?, lease_token=NULL, updated_ms=${NOW}, not_before_ms=${NOW}+?
    WHERE id='industry_0' AND status='busy' AND lease_token=? RETURNING status`,
} as const;
export class D1SinaGate implements SinaGate {
  constructor(private readonly db: GateD1){}
  private async run(sql: string,...values: unknown[]):Promise<D1Result>{
    try{const result=await this.db.prepare(sql).bind(...values).run();if(!result.success)throw new Error();return result;}
    catch{throw new SourceGateError('source_gate_unavailable');}
  }
  async acquire(scope: string,signal?: AbortSignal){
    if(scope!=='sina:industry:0')throw new SourceGateError('source_gate_unavailable');
    if(signal?.aborted)throw new SourceGateError('source_aborted');
    const token=crypto.randomUUID(),result=await this.run(SINA_SQL.acquire,token);
    if(result.meta?.changes===1){
      if(signal?.aborted){await this.release(token,{kind:'temporary_failure'});throw new SourceGateError('source_aborted');}
      return {token};
    }
    if(result.meta?.changes!==0)throw new SourceGateError('source_gate_unavailable');
    const row=(await this.run(SINA_SQL.inspect)).results?.[0];
    if(row?.status==='blocked')throw new SourceGateError('source_denied');
    if(row?.status==='busy')throw new SourceGateError('source_busy');
    if(row?.status==='idle'&&typeof row.now_ms==='number'&&typeof row.not_before_ms==='number'&&row.not_before_ms>row.now_ms)throw new SourceGateError('source_cooldown');
    throw new SourceGateError('source_gate_unavailable');
  }
  async release(token: string,outcome: SinaOutcome){
    if(!token||!['success','temporary_failure','denied'].includes(outcome.kind))throw new SourceGateError('source_gate_unavailable');
    const requested=outcome.retryAfterMs??0;
    if(!Number.isSafeInteger(requested)||requested<0)throw new SourceGateError('source_gate_unavailable');
    // Large Retry-After values remain long pauses; they are never capped shorter.
    const delay=Math.max(REFRESH_MS,requested);
    const result=await this.run(SINA_SQL.finish,outcome.kind==='denied'?'blocked':'idle',delay,token);
    if(result.meta?.changes===0)throw new SourceGateError('source_stale_lease');
    if(result.meta?.changes!==1)throw new SourceGateError('source_gate_unavailable');
  }
}
