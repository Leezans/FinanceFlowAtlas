import {createReportHandler} from '../reports/handler';
import type {ReportDefinition,ReportOptions} from '../reports/types';
import {TPEX_SUMMARY_URL,parseTpexSummary,tpexSummarySnapshotSchema,type TpexSummarySnapshot} from './tpex-summary';
import {TPEX_SUMMARY_REFRESH_MS,TPEX_SUMMARY_CACHE_AGE_MS,TPEX_SUMMARY_STALE_DAYS,TPEX_SUMMARY_MAX_REPORT_DAYS,tpexSummaryReportAge} from './tpex-summary-policy';
export {TPEX_SUMMARY_REFRESH_MS} from './tpex-summary-policy';
export const tpexSummaryDefinition:ReportDefinition<TpexSummarySnapshot>={
 url:TPEX_SUMMARY_URL,parse:parseTpexSummary,validate:raw=>tpexSummarySnapshotSchema.parse(raw),
 refreshMs:TPEX_SUMMARY_REFRESH_MS,maxCacheAgeMs:TPEX_SUMMARY_CACHE_AGE_MS,maxReportAgeDays:TPEX_SUMMARY_MAX_REPORT_DAYS,staleReportDays:TPEX_SUMMARY_STALE_DAYS,
 reportAge:tpexSummaryReportAge,
 maxBytes:100_000,
};
export const createTpexSummaryHandler=(options:ReportOptions<TpexSummarySnapshot>)=>createReportHandler(tpexSummaryDefinition,options);
