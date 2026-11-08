/** Shared row shape only. Source-specific units, provenance and reports stay local. */
export type EvidenceRow = {
  id: string;
  dimension: {
    namespace: string;
    kind: 'asset_class' | 'participant' | 'report' | 'industry' | 'instrument';
    id: string;
    label: string;
  };
  role:
    | 'component'
    | 'reported_total'
    | 'provider_scope_member'
    | 'participant_total'
    | 'position_measure'
    | 'instrument_measure';
  metric_id: string;
  metric_label: string;
  value: number | null;
  state:
    | 'reported'
    | 'not_in_retained_snapshot'
    | 'source_missing_marker'
    | 'source_record_missing'
    | 'source_aggregate_unavailable'
    | 'source_null';
  native_locator: string | null;
};
