import type {SummaryReply} from '../lib/national/tpex-summary-view';
/** Synthetic integer amounts. No captured official market observations. */
export const SUMMARY_TEST_NOW=Date.parse('2026-11-05T10:00:00Z');
export function summaryFixture():SummaryReply {
 const fetched_at=new Date(SUMMARY_TEST_NOW).toISOString();
 return {status:{state:'available',error_code:null,last_attempt_at:fetched_at,fetched_at,cache_age_ms:0,report_age_days:.75,refresh_ms:3_600_000,max_cache_age_ms:86_400_000,next_retry_at:new Date(SUMMARY_TEST_NOW+3_600_000).toISOString()},snapshot:{schema:'tpex-institutional-money/1',source:'TPEx',market:'Taiwan_OTC',unit:'TWD',report_date:'2026-11-05',source_released_at:null,acquisition_started_at:fetched_at,fetched_at,net_capital_flow:null,participants:[{id:'foreign',buy:300,sell:100,net:200},{id:'trust',buy:100,sell:200,net:-100},{id:'dealer',buy:50,sell:50,net:0},{id:'total',buy:450,sell:350,net:100}]}};
}
