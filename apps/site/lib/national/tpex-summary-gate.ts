import type {GateD1} from '../ashare/source-gate';
import {D1ReportGate} from '../reports/source-gate';
import {tpexSummarySnapshotSchema,type TpexSummarySnapshot} from './tpex-summary';
import {TPEX_SUMMARY_REFRESH_MS} from './tpex-summary-runtime';
const NOW="(CAST(strftime('%s','now') AS INTEGER)*1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER))";
// This original provider gate is authoritative. A new dataset may never bypass
// its blocked, busy, absent or unknown state, including on warm-cache reads.
const PROVIDER_DEADLINE="SELECT not_before_ms FROM tpex_source_gate WHERE id='institutional_shares'";
const PROVIDER="SELECT status FROM tpex_source_gate WHERE id='institutional_shares'";
const PROVIDER_READY=`(${PROVIDER})='idle' AND typeof((${PROVIDER_DEADLINE}))='integer' AND (${PROVIDER_DEADLINE}) BETWEEN 0 AND 9007199254740991 AND (${PROVIDER_DEADLINE})<=${NOW}`;
export const TPEX_SUMMARY_SQL={
 acquire:`UPDATE tpex_summary_gate SET status='busy', lease_token=?, updated_ms=${NOW} WHERE id='institutional_money' AND status='idle' AND not_before_ms<=${NOW} AND ${PROVIDER_READY} RETURNING status`,
 inspect:`SELECT status, not_before_ms, payload, ${NOW} AS now_ms, (${PROVIDER}) AS provider_status, (${PROVIDER_DEADLINE}) AS provider_not_before_ms FROM tpex_summary_gate WHERE id='institutional_money'`,
 finish:`UPDATE tpex_summary_gate SET status=CASE WHEN (${PROVIDER})='blocked' THEN 'blocked' ELSE ? END, lease_token=NULL, updated_ms=${NOW}, not_before_ms=${NOW}+?, payload=CASE WHEN ? OR NOT COALESCE((${PROVIDER_READY}),0) THEN NULL ELSE COALESCE(?,payload) END WHERE id='institutional_money' AND status='busy' AND lease_token=? RETURNING status, (${PROVIDER}) AS provider_status, (${PROVIDER_DEADLINE}) AS provider_not_before_ms, ${NOW} AS now_ms`,
};
export class D1TpexSummaryGate extends D1ReportGate<TpexSummarySnapshot>{
 constructor(db:GateD1){super(db,{sql:TPEX_SUMMARY_SQL,validate:raw=>tpexSummarySnapshotSchema.parse(raw),refreshMs:TPEX_SUMMARY_REFRESH_MS,providerRequired:true});}
}
