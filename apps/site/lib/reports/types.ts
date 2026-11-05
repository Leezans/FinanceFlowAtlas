/** Shared bounded acquisition contract. Dataset parsers own their exact schemas. */
export class ReportError extends Error {
 constructor(readonly code:string,readonly denied=false,readonly retryAfterMs=0){super(code);}
}
export interface ReportSnapshot {report_date:string;fetched_at:string;acquisition_started_at:string}
export type ReportOutcome<T>={kind:'success'|'temporary_failure'|'denied';retryAfterMs?:number;snapshot?:T};
export type ReportPublication={published:boolean;error_code?:'source_denied'|'source_busy'|'source_cooldown'|'source_gate_unavailable'};
export interface ReportGate<T> {
 inspect():Promise<{state:'idle'|'busy'|'blocked';retryAt:number;snapshot:T|null;providerUnavailable?:boolean;providerError?:'source_busy'|'source_cooldown'}>;
 acquire(signal?:AbortSignal):Promise<{token:string}>;
 release(token:string,outcome:ReportOutcome<T>):Promise<void|ReportPublication>;
}
export interface ReportDefinition<T extends ReportSnapshot> {
 url:string;parse:(raw:unknown,started:string,fetched:string)=>T;validate:(raw:unknown)=>T;
 /** Dataset-specific monotonic source metadata, checked before publication. */
 validateRevision?:(candidate:T,previous:T)=>void;
 refreshMs:number;maxCacheAgeMs:number;maxReportAgeDays:number;staleReportDays:number;
 reportAge:(snapshot:T,now:number)=>number;responseFormat?:'cp932_csv';maxBytes?:number;deadlineMs?:number;
}
export interface ReportOptions<T> {gate:ReportGate<T>;fetcher?:typeof fetch;now?:()=>number;waitUntil?:(promise:Promise<unknown>)=>void;isolatedForTests?:boolean}
export interface ReportStatus {state:'available'|'stale'|'unavailable'|'denied';error_code:string|null;last_attempt_at:string|null;fetched_at:string|null;cache_age_ms:number|null;report_age_days:number|null;refresh_ms:number;max_cache_age_ms:number;next_retry_at:string|null}
export interface ReportReply<T> {snapshot:T|null;status:ReportStatus}
