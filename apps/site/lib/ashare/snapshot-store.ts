import {STAGE_MAX_AGE_MS} from './stage';
import {STAGE_SQL} from './stage-store';
import {retainedFailureCode,inspectGateState,NOW,SQL,SUCCESS_QUIET_MS,SourceGateError,type GateD1,type D1Result,type SourceGateCode} from './source-gate';
import {decodeSnapshot,encodeSnapshot,scopeKey,SNAPSHOT_MAX_AGE_MS,SNAPSHOT_MAX_SCOPES,type Snapshot,type Scope} from './snapshot';

export type SnapshotRead={snapshot?:Snapshot;ageMs?:number;committedMs?:number;code?:SourceGateCode|'snapshot_invalid'|'snapshot_store_unavailable'|'collection_in_progress';canAcquire:boolean;failureCode?:string;retryAfterMs?:number;durableBackoff?:boolean};
export interface SnapshotStore {
  read(scope:Scope):Promise<SnapshotRead>;
  /** Commits the snapshot AND releases this lease in one primary-D1 transaction. */
  commit(token:string,snapshot:Snapshot):Promise<void>;
}
type Statement=ReturnType<ReturnType<GateD1['prepare']>['bind']>;
export interface SnapshotD1 extends GateD1 {batch(statements:Statement[]):Promise<D1Result[]>;}
const ownsLease="EXISTS (SELECT 1 FROM ashare_source_gate WHERE id='single_upstream' AND status='busy' AND lease_token=?)";
export const SNAPSHOT_SQL={
  read:`SELECT g.status,g.acquired_ms,g.finished_ms,g.not_before_ms,g.failure_count,g.last_failure_ms,g.failure_code,${NOW} AS now_ms,
    CASE WHEN g.status='idle' THEN s.payload ELSE NULL END AS payload,
    s.format_version,s.committed_ms,s.expires_ms
    FROM ashare_source_gate g LEFT JOIN ashare_snapshot_cache s ON s.scope_key=? WHERE g.id='single_upstream'`,
  put:`INSERT INTO ashare_snapshot_cache (scope_key,format_version,payload,committed_ms,expires_ms)
    SELECT ?,1,?,${NOW},${NOW}+${SNAPSHOT_MAX_AGE_MS} WHERE ${ownsLease}
    ON CONFLICT(scope_key) DO UPDATE SET format_version=excluded.format_version,payload=excluded.payload,
      committed_ms=excluded.committed_ms,expires_ms=excluded.expires_ms`,
  expire:`DELETE FROM ashare_snapshot_cache WHERE expires_ms<=${NOW} AND ${ownsLease}`,
  trim:`DELETE FROM ashare_snapshot_cache WHERE scope_key IN (
    SELECT scope_key FROM ashare_snapshot_cache ORDER BY (scope_key='level1') DESC,committed_ms DESC,scope_key
    LIMIT -1 OFFSET ${SNAPSHOT_MAX_SCOPES}) AND ${ownsLease}`,
} as const;

/** Owner-only last-good evidence. Uses the same primary DB as D1SourceGate.
 * Reads never acquire, reset or clear a gate. Busy/unknown/denied states cannot
 * expose evidence; idle reads join permission and snapshot in a single query.
 * Retention: one version per scope, at most 32 scopes/64MB; no evidence beyond
 * 24h. Expired records are removed lazily during the next successful commit.
 */
export class D1SnapshotStore implements SnapshotStore {
  constructor(private readonly db:SnapshotD1,private readonly options:{staged?:boolean}={}) {}
  async read(scope:Scope):Promise<SnapshotRead> {
    let result:D1Result;
    try{
      const sql=this.options.staged?SNAPSHOT_SQL.read.replace('SELECT g.status',`SELECT EXISTS(SELECT 1 FROM ashare_staged_acquisitions WHERE scope_key=? AND expires_ms>${NOW}) AS stage_pending,g.status`):SNAPSHOT_SQL.read;
      result=await this.db.prepare(sql).bind(...(this.options.staged?[scopeKey(scope),scopeKey(scope)]:[scopeKey(scope)])).run();
    }
    catch{return {code:'snapshot_store_unavailable',canAcquire:false};}
    if(!result.success)return {code:'snapshot_store_unavailable',canAcquire:false};
    const row=result.results?.[0];
    let gateCode:SourceGateCode|null;
    try{gateCode=inspectGateState(row);}catch{return {code:'source_gate_unavailable',canAcquire:false};}
    if(gateCode&&gateCode!=='source_cooldown')return {code:gateCode,canAcquire:false};
    // A successful 3s pacing interval is not a failed refresh. A temporary
    // failure's shared durable cooldown must remain visible even on a cold isolate.
    const failedCooldown=gateCode==='source_cooldown'&&
      (typeof row!.finished_ms!=='number'||Number(row!.not_before_ms)-row!.finished_ms>SUCCESS_QUIET_MS);
    const durableBackoff=Number.isSafeInteger(row!.failure_count)&&Number(row!.failure_count)>=0;
    // Partial progress preserves the durable failure counter until full commit.
    // Do not let that historical error hide a confirmed continuation, but an
    // active global failure cooldown still takes priority over any prefix.
    const continuing=row!.stage_pending===1&&!failedCooldown;
    const failureCode=!continuing&&durableBackoff&&Number(row!.failure_count)>0?retainedFailureCode(row!.failure_code):undefined;
    const base:SnapshotRead={canAcquire:!failedCooldown,...(gateCode?{code:gateCode}:{}),
      durableBackoff,failureCode,retryAfterMs:Math.max(0,Number(row!.not_before_ms)-Number(row!.now_ms)),
      ...(continuing?{code:'collection_in_progress' as const}:{})};
    if(row!.payload===null||row!.payload===undefined)return base;
    const {committed_ms:committed,expires_ms:expires,now_ms:now}=row!;
    if(row!.format_version!==1||typeof committed!=='number'||!Number.isSafeInteger(committed)||committed<0||
      typeof now!=='number'||now<committed||expires!==committed+SNAPSHOT_MAX_AGE_MS)
      return {code:'snapshot_invalid',canAcquire:false};
    if(now>=Number(expires))return base;
    try{
      const snapshot=decodeSnapshot(row!.payload,scope),acquired=Date.parse(snapshot.fetched_at);
      if(acquired>now+60_000)return {code:'snapshot_invalid',canAcquire:false};
      const ageMs=Math.max(now-committed,now-acquired,snapshot.collection_started_at?now-Date.parse(snapshot.collection_started_at):0);
      if(ageMs>=SNAPSHOT_MAX_AGE_MS)return base;
      // Oldest-page age may legitimately make a completed staged snapshot stale.
      // That does not turn the normal post-success pacing interval into a failed
      // refresh. Retain the age and gate, but report only a failure cooldown.
      return {...base,snapshot,ageMs,committedMs:committed,code:base.code==='collection_in_progress'?base.code:failedCooldown?gateCode!:undefined};
    }catch{return {code:'snapshot_invalid',canAcquire:false};}
  }
  async commit(token:string,snapshot:Snapshot):Promise<void> {
    if(!token)throw new SourceGateError('source_stale_lease');
    const payload=encodeSnapshot(snapshot);
    const started=snapshot.collection_started_at?Date.parse(snapshot.collection_started_at):undefined;
    if(this.options.staged&&started===undefined)throw new Error('snapshot_invalid');
    // NOT NULL rejects an expired/future start inside the transaction itself.
    // This rolls back publication, stage cleanup and lease release together.
    const put=this.options.staged
      ?this.db.prepare(SNAPSHOT_SQL.put.replace('SELECT ?,1,?,',`SELECT ?,1,CASE WHEN ?<=${NOW} AND ${NOW}<?+${STAGE_MAX_AGE_MS} THEN json_set(?,'$.fetched_at',strftime('%Y-%m-%dT%H:%M:%fZ','now')) ELSE NULL END,`)).bind(scopeKey(snapshot.scope),started,started,payload,token)
      :this.db.prepare(SNAPSHOT_SQL.put).bind(scopeKey(snapshot.scope),payload,token);
    let results:D1Result[];
    try{
      // D1 batch is sequential and transactional. Every mutation requires the
      // same live token; an old token cannot modify cache, retention, or gate.
      results=await this.db.batch([
        put,
        this.db.prepare(SNAPSHOT_SQL.expire).bind(token),
        this.db.prepare(SNAPSHOT_SQL.trim).bind(token),
        ...(this.options.staged?[this.db.prepare(STAGE_SQL.discard).bind(scopeKey(snapshot.scope),token)]:[]),
        this.db.prepare(SQL.finish).bind('idle',null,SUCCESS_QUIET_MS,token),
      ]);
    }catch{throw new SourceGateError('source_gate_unavailable');}
    const finish=results.at(-1);
    if(results.length!==(this.options.staged?5:4)||results.some(result=>!result.success))throw new SourceGateError('source_gate_unavailable');
    if(results[0].meta?.changes===0&&finish?.meta?.changes===0)throw new SourceGateError('source_stale_lease');
    if(results[0].meta?.changes!==1||finish?.meta?.changes!==1)throw new SourceGateError('source_gate_unavailable');
  }
}
