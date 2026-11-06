-- Read-only, metadata-only. An independent operator/monitor must run this even
-- when no scheduled event runs; logs alone cannot detect a missing trigger.
WITH clock AS (
  SELECT CAST(strftime('%s','now') AS INTEGER)*1000+CAST(substr(strftime('%f','now'),4,3) AS INTEGER) AS now_ms
), base AS (
  SELECT j.*, c.now_ms FROM clock c LEFT JOIN ashare_scheduler_job j ON j.id='ashare'
)
SELECT 'scheduler' AS component, NULL AS scope_key,
  CASE WHEN id IS NULL THEN 'never_ran'
       WHEN last_seen_ms IS NULL OR now_ms-last_seen_ms>180000 THEN 'tick_gap'
       WHEN status='stopped' THEN 'stopped'
       WHEN status='busy' AND now_ms-last_started_ms>210000 THEN 'outcome_unconfirmed'
       WHEN status='busy' THEN 'running'
       WHEN last_started_ms IS NULL OR now_ms-last_started_ms>180000 THEN 'admission_gap'
       WHEN last_code='complete_snapshot' THEN 'healthy'
       ELSE coalesce(last_code,'not_completed') END AS health,
  last_seen_ms, last_started_ms, last_finished_ms, NULL AS last_acquisition_ms
FROM base
UNION ALL
SELECT 'scope', json_each.value,
  CASE WHEN s.scope_key IS NULL THEN 'never_completed'
       WHEN base.now_ms-s.last_finished_ms>json_array_length(base.scopes_json)*60000+180000 THEN 'check_gap'
       WHEN s.last_acquisition_ms IS NULL THEN 'no_complete_snapshot'
       WHEN s.last_acquisition_ms>base.now_ms THEN 'clock_mismatch'
       WHEN base.now_ms-s.last_acquisition_ms>json_array_length(base.scopes_json)*60000+180000 THEN 'acquisition_gap'
       WHEN s.last_code!='complete_snapshot' THEN s.last_code
       ELSE 'healthy' END,
  NULL, NULL, s.last_finished_ms, s.last_acquisition_ms
FROM base, json_each(base.scopes_json)
LEFT JOIN ashare_scheduler_scope s ON s.scope_key=json_each.value
UNION ALL
SELECT 'source_gate', NULL,
  CASE WHEN status='blocked' THEN 'source_denied'
       WHEN status='busy' AND (acquired_ms IS NULL OR now_ms-acquired_ms>=180000) THEN 'source_outcome_unconfirmed'
       WHEN status='busy' THEN 'source_busy'
       WHEN status='idle' AND not_before_ms>now_ms THEN 'source_cooldown'
       WHEN status='idle' THEN 'healthy' ELSE 'source_gate_unavailable' END,
  NULL, acquired_ms, finished_ms, NULL
FROM ashare_source_gate, clock WHERE id='single_upstream';
