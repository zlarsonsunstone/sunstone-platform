-- 0014 Methodology Log
--
-- Forensic audit trail for the client-facing methodology report. Every
-- meaningful decision or computation during a session gets logged: upload,
-- dedupe, methodology capture, each Haiku batch, merge, noise floor, final.
--
-- The methodology report generator queries this table and renders a narrative:
-- "At 10:23 AM, 14,000 records were ingested. 1,153 were duplicates. We ran
--  70 Haiku batches of 200 records each..."

SET search_path TO v2, public;

CREATE TABLE IF NOT EXISTS v2.methodology_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL REFERENCES v2.tenants(id) ON DELETE CASCADE,
  session_id uuid REFERENCES v2.enrichment_sessions(session_id) ON DELETE CASCADE,
  round_number integer,
  turn_number integer,
  event_type text NOT NULL,
  event_at timestamptz NOT NULL DEFAULT now(),
  actor text,
  summary text,
  details jsonb
);

CREATE INDEX IF NOT EXISTS methodology_log_tenant_session_idx
  ON v2.methodology_log (tenant_id, session_id, event_at);

CREATE INDEX IF NOT EXISTS methodology_log_tenant_time_idx
  ON v2.methodology_log (tenant_id, event_at DESC);

-- RLS
ALTER TABLE v2.methodology_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS methodology_log_tenant_access ON v2.methodology_log;
CREATE POLICY methodology_log_tenant_access ON v2.methodology_log
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
