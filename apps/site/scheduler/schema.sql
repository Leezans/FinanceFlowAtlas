-- Optional adapter only. Apply to the SAME primary D1 as the authenticated Site.
-- Does not change any provider gate, snapshot, stage or source permission.
CREATE TABLE IF NOT EXISTS ashare_scheduler_job (
  id TEXT PRIMARY KEY NOT NULL CHECK(id='ashare'),
  status TEXT NOT NULL CHECK(status IN ('idle','busy','stopped')),
  lease_token TEXT,
  scopes_json TEXT NOT NULL CHECK(json_valid(scopes_json) AND json_type(scopes_json)='array' AND json_array_length(scopes_json) BETWEEN 1 AND 8),
  cursor INTEGER NOT NULL CHECK(cursor>=0 AND cursor<json_array_length(scopes_json)),
  created_ms INTEGER NOT NULL CHECK(created_ms>=0),
  last_seen_ms INTEGER,
  last_tick_ms INTEGER,
  last_started_ms INTEGER,
  last_finished_ms INTEGER,
  last_code TEXT,
  CHECK((status='busy' AND lease_token IS NOT NULL) OR (status!='busy' AND lease_token IS NULL))
);
CREATE TABLE IF NOT EXISTS ashare_scheduler_scope (
  scope_key TEXT PRIMARY KEY NOT NULL CHECK(scope_key='level1' OR scope_key GLOB 'BK[0-9][0-9][0-9][0-9]'),
  last_finished_ms INTEGER NOT NULL,
  last_code TEXT NOT NULL,
  last_requests INTEGER NOT NULL CHECK(last_requests BETWEEN 0 AND 20),
  last_acquisition_ms INTEGER
);
