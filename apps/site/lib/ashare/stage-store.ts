import {NOW,SQL,SUCCESS_QUIET_MS,SourceGateError,type D1Result,type GateD1} from './source-gate';
import {scopeKey,type Scope} from './snapshot';
import {canonicalStageScope,decodeStage,encodeStage,STAGE_MAX_AGE_MS,STAGE_MAX_SCOPES,type Stage} from './stage';

/** A stage mutation may have committed. Never guess another cleanup/release. */
export class StageMutationUnconfirmed extends Error {
  readonly code='source_gate_release_unconfirmed';
  constructor(){super('source_gate_release_unconfirmed');this.name='StageMutationUnconfirmed';}
}
/** Deterministic validation failed before any save batch was invoked. This is
 * deliberately distinct from reads, expiry-discard writes and unknown commits.
 */
export class StageSaveNotStarted extends Error {
  readonly code='stage_invalid';
  readonly saveNotStarted=true;
  constructor(){super('stage_invalid');this.name='StageSaveNotStarted';}
}
export interface StageStore {
  /** Only the current exclusive source owner may read or remove a partial prefix. */
  read(token:string,scope:Scope):Promise<Stage|undefined>;
  /** Atomically saves the prefix AND releases this lease with the usual 3s pacing. */
  save(token:string,stage:Stage):Promise<void>;
  /** Removes this scope only; never changes gate status or takes over a lease. */
  discard(token:string,scope:Scope):Promise<void>;
}
type Statement=ReturnType<ReturnType<GateD1['prepare']>['bind']>;
export interface StageD1 extends GateD1 {batch(statements:Statement[]):Promise<D1Result[]>;}
const ownsLease="EXISTS (SELECT 1 FROM ashare_source_gate WHERE id='single_upstream' AND status='busy' AND lease_token=?)";
export const STAGE_SQL={
  read:`SELECT g.status,g.lease_token,g.acquired_ms,${NOW} AS now_ms,
    CASE WHEN g.status='busy' AND g.lease_token=? THEN s.payload ELSE NULL END AS payload,
    s.format_version,s.started_ms,s.updated_ms,s.expires_ms
    FROM ashare_source_gate g LEFT JOIN ashare_staged_acquisitions s ON s.scope_key=? WHERE g.id='single_upstream'`,
  // A valid owner with an out-of-bounds clock fails a NOT NULL constraint. This
  // aborts the whole batch rather than skipping the put and releasing the gate.
  put:`INSERT INTO ashare_staged_acquisitions (scope_key,format_version,payload,started_ms,updated_ms,expires_ms)
    SELECT ?,1,CASE WHEN ?<=${NOW} AND ?<=${NOW} AND ${NOW}<?+${STAGE_MAX_AGE_MS}
      THEN json_set(?,'$.updated_at',strftime('%Y-%m-%dT%H:%M:%fZ','now')) ELSE NULL END,
      ?,${NOW},?+${STAGE_MAX_AGE_MS} WHERE ${ownsLease}
    ON CONFLICT(scope_key) DO UPDATE SET
      payload=CASE WHEN ashare_staged_acquisitions.payload=? THEN excluded.payload ELSE NULL END,
      updated_ms=excluded.updated_ms`,
  discard:`DELETE FROM ashare_staged_acquisitions WHERE scope_key=? AND ${ownsLease}`,
  expire:`DELETE FROM ashare_staged_acquisitions WHERE expires_ms<=${NOW} AND ${ownsLease}`,
  trim:`DELETE FROM ashare_staged_acquisitions WHERE scope_key IN (
    SELECT scope_key FROM ashare_staged_acquisitions ORDER BY (scope_key=?) DESC,updated_ms DESC,scope_key
    LIMIT -1 OFFSET ${STAGE_MAX_SCOPES}) AND ${ownsLease}`,
  owner:`SELECT status,lease_token,acquired_ms,${NOW} AS now_ms FROM ashare_source_gate WHERE id='single_upstream'`,
} as const;
function requireOwner(row:Record<string,unknown>|undefined,token:string):void {
  if(!row)throw new SourceGateError('source_gate_unavailable');
  if(row.status!=='busy'||row.lease_token!==token)throw new SourceGateError('source_stale_lease');
  if(typeof row.acquired_ms!=='number'||!Number.isSafeInteger(row.acquired_ms)||row.acquired_ms<0||
    typeof row.now_ms!=='number'||!Number.isSafeInteger(row.now_ms)||row.now_ms<row.acquired_ms)
    throw new SourceGateError('source_gate_unavailable');
}
function checkToken(token:string):void {if(typeof token!=='string'||!token)throw new SourceGateError('source_stale_lease');}
function requireSuccess(results:D1Result[],count:number):void {
  if(!Array.isArray(results)||results.length!==count||results.some(result=>!result?.success))throw new SourceGateError('source_gate_unavailable');
}
/** One private partial version per scope, <=32 scopes/64MB, <=180s from the
 * original start. Reads never grant source access. All mutations require the
 * same busy token; this store cannot reset, expire or take over any source gate.
 * Unknown database outcomes fail closed and are never retried here.
 */
export class D1StageStore implements StageStore {
  constructor(private readonly db:StageD1) {}
  async read(token:string,scope:Scope):Promise<Stage|undefined> {return (await this.readWithClock(token,scope)).stage;}
  private async readWithClock(token:string,scope:Scope):Promise<{stage?:Stage;nowMs:number}> {
    checkToken(token);const canonical=canonicalStageScope(scope);
    let result:D1Result;
    try{result=await this.db.prepare(STAGE_SQL.read).bind(token,scopeKey(canonical)).run();}
    catch{throw new SourceGateError('source_gate_unavailable');}
    if(!result?.success)throw new SourceGateError('source_gate_unavailable');
    const row=result.results?.[0];requireOwner(row,token);
    if(row!.payload===null||row!.payload===undefined){
      if(row!.format_version!==null&&row!.format_version!==undefined)throw new Error('stage_invalid');
      return {nowMs:Number(row!.now_ms)};
    }
    const stage=decodeStage(row!.payload,canonical),started=Date.parse(stage.started_at),updated=Date.parse(stage.updated_at);
    if(row!.format_version!==1||row!.started_ms!==started||row!.updated_ms!==updated||row!.expires_ms!==started+STAGE_MAX_AGE_MS||
      updated>Number(row!.now_ms))throw new Error('stage_invalid');
    if(Number(row!.now_ms)>=Number(row!.expires_ms)){await this.discard(token,canonical);return {nowMs:Number(row!.now_ms)};}
    return {stage,nowMs:Number(row!.now_ms)};
  }
  async save(token:string,stage:Stage):Promise<void> {
    checkToken(token);const canonical=canonicalStageScope(stage.scope);
    const {stage:previous,nowMs}=await this.readWithClock(token,canonical);
    // The source start is immutable DB-origin time. Only the update timestamp
    // is replaced with the current owner's DB clock, never an isolate clock.
    stage={...stage,updated_at:new Date(nowMs).toISOString()};
    let payload:string;
    try{
      payload=encodeStage(stage);
      if(previous&&(previous.started_at!==stage.started_at||previous.source_total!==stage.source_total||
        !(previous.endpoint===stage.endpoint&&previous.redirect_count===stage.redirect_count||
          previous.endpoint==='primary'&&previous.redirect_count===0&&stage.endpoint==='official_redirect'&&stage.redirect_count===1)||
        previous.page_count>=stage.page_count||previous.bytes>=stage.bytes||previous.updated_at>stage.updated_at||
        JSON.stringify(previous.rows)!==JSON.stringify(stage.rows.slice(0,previous.rows.length))))throw new Error('stage_invalid');
    }catch{throw new StageSaveNotStarted();}
    const started=Date.parse(stage.started_at),updated=Date.parse(stage.updated_at);
    let results:D1Result[];
    try{
      results=await this.db.batch([
        this.db.prepare(STAGE_SQL.put).bind(scopeKey(canonical),started,updated,started,payload,started,started,token,previous?encodeStage(previous):null),
        this.db.prepare(STAGE_SQL.expire).bind(token),
        this.db.prepare(STAGE_SQL.trim).bind(scopeKey(canonical),token),
        this.db.prepare(SQL.preserve).bind('idle',SUCCESS_QUIET_MS,token),
      ]);
    }catch{throw new SourceGateError('source_gate_unavailable');}
    requireSuccess(results,4);
    if(results[0].meta?.changes===0&&results[3].meta?.changes===0)throw new SourceGateError('source_stale_lease');
    if(results[0].meta?.changes!==1||results[3].meta?.changes!==1)throw new SourceGateError('source_gate_unavailable');
  }
  async discard(token:string,scope:Scope):Promise<void> {
    checkToken(token);const canonical=canonicalStageScope(scope);
    let results:D1Result[];
    try{results=await this.db.batch([
      this.db.prepare(STAGE_SQL.discard).bind(scopeKey(canonical),token),
      this.db.prepare(STAGE_SQL.owner).bind(),
    ]);}catch{throw new StageMutationUnconfirmed();}
    try{requireSuccess(results,2);}catch{throw new StageMutationUnconfirmed();}
    const changes=results[0].meta?.changes;
    if(changes!==0&&changes!==1)throw new StageMutationUnconfirmed();
    try{requireOwner(results[1].results?.[0],token);}catch(error){
      // An acknowledged zero-row deletion plus a different owner is a known
      // stale token. Any other inconsistent result may have changed storage.
      if(changes===0&&error instanceof SourceGateError&&error.code==='source_stale_lease')throw error;
      throw new StageMutationUnconfirmed();
    }
  }
}
