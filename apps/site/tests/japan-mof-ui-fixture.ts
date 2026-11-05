import type {JapanMofReply} from '../lib/japan/model';
/** Synthetic amounts only. Not a captured government report. */
export const JAPAN_TEST_NOW=Date.parse('2026-11-06T09:00:00.000Z');
export function japanFixture():JapanMofReply{
  const stamp=new Date(JAPAN_TEST_NOW).toISOString();
  return {status:{state:'available',error_code:null,last_attempt_at:stamp,fetched_at:stamp,cache_age_ms:0,report_age_days:6,refresh_ms:21_600_000,max_cache_age_ms:604_800_000,next_retry_at:new Date(JAPAN_TEST_NOW+21_600_000).toISOString()},snapshot:{
    schema:'japan-mof-weekly/1',source:'Japan_MOF',unit:'JPY_100_million',coverage:'nonresident_transactions_via_designated_major_institutions',
    report_date:'2026-10-31',report_start:'2026-10-25',report_end:'2026-10-31',updated_date:'2026-11-06',source_released_at:null,acquisition_started_at:stamp,fetched_at:stamp,
    assets:[{id:'equity_funds',acquisitions:20,dispositions:10,net:10},{id:'long_term_debt',acquisitions:5,dispositions:10,net:-5},{id:'short_term_debt',acquisitions:3,dispositions:3,net:0}],total_net:5,
  }};
}
