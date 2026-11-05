/** Shared browser/server time semantics; polling never changes an observation date. */
export const TPEX_SUMMARY_REFRESH_MS=3_600_000;
export const TPEX_SUMMARY_CACHE_AGE_MS=86_400_000;
export const TPEX_SUMMARY_STALE_DAYS=4;
export const TPEX_SUMMARY_MAX_REPORT_DAYS=14;
export const tpexSummaryReportAge=(snapshot:{report_date:string},now:number)=>(now-(Date.parse(snapshot.report_date)-8*3_600_000))/86_400_000;
