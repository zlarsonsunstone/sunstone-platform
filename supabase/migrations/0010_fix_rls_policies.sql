-- 0010 Fix missing RLS policies on enrichment tables
--
-- The 0001 schema enabled ROW LEVEL SECURITY on enrichment_sessions and
-- related tables but did not add the policies. When RLS is enabled without
-- policies, all operations are denied by default.
--
-- Same permissive pattern as search_scopes / round_1_keywords (auth.uid()
-- IS NOT NULL). For v2 tenant access control is application-enforced via
-- activeTenantId in the Zustand store; RLS here exists to prevent
-- anonymous access, not to enforce per-tenant rules.

SET search_path TO v2, public;

-- enrichment_sessions
DROP POLICY IF EXISTS enrichment_sessions_read ON v2.enrichment_sessions;
CREATE POLICY enrichment_sessions_read ON v2.enrichment_sessions
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS enrichment_sessions_write ON v2.enrichment_sessions;
CREATE POLICY enrichment_sessions_write ON v2.enrichment_sessions
  FOR ALL USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- enrichment_records
DROP POLICY IF EXISTS enrichment_records_read ON v2.enrichment_records;
CREATE POLICY enrichment_records_read ON v2.enrichment_records
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS enrichment_records_write ON v2.enrichment_records;
CREATE POLICY enrichment_records_write ON v2.enrichment_records
  FOR ALL USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- gate_outputs
DROP POLICY IF EXISTS gate_outputs_read ON v2.gate_outputs;
CREATE POLICY gate_outputs_read ON v2.gate_outputs
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS gate_outputs_write ON v2.gate_outputs;
CREATE POLICY gate_outputs_write ON v2.gate_outputs
  FOR ALL USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- session_snapshots
DROP POLICY IF EXISTS session_snapshots_read ON v2.session_snapshots;
CREATE POLICY session_snapshots_read ON v2.session_snapshots
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS session_snapshots_write ON v2.session_snapshots;
CREATE POLICY session_snapshots_write ON v2.session_snapshots
  FOR ALL USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);
