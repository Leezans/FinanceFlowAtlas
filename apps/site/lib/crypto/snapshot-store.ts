import {NOW,SourceGateError,type GateD1,type D1Result} from '../ashare/source-gate';
import {MAX_CACHE_AGE_MS,REFRESH_MS} from './contract';
import {tradeEvidenceKey,type TradeSelection} from './selection';
import {decodeKrakenBundle,encodeKrakenBundle,KRAKEN_SNAPSHOT_MAX_SELECTIONS,type KrakenSnapshotBundle} from './snapshot';
import {KRAKEN_SQL} from './source-gate';

type Statement=ReturnType<ReturnType<GateD1['prepare']>['bind']>;
export interface KrakenSnapshotD1 extends GateD1{batch(statements:Statement[]):Promise<D1Result[]>;}
export type KrakenSnapshotRead={bundle?:KrakenSnapshotBundle;ageMs?:number;canAcquire:boolean;code?:string;nowMs?:number;nextRetryMs?:number};
export interface KrakenSnapshotStore{
 read(selection:TradeSelection):Promise<KrakenSnapshotRead>;
 /** One primary-D1 transaction publishes a coherent bundle and releases its owner. */
 commit(token:string,bundle:KrakenSnapshotBundle):Promise<void>;
}
const ownsLease="EXISTS (SELECT 1 FROM kraken_source_gate WHERE id='spot_usd' AND status='busy' AND lease_token=?)";
export const KRAKEN_SNAPSHOT_SQL={
 read:`SELECT g.status,g.not_before_ms,${NOW} AS now_ms,s.format_version,s.fetched_ms,s.expires_ms,r.cache_key AS reference_key,
  CASE WHEN g.status='idle' THEN s.payload ELSE NULL END AS payload
  FROM kraken_source_gate g LEFT JOIN kraken_snapshot_refs r ON r.cache_key=(
   SELECT r.cache_key FROM kraken_snapshot_refs r JOIN kraken_snapshot_cache c ON c.snapshot_id=r.snapshot_id
   WHERE (r.cache_key=? OR r.cache_key='latest') AND c.expires_ms>=${NOW}
   ORDER BY (r.cache_key=?) DESC LIMIT 1) LEFT JOIN kraken_snapshot_cache s ON s.snapshot_id=r.snapshot_id WHERE g.id='spot_usd'`,
 put:`INSERT INTO kraken_snapshot_cache(snapshot_id,format_version,payload,fetched_ms,expires_ms)
  SELECT ?,1,CASE WHEN ?<=${NOW} AND ?>=${NOW}-${MAX_CACHE_AGE_MS} THEN ? ELSE NULL END,?,? WHERE ${ownsLease}`,
 ref:`INSERT INTO kraken_snapshot_refs(cache_key,snapshot_id) SELECT ?,? WHERE ${ownsLease}
  ON CONFLICT(cache_key) DO UPDATE SET snapshot_id=excluded.snapshot_id`,
 expire:`DELETE FROM kraken_snapshot_refs WHERE snapshot_id IN(SELECT snapshot_id FROM kraken_snapshot_cache WHERE expires_ms<${NOW}) AND ${ownsLease}`,
 trim:`DELETE FROM kraken_snapshot_refs WHERE cache_key IN(SELECT r.cache_key FROM kraken_snapshot_refs r JOIN kraken_snapshot_cache c ON c.snapshot_id=r.snapshot_id
  WHERE r.cache_key!='latest' ORDER BY c.fetched_ms DESC,r.cache_key LIMIT -1 OFFSET ${KRAKEN_SNAPSHOT_MAX_SELECTIONS}) AND ${ownsLease}`,
 prune:`DELETE FROM kraken_snapshot_cache WHERE snapshot_id NOT IN(SELECT snapshot_id FROM kraken_snapshot_refs) AND ${ownsLease}`,
} as const;

/** Primary DB only. Reads join permission and evidence in one statement. No
 * reader resets a denial, steals a lease, prunes data, or requests a provider.
 * Canonical selection references and the latest fallback share one bundle.
 * At most 16 selection refs plus latest, 17 x 2MB; no historical versions.
 */
export class D1KrakenSnapshotStore implements KrakenSnapshotStore{
 constructor(private readonly db:KrakenSnapshotD1){}
 async read(selection:TradeSelection):Promise<KrakenSnapshotRead>{
  const key=tradeEvidenceKey(selection.pairs,selection.timeframe);
  if(key!==selection.key)return {code:'snapshot_invalid',canAcquire:false};
  let result:D1Result;
  try{result=await this.db.prepare(KRAKEN_SNAPSHOT_SQL.read).bind(key,key).run();}catch{return {code:'snapshot_store_unavailable',canAcquire:false};}
  if(!result.success)return {code:'snapshot_store_unavailable',canAcquire:false};
  const row=result.results?.[0];
  if(!row||!['idle','busy','blocked'].includes(String(row.status))||!Number.isSafeInteger(row.now_ms)||!Number.isSafeInteger(row.not_before_ms)||Number(row.not_before_ms)<0)return {code:'source_gate_unavailable',canAcquire:false};
  if(row.status==='blocked')return {code:'source_denied',canAcquire:false};
  if(row.status==='busy')return {code:'source_busy',canAcquire:false};
  const at=Number(row.now_ms),retry=Number(row.not_before_ms),canAcquire=retry<=at;
  const base:KrakenSnapshotRead={canAcquire,nowMs:at,nextRetryMs:retry,...(!canAcquire?{code:'source_cooldown'}:{})};
  if(row.payload===null||row.payload===undefined)return base;
  try{
   const bundle=decodeKrakenBundle(row.payload),fetched=Date.parse(bundle.snapshot.fetched_at);
   if(row.reference_key!=='latest'&&(row.reference_key!==key||bundle.key!==key))throw new Error();
   if(row.format_version!==1||!Number.isSafeInteger(row.fetched_ms)||row.fetched_ms!==fetched||row.expires_ms!==fetched+MAX_CACHE_AGE_MS||fetched>at)throw new Error();
   const ageMs=at-fetched;
   if(ageMs>MAX_CACHE_AGE_MS)return base;
   return {...base,bundle,ageMs,code:ageMs<=REFRESH_MS?undefined:base.code};
  }catch{return {code:'snapshot_invalid',canAcquire:false};}
 }
 async commit(token:string,bundle:KrakenSnapshotBundle):Promise<void>{
  if(!token)throw new SourceGateError('source_stale_lease');
  const payload=encodeKrakenBundle(bundle),fetched=Date.parse(bundle.snapshot.fetched_at),id=crypto.randomUUID();
  const ref=(key:string)=>this.db.prepare(KRAKEN_SNAPSHOT_SQL.ref).bind(key,id,token);
  const statements=[
   this.db.prepare(KRAKEN_SNAPSHOT_SQL.put).bind(id,fetched,fetched,payload,fetched,fetched+MAX_CACHE_AGE_MS,token),
   ref('latest'),...(bundle.key?[ref(bundle.key)]:[]),
   this.db.prepare(KRAKEN_SNAPSHOT_SQL.expire).bind(token),
   this.db.prepare(KRAKEN_SNAPSHOT_SQL.trim).bind(token),
   this.db.prepare(KRAKEN_SNAPSHOT_SQL.prune).bind(token),
   this.db.prepare(KRAKEN_SQL.finish).bind('idle',REFRESH_MS,token),
  ];
  let results:D1Result[];
  try{results=await this.db.batch(statements);}catch{throw new SourceGateError('source_gate_unavailable');}
  if(results.length!==statements.length||results.some(result=>!result.success))throw new SourceGateError('source_gate_unavailable');
  const first=results[0].meta?.changes,last=results.at(-1)?.meta?.changes;
  if(first===0&&last===0)throw new SourceGateError('source_stale_lease');
  if(first!==1||last!==1)throw new SourceGateError('source_gate_unavailable');
 }
}
