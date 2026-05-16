-- ============================================================================
-- Migration 0058 — active_stage auto-advance on recon_feedback activity
-- ============================================================================
-- Doctrine source: DOCTRINE.md
--   D2: 12-Stage Captain's Log
--     Stage 6 = Discovery — Cluster view delivered (default landing on creation)
--     Stage 7 = Refinement — Keyword opt-in / lane Accept/Decline
--   D13: Migration discipline for in-flight users (additive only; no
--        retroactive behavior change for users already past this point)
--
-- Problem:
--   `v2.prospect_context.active_stage` does not auto-advance when a Tenant
--   begins Stage 7 activity. Dana Arnett (tenant_id='wicked-bionic-llc')
--   has 185 rows in `v2.recon_feedback` but `active_stage` is still 6.
--   Verified 2026-05-14 ~11:15 AM MT via prospect_context inspection.
--
-- Fix:
--   (1) Backfill — any tenant with ≥1 recon_feedback row → active_stage ≥ 7.
--   (2) Trigger — AFTER INSERT on recon_feedback advances the matching
--       prospect_context row to active_stage ≥ 7, on every new row, forward.
--
-- Rule (per D2):
--   Any feedback row counts as Stage 7 activity, regardless of user_id.
--   The stage is defined by the activity, not the actor. Trigger fires on
--   INSERT only — UPDATE to an existing row does not re-advance.
--
-- Idempotency:
--   GREATEST(active_stage, 7) is a no-op for tenants already at stage ≥ 7.
--   The WHERE clause additionally guards against unnecessary writes.
--   Migration is safe to re-run.
--
-- No app code change required. Pure DB. Phase 2 (TypeScript / routing)
-- not needed. ReconPage.tsx and /recon untouched (honors D13 for Dana's
-- in-flight session).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Backfill — fix any prospect_context with existing recon_feedback rows
-- ----------------------------------------------------------------------------
UPDATE v2.prospect_context pc
SET active_stage = GREATEST(COALESCE(pc.active_stage, 6), 7),
    updated_at = now()
WHERE EXISTS (
        SELECT 1 FROM v2.recon_feedback rf
        WHERE rf.tenant_id = pc.tenant_id
      )
  AND COALESCE(pc.active_stage, 6) < 7;

-- ----------------------------------------------------------------------------
-- 2. Trigger function — advance active_stage on new feedback
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION v2.recon_feedback_advance_stage()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE v2.prospect_context
  SET active_stage = GREATEST(COALESCE(active_stage, 6), 7),
      updated_at = now()
  WHERE tenant_id = NEW.tenant_id
    AND COALESCE(active_stage, 6) < 7;
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. Trigger — fire AFTER INSERT only
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS recon_feedback_advance_stage_trg ON v2.recon_feedback;

CREATE TRIGGER recon_feedback_advance_stage_trg
AFTER INSERT ON v2.recon_feedback
FOR EACH ROW
EXECUTE FUNCTION v2.recon_feedback_advance_stage();

COMMIT;

-- ----------------------------------------------------------------------------
-- VERIFICATION QUERIES — run AFTER the migration, paste results back to Claude
-- ----------------------------------------------------------------------------
--
-- (a) Confirm Dana is advanced to Stage 7:
--
-- SELECT pc.tenant_id, pc.active_stage,
--        (SELECT COUNT(*) FROM v2.recon_feedback rf WHERE rf.tenant_id = pc.tenant_id) AS feedback_rows
-- FROM v2.prospect_context pc
-- WHERE pc.tenant_id = 'wicked-bionic-llc';
--
-- Expected: active_stage = 7, feedback_rows = 185
--
-- (b) Confirm the trigger exists and is wired correctly:
--
-- SELECT trigger_name, event_manipulation, action_timing
-- FROM information_schema.triggers
-- WHERE event_object_schema = 'v2'
--   AND event_object_table = 'recon_feedback'
--   AND trigger_name = 'recon_feedback_advance_stage_trg';
--
-- Expected: one row — INSERT, AFTER
--
-- (c) Confirm no other tenant was unintentionally advanced:
--
-- SELECT pc.tenant_id, pc.active_stage,
--        (SELECT COUNT(*) FROM v2.recon_feedback rf WHERE rf.tenant_id = pc.tenant_id) AS feedback_rows
-- FROM v2.prospect_context pc
-- ORDER BY pc.tenant_id;
--
-- Expected: only tenants with feedback_rows > 0 have active_stage ≥ 7.
-- ----------------------------------------------------------------------------
