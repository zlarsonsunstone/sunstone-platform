-- ============================================================================
-- Migration 0057 — engagement_state: add 'tenant', set as default, backfill
-- ============================================================================
-- Doctrine source: DOCTRINE.md D1 (Three States of External Users)
-- 
-- Per D1, every external user (role='user') is in exactly one of three states:
--   tenant    — created in system, no Recon Report delivered yet
--   prospect  — Recon Report delivered, payment not received
--   client    — paid
--
-- Per D1 clarification (added 2026-05-14): engagement_state applies only to
-- users with role='user'. For internal staff (role IN ('admin','superadmin')),
-- the column is ignored. Existing internal-staff values are left untouched.
--
-- Pre-migration state (verified 2026-05-14 ~08:30 AM MT):
--   - Column allowed values previously: 'prospect' | 'client'
--   - Default: 'prospect'
--   - Two users in v2.users:
--       dana@wickedbionic.com   engagement_state='prospect'  role='user'
--       zack@sunstoneag.com     engagement_state='client'    role='superadmin'
--   - Dana's tenant has proposal_delivered_at IS NULL (Recon not delivered)
--     therefore Dana should be 'tenant' under D1, not 'prospect'.
--   - Zack is staff; column does not apply (D1 clarification). Left as-is.
--
-- Backfill rule:
--   role='user' AND proposal_delivered_at IS NULL                  → 'tenant'
--   role='user' AND proposal_delivered_at IS NOT NULL AND no $    → 'prospect'
--   role='user' AND has paid                                       → 'client' (no signal in DB yet — leave existing)
--   role IN ('admin','superadmin')                                 → leave untouched
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Drop the existing CHECK constraint that limits values to 'prospect' | 'client'.
--    Constraint name verified via pg_constraint query on 2026-05-14:
--    users_engagement_state_check 
--      CHECK ((engagement_state = ANY (ARRAY['prospect'::text, 'client'::text])))
-- ----------------------------------------------------------------------------
ALTER TABLE v2.users 
  DROP CONSTRAINT IF EXISTS users_engagement_state_check;

-- ----------------------------------------------------------------------------
-- 2. Change the column default to 'tenant' (per D1)
-- ----------------------------------------------------------------------------
ALTER TABLE v2.users 
  ALTER COLUMN engagement_state SET DEFAULT 'tenant';

-- ----------------------------------------------------------------------------
-- 3. Add new CHECK constraint allowing all three states
-- ----------------------------------------------------------------------------
ALTER TABLE v2.users
  ADD CONSTRAINT users_engagement_state_check
  CHECK (engagement_state IN ('tenant', 'prospect', 'client'));

-- ----------------------------------------------------------------------------
-- 4. Backfill: external users (role='user') whose tenant has no delivered
--    Recon Report become 'tenant'. Internal staff are untouched.
-- ----------------------------------------------------------------------------
UPDATE v2.users u
SET engagement_state = 'tenant'
FROM v2.prospect_context pc
WHERE u.role = 'user'
  AND u.home_tenant_id = pc.tenant_id
  AND pc.proposal_delivered_at IS NULL
  AND u.engagement_state <> 'tenant';

-- ----------------------------------------------------------------------------
-- 5. External users whose tenant exists but has NO prospect_context row at
--    all: they are also tenants by definition (no Recon journey started).
-- ----------------------------------------------------------------------------
UPDATE v2.users u
SET engagement_state = 'tenant'
WHERE u.role = 'user'
  AND u.home_tenant_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM v2.prospect_context pc 
    WHERE pc.tenant_id = u.home_tenant_id
  )
  AND u.engagement_state <> 'tenant';

-- ----------------------------------------------------------------------------
-- 6. Verification: show current state of all users after backfill.
--    Run after COMMIT and visually confirm before proceeding to Phase 2.
-- ----------------------------------------------------------------------------
-- Expected post-migration state:
--   dana@wickedbionic.com   engagement_state='tenant'   (was 'prospect')
--   zack@sunstoneag.com     engagement_state='client'   (unchanged, role=superadmin)

COMMIT;

-- ----------------------------------------------------------------------------
-- VERIFICATION QUERY — run AFTER the migration, paste result back to Claude
-- ----------------------------------------------------------------------------
-- SELECT 
--   u.email, u.role, u.engagement_state, 
--   t.name AS tenant_name, 
--   pc.proposal_delivered_at
-- FROM v2.users u
-- LEFT JOIN v2.tenants t ON t.id = u.home_tenant_id
-- LEFT JOIN v2.prospect_context pc ON pc.tenant_id = u.home_tenant_id
-- ORDER BY u.role, u.email;
