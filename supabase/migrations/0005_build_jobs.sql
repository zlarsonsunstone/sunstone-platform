-- 0005 Build Jobs
-- Background functions can't return results synchronously (they return 202 immediately).
-- We track long-running builds in a build_jobs row. Background function writes progress
-- + final result. Frontend polls the row every ~3s to know when it's done.

SET search_path TO v2, public;

CREATE TABLE IF NOT EXISTS v2.build_jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text NOT NULL REFERENCES v2.tenants(id) ON DELETE CASCADE,
  job_type        text NOT NULL CHECK (job_type IN (
                    'build_commercial_profile',
                    'build_federal_profile',
                    'reconcile_profiles'
                  )),
  status          text NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued','running','done','error')),
  -- Result payload (populated by background function on completion)
  result          jsonb,
  error           text,
  -- Timing
  queued_at       timestamptz NOT NULL DEFAULT now(),
  started_at      timestamptz,
  finished_at     timestamptz,
  -- Who queued it
  created_by      uuid REFERENCES v2.users(id)
);

CREATE INDEX IF NOT EXISTS build_jobs_tenant_status_idx
  ON v2.build_jobs (tenant_id, status, queued_at DESC);

ALTER TABLE v2.build_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS build_jobs_read ON v2.build_jobs;
CREATE POLICY build_jobs_read ON v2.build_jobs
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS build_jobs_write ON v2.build_jobs;
CREATE POLICY build_jobs_write ON v2.build_jobs
  FOR ALL USING (auth.uid() IS NOT NULL);

-- Done.
