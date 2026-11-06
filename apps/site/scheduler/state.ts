import {NOW, type GateD1, type D1Result} from '../lib/ashare/source-gate';

export const TICK_MS = 60_000;
export const MAX_SCOPES = 8;
export function configuredScopes(raw: unknown): string[] {
  if (typeof raw !== 'string' || raw.length > 128) throw new Error('scheduler_config_invalid');
  const scopes = raw.split(',');
  if (!scopes.length || scopes.length > MAX_SCOPES || new Set(scopes).size !== scopes.length ||
      scopes.some(scope => scope !== 'level1' && !/^BK[0-9]{4}$/.test(scope))) throw new Error('scheduler_config_invalid');
  return scopes.sort();
}
export type Claim = {token: string; scope: string};
export type Finish = {code: string; stopped: boolean; requests: number; acquisitionMs: number | null};
export type SchedulerCode = 'claimed' | 'duplicate_or_delayed_tick' | 'scheduler_busy' |
  'scheduler_stopped' | 'scheduler_config_changed' | 'scheduler_store_unconfirmed';
const owns = "id='ashare' AND status='busy' AND lease_token=?";
// All job mutations are separate from source admission. No source-gate writes,
// expiry, lease stealing or implicit recovery exist in this adapter.
export const SCHEDULER_SQL = {
  initialize: `INSERT OR IGNORE INTO ashare_scheduler_job(id,status,scopes_json,cursor,created_ms)
    VALUES('ashare','idle',?,0,${NOW})`,
  seen: `UPDATE ashare_scheduler_job SET last_seen_ms=${NOW} WHERE id='ashare'`,
  claim: `UPDATE ashare_scheduler_job SET status='busy',lease_token=?,last_tick_ms=?,last_started_ms=${NOW},last_code='running'
    WHERE id='ashare' AND status='idle' AND scopes_json=? AND (last_tick_ms IS NULL OR last_tick_ms<?)
    AND ?<=${NOW}+1000 AND ?>${NOW}-120000
    RETURNING json_extract(scopes_json,'$[' || cursor || ']') AS scope`,
  inspect: `SELECT status,scopes_json FROM ashare_scheduler_job WHERE id='ashare'`,
  scope: `INSERT INTO ashare_scheduler_scope(scope_key,last_finished_ms,last_code,last_requests,last_acquisition_ms)
    SELECT ?,${NOW},?,?,? FROM ashare_scheduler_job WHERE ${owns}
    ON CONFLICT(scope_key) DO UPDATE SET last_finished_ms=excluded.last_finished_ms,last_code=excluded.last_code,
      last_requests=excluded.last_requests,last_acquisition_ms=coalesce(excluded.last_acquisition_ms,ashare_scheduler_scope.last_acquisition_ms)`,
  finish: `UPDATE ashare_scheduler_job SET status=?,lease_token=NULL,last_finished_ms=${NOW},last_code=?,
    cursor=(cursor+1)%json_array_length(scopes_json) WHERE ${owns} RETURNING status`,
};

export class SchedulerStore {
  constructor(private readonly db: GateD1 & {batch(statements: ReturnType<ReturnType<GateD1['prepare']>['bind']>[]): Promise<D1Result[]>}) {}
  private async run(sql: string, ...values: unknown[]): Promise<D1Result> {
    const result = await this.db.prepare(sql).bind(...values).run();
    if (!result.success) throw new Error('scheduler_store_unconfirmed');
    return result;
  }
  async claim(scopes: string[], scheduledTime: number): Promise<{code: SchedulerCode; claim?: Claim}> {
    if (!Number.isSafeInteger(scheduledTime) || scheduledTime < 0) return {code: 'duplicate_or_delayed_tick'};
    const tick = Math.floor(scheduledTime / TICK_MS) * TICK_MS, config = JSON.stringify(scopes);
    try {
      await this.run(SCHEDULER_SQL.initialize, config);
      await this.run(SCHEDULER_SQL.seen);
      const token = crypto.randomUUID();
      const result = await this.run(SCHEDULER_SQL.claim, token, tick, config, tick, scheduledTime, scheduledTime);
      if (result.meta?.changes === 1) {
        const scope = result.results?.[0]?.scope;
        if (typeof scope !== 'string' || !scopes.includes(scope)) throw new Error('scheduler_store_unconfirmed');
        return {code: 'claimed', claim: {token, scope}};
      }
      if (result.meta?.changes !== 0) throw new Error('scheduler_store_unconfirmed');
      const state = (await this.run(SCHEDULER_SQL.inspect)).results?.[0];
      if (!state || !['busy','idle','stopped'].includes(String(state.status))) throw new Error('scheduler_store_unconfirmed');
      return {code: state.status === 'busy' ? 'scheduler_busy' : state.status === 'stopped' ? 'scheduler_stopped' :
        state.scopes_json !== config ? 'scheduler_config_changed' : 'duplicate_or_delayed_tick'};
    } catch { return {code: 'scheduler_store_unconfirmed'}; }
  }
  async finish(claim: Claim, result: Finish): Promise<void> {
    const results = await this.db.batch([
      this.db.prepare(SCHEDULER_SQL.scope).bind(claim.scope, result.code, result.requests, result.acquisitionMs, claim.token),
      this.db.prepare(SCHEDULER_SQL.finish).bind(result.stopped ? 'stopped' : 'idle', result.code, claim.token),
    ]);
    if (results.length !== 2 || results.some(row => !row.success || row.meta?.changes !== 1))
      throw new Error('scheduler_store_unconfirmed');
  }
}
