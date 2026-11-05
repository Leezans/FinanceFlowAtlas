import {createReportHandler} from '../reports/handler';
import {ReportError,type ReportDefinition,type ReportOptions} from '../reports/types';
import {parseJapanMof} from './adapter';
import {SOURCE_URL,snapshotSchema,REFRESH_MS,MAX_CACHE_AGE_MS,MAX_REPORT_AGE_DAYS,STALE_REPORT_DAYS,reportAge,type JapanMofSnapshot} from './model';
export const japanMofDefinition:ReportDefinition<JapanMofSnapshot>={url:SOURCE_URL,parse:parseJapanMof,validate:raw=>snapshotSchema.parse(raw),validateRevision:(candidate,previous)=>{if(candidate.updated_date<previous.updated_date)throw new ReportError('updated_date_regression');},refreshMs:REFRESH_MS,maxCacheAgeMs:MAX_CACHE_AGE_MS,maxReportAgeDays:MAX_REPORT_AGE_DAYS,staleReportDays:STALE_REPORT_DAYS,reportAge,responseFormat:'cp932_csv',maxBytes:750_000,deadlineMs:25_000};
export const createJapanMofHandler=(options:ReportOptions<JapanMofSnapshot>)=>createReportHandler(japanMofDefinition,options);
