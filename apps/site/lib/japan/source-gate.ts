import {D1ReportGate} from '../reports/source-gate';
import type {GateD1} from '../ashare/source-gate';
import {snapshotSchema,REFRESH_MS,type JapanMofSnapshot} from './model';
const NOW="(CAST(strftime('%s','now') AS INTEGER)*1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER))";
export const JAPAN_MOF_SQL={
 acquire:`UPDATE japan_mof_source_gate SET status='busy',lease_token=?,updated_ms=${NOW} WHERE id='weekly_liabilities' AND status='idle' AND not_before_ms<=${NOW} RETURNING status`,
 inspect:`SELECT status,not_before_ms,payload,${NOW} AS now_ms FROM japan_mof_source_gate WHERE id='weekly_liabilities'`,
 finish:`UPDATE japan_mof_source_gate SET status=?,lease_token=NULL,updated_ms=${NOW},not_before_ms=${NOW}+?,payload=CASE WHEN ? THEN NULL ELSE COALESCE(?,payload) END WHERE id='weekly_liabilities' AND status='busy' AND lease_token=? RETURNING status`,
};
export class D1JapanMofGate extends D1ReportGate<JapanMofSnapshot>{constructor(db:GateD1){super(db,{sql:JAPAN_MOF_SQL,validate:raw=>snapshotSchema.parse(raw),refreshMs:REFRESH_MS});}}
