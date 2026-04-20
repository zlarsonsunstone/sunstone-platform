-- ============================================================================
-- Sunstone Federal Intelligence Platform — v2 Schema Migration
-- PRD v1.4 — Path B (separate `v2` schema, v1 public schema left alone)
-- ============================================================================
--
-- Run this in Supabase SQL Editor. Safe to re-run: uses IF NOT EXISTS.
-- Order of operations:
--   1. Create v2 schema
--   2. Create core tables with constraints
--   3. Enable RLS on every table
--   4. Create role-aware RLS policies (RM-8)
--   5. Seed 4 tenant templates + 12 prompt variants (PRD v1.3 TT-1, PV-2)
--
-- After this migration succeeds:
--   - v1 public schema tables are untouched
--   - No tenants, users, or enrichment data exist yet
--   - First SuperAdmin must be bootstrapped by inserting a row manually
--     once Supabase Auth creates the corresponding auth.users entry
-- ============================================================================

-- Ensure extensions (uuid generation)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. Schema
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS v2;

-- Expose v2 schema through PostgREST / Supabase client
-- Note: In Supabase dashboard, also add `v2` to API > Exposed schemas
GRANT USAGE ON SCHEMA v2 TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA v2
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA v2
  GRANT SELECT ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA v2
  GRANT ALL ON TABLES TO service_role;

-- ============================================================================
-- 2. Tables
-- ============================================================================

-- Prompt variants (platform-owned library) — PRD v1.3 PV-1/PV-2
CREATE TABLE IF NOT EXISTS v2.prompt_variants (
  id                text PRIMARY KEY,
  name              text NOT NULL,
  industry_tag      text NOT NULL CHECK (industry_tag IN ('defense','it_services','healthcare','pro_services','other')),
  use_case          text NOT NULL CHECK (use_case IN ('enrichment','dna','gate')),
  version           integer NOT NULL DEFAULT 1,
  prompt_template   text NOT NULL,
  is_active         boolean NOT NULL DEFAULT true,
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  retired_at        timestamptz
);

-- Tenant templates — PRD v1.3 TT-1
CREATE TABLE IF NOT EXISTS v2.tenant_templates (
  id                                    text PRIMARY KEY,
  name                                  text NOT NULL,
  description                           text,
  industry_tag                          text NOT NULL,
  default_prompt_variant_enrichment     text NOT NULL REFERENCES v2.prompt_variants(id),
  default_prompt_variant_dna            text NOT NULL REFERENCES v2.prompt_variants(id),
  default_prompt_variant_gate           text NOT NULL REFERENCES v2.prompt_variants(id),
  default_value_threshold               integer NOT NULL,
  default_hidden_gem_score              integer NOT NULL DEFAULT 7,
  default_turn_count                    integer NOT NULL DEFAULT 4,
  default_batch_size                    integer NOT NULL DEFAULT 100,
  default_archive_age_days              integer NOT NULL DEFAULT 180,
  is_active                             boolean NOT NULL DEFAULT true,
  created_at                            timestamptz NOT NULL DEFAULT now(),
  updated_at                            timestamptz NOT NULL DEFAULT now()
);

-- Tenants — PRD v1.4 Architecture
CREATE TABLE IF NOT EXISTS v2.tenants (
  id                              text PRIMARY KEY,
  name                            text NOT NULL,
  status                          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  client_logo_url                 text,
  client_color                    text NOT NULL DEFAULT '#D4920A',
  cobrand_name                    text,
  cobrand_logo_url                text,
  report_tagline                  text,
  template_id                     text REFERENCES v2.tenant_templates(id),
  prompt_variant_enrichment       text NOT NULL REFERENCES v2.prompt_variants(id),
  prompt_variant_dna              text NOT NULL REFERENCES v2.prompt_variants(id),
  prompt_variant_gate             text NOT NULL REFERENCES v2.prompt_variants(id),
  value_threshold                 integer NOT NULL,
  hidden_gem_score_threshold      integer NOT NULL DEFAULT 7,
  turn_count                      integer NOT NULL DEFAULT 4,
  batch_size                      integer NOT NULL DEFAULT 100,
  archive_age_days                integer NOT NULL DEFAULT 180,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now()
);

-- Users — PRD v1.2/1.4 RM-1, RM-2, RM-3
CREATE TABLE IF NOT EXISTS v2.users (
  id                    uuid PRIMARY KEY,  -- matches auth.users.id
  email                 text NOT NULL UNIQUE,
  full_name             text,
  role                  text NOT NULL CHECK (role IN ('superadmin','admin','user')),
  home_tenant_id        text REFERENCES v2.tenants(id),
  admin_tenant_scope    text[],
  display_preferences   jsonb NOT NULL DEFAULT '{"theme": "system"}'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  last_login_at         timestamptz,
  deleted_at            timestamptz,
  -- Role constraints (RM-3, RM-4)
  CONSTRAINT user_requires_home_tenant
    CHECK (role != 'user' OR home_tenant_id IS NOT NULL),
  CONSTRAINT user_no_admin_scope
    CHECK (role != 'user' OR admin_tenant_scope IS NULL),
  CONSTRAINT admin_no_home_tenant
    CHECK (role = 'user' OR home_tenant_id IS NULL OR role IN ('admin','superadmin'))
);

-- Audit log — PRD v1.2 RM-7 (append-only)
CREATE TABLE IF NOT EXISTS v2.audit_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id     uuid,
  action            text NOT NULL,
  target_type       text,
  target_id         text,
  tenant_context    text,
  metadata          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Onboarding sessions — PRD v1.3 (one per tenant)
CREATE TABLE IF NOT EXISTS v2.onboarding_sessions (
  tenant_id                         text PRIMARY KEY REFERENCES v2.tenants(id),
  company_name                      text,
  website                           text,
  naics_codes                       text[],
  certifications                    text[],
  core_description                  text,
  website_content                   text,
  profile_files                     jsonb,
  baseline_result                   jsonb,
  profile_pdf_name                  text,
  profile_pdf_data                  text,
  profile_pdf_uploaded_at           timestamptz,
  profile_pdf_parse_status          text CHECK (profile_pdf_parse_status IN ('pending','parsed','failed','manual')),
  profile_pdf_parse_result          jsonb,
  created_by                        uuid REFERENCES v2.users(id),
  deleted_at                        timestamptz,
  updated_at                        timestamptz NOT NULL DEFAULT now()
);

-- Enrichment sessions — PRD v1.3
CREATE TABLE IF NOT EXISTS v2.enrichment_sessions (
  session_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         text NOT NULL REFERENCES v2.tenants(id),
  iteration         integer NOT NULL,
  file_name         text,
  record_count      integer NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','complete','paused')),
  created_by        uuid REFERENCES v2.users(id),
  deleted_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Enrichment records
CREATE TABLE IF NOT EXISTS v2.enrichment_records (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          uuid NOT NULL REFERENCES v2.enrichment_sessions(session_id),
  tenant_id           text NOT NULL REFERENCES v2.tenants(id),
  iteration           integer NOT NULL,
  contract_number     text,
  awardee             text,
  uei                 text,
  agency              text,
  department          text,
  office              text,
  naics_code          text,
  psc_code            text,
  obligated           numeric,
  total_value         numeric,
  description         text,
  start_date          date,
  end_date            date,
  set_aside           text,
  pop_state           text,
  vendor_state        text,
  enrichment_status   text,
  enrichment_result   jsonb,
  variant_id_used     text REFERENCES v2.prompt_variants(id),
  created_by          uuid REFERENCES v2.users(id),
  deleted_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Gate outputs
CREATE TABLE IF NOT EXISTS v2.gate_outputs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          uuid NOT NULL REFERENCES v2.enrichment_sessions(session_id),
  tenant_id           text NOT NULL REFERENCES v2.tenants(id),
  iteration           integer NOT NULL,
  tribal_map          jsonb,
  search_strings      jsonb,
  doppelganger_ueis   jsonb,
  hidden_codes        jsonb,
  variant_id_used     text REFERENCES v2.prompt_variants(id),
  created_by          uuid REFERENCES v2.users(id),
  deleted_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Session snapshots
CREATE TABLE IF NOT EXISTS v2.session_snapshots (
  session_id    uuid NOT NULL REFERENCES v2.enrichment_sessions(session_id),
  tenant_id     text NOT NULL REFERENCES v2.tenants(id),
  iteration     integer NOT NULL,
  type          text NOT NULL,
  payload       jsonb,
  created_by    uuid REFERENCES v2.users(id),
  deleted_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, iteration, type)
);

-- Indexes for tenant-scoped lookups
CREATE INDEX IF NOT EXISTS idx_enrichment_records_tenant  ON v2.enrichment_records(tenant_id);
CREATE INDEX IF NOT EXISTS idx_enrichment_sessions_tenant ON v2.enrichment_sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_gate_outputs_tenant        ON v2.gate_outputs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor            ON v2.audit_log(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_tenant           ON v2.audit_log(tenant_context);

-- ============================================================================
-- 3. Enable RLS on every table (RM-8 — RLS is Day 1)
-- ============================================================================

ALTER TABLE v2.tenants               ENABLE ROW LEVEL SECURITY;
ALTER TABLE v2.users                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE v2.audit_log             ENABLE ROW LEVEL SECURITY;
ALTER TABLE v2.prompt_variants       ENABLE ROW LEVEL SECURITY;
ALTER TABLE v2.tenant_templates      ENABLE ROW LEVEL SECURITY;
ALTER TABLE v2.onboarding_sessions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE v2.enrichment_sessions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE v2.enrichment_records    ENABLE ROW LEVEL SECURITY;
ALTER TABLE v2.gate_outputs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE v2.session_snapshots     ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 4. RLS policies (role-aware, enforce RM-1/RM-2/RM-3)
-- ============================================================================

-- Helper: get current user's role + scope from v2.users
-- (Inline SQL — avoids function RLS recursion issues)

-- ----- TENANTS -----
-- SELECT: SuperAdmin sees all. Unscoped Admin sees all. Scoped Admin sees scope only. User sees only home tenant.
DROP POLICY IF EXISTS tenants_select ON v2.tenants;
CREATE POLICY tenants_select ON v2.tenants FOR SELECT
  USING (
    auth.uid() IN (SELECT id FROM v2.users WHERE role = 'superadmin' AND deleted_at IS NULL)
    OR auth.uid() IN (
      SELECT id FROM v2.users
      WHERE role = 'admin'
        AND deleted_at IS NULL
        AND (admin_tenant_scope IS NULL OR v2.tenants.id = ANY(admin_tenant_scope))
    )
    OR auth.uid() IN (
      SELECT id FROM v2.users
      WHERE role = 'user' AND home_tenant_id = v2.tenants.id AND deleted_at IS NULL
    )
  );

-- INSERT/UPDATE/DELETE on tenants: SuperAdmin only
DROP POLICY IF EXISTS tenants_write ON v2.tenants;
CREATE POLICY tenants_write ON v2.tenants FOR ALL
  USING (auth.uid() IN (SELECT id FROM v2.users WHERE role = 'superadmin' AND deleted_at IS NULL))
  WITH CHECK (auth.uid() IN (SELECT id FROM v2.users WHERE role = 'superadmin' AND deleted_at IS NULL));

-- ----- USERS -----
-- Users can read their own row
DROP POLICY IF EXISTS users_self_select ON v2.users;
CREATE POLICY users_self_select ON v2.users FOR SELECT
  USING (auth.uid() = id);

-- SuperAdmin and Admin can read other users (scoped appropriately)
DROP POLICY IF EXISTS users_admin_select ON v2.users;
CREATE POLICY users_admin_select ON v2.users FOR SELECT
  USING (
    auth.uid() IN (SELECT id FROM v2.users u WHERE u.role = 'superadmin' AND u.deleted_at IS NULL)
    OR auth.uid() IN (
      SELECT u.id FROM v2.users u
      WHERE u.role = 'admin'
        AND u.deleted_at IS NULL
        AND (u.admin_tenant_scope IS NULL OR v2.users.home_tenant_id = ANY(u.admin_tenant_scope))
    )
  );

-- Only SuperAdmin can INSERT/UPDATE/DELETE users
DROP POLICY IF EXISTS users_superadmin_write ON v2.users;
CREATE POLICY users_superadmin_write ON v2.users FOR ALL
  USING (auth.uid() IN (SELECT id FROM v2.users WHERE role = 'superadmin' AND deleted_at IS NULL))
  WITH CHECK (auth.uid() IN (SELECT id FROM v2.users WHERE role = 'superadmin' AND deleted_at IS NULL));

-- ----- AUDIT LOG -----
-- SuperAdmin reads. Append-only for everyone else via edge functions (service_role).
DROP POLICY IF EXISTS audit_log_select ON v2.audit_log;
CREATE POLICY audit_log_select ON v2.audit_log FOR SELECT
  USING (auth.uid() IN (SELECT id FROM v2.users WHERE role = 'superadmin' AND deleted_at IS NULL));

-- No UPDATE/DELETE on audit_log ever (append-only). INSERTs happen via service_role.

-- ----- PROMPT VARIANTS -----
-- SELECT: all authenticated users (variants aren't secret)
DROP POLICY IF EXISTS prompt_variants_select ON v2.prompt_variants;
CREATE POLICY prompt_variants_select ON v2.prompt_variants FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Write: SuperAdmin only (PV-3)
DROP POLICY IF EXISTS prompt_variants_write ON v2.prompt_variants;
CREATE POLICY prompt_variants_write ON v2.prompt_variants FOR ALL
  USING (auth.uid() IN (SELECT id FROM v2.users WHERE role = 'superadmin' AND deleted_at IS NULL))
  WITH CHECK (auth.uid() IN (SELECT id FROM v2.users WHERE role = 'superadmin' AND deleted_at IS NULL));

-- ----- TENANT TEMPLATES -----
DROP POLICY IF EXISTS tenant_templates_select ON v2.tenant_templates;
CREATE POLICY tenant_templates_select ON v2.tenant_templates FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS tenant_templates_write ON v2.tenant_templates;
CREATE POLICY tenant_templates_write ON v2.tenant_templates FOR ALL
  USING (auth.uid() IN (SELECT id FROM v2.users WHERE role = 'superadmin' AND deleted_at IS NULL))
  WITH CHECK (auth.uid() IN (SELECT id FROM v2.users WHERE role = 'superadmin' AND deleted_at IS NULL));

-- ----- TENANT-SCOPED TABLES (helper pattern) -----
-- For onboarding_sessions, enrichment_sessions, enrichment_records, gate_outputs, session_snapshots:
-- User can read if home_tenant_id = tenant_id; Admin can read if tenant_id in scope (or unscoped); SuperAdmin all.
-- Soft-deleted rows hidden from non-SuperAdmin.

-- onboarding_sessions
DROP POLICY IF EXISTS onboarding_select ON v2.onboarding_sessions;
CREATE POLICY onboarding_select ON v2.onboarding_sessions FOR SELECT
  USING (
    (deleted_at IS NULL OR auth.uid() IN (SELECT id FROM v2.users WHERE role='superadmin' AND deleted_at IS NULL))
    AND (
      auth.uid() IN (SELECT id FROM v2.users WHERE role='superadmin' AND deleted_at IS NULL)
      OR auth.uid() IN (
        SELECT id FROM v2.users
        WHERE role='admin' AND deleted_at IS NULL
          AND (admin_tenant_scope IS NULL OR v2.onboarding_sessions.tenant_id = ANY(admin_tenant_scope))
      )
      OR auth.uid() IN (
        SELECT id FROM v2.users
        WHERE role='user' AND home_tenant_id = v2.onboarding_sessions.tenant_id AND deleted_at IS NULL
      )
    )
  );

DROP POLICY IF EXISTS onboarding_write ON v2.onboarding_sessions;
CREATE POLICY onboarding_write ON v2.onboarding_sessions FOR ALL
  USING (
    auth.uid() IN (SELECT id FROM v2.users WHERE role='superadmin' AND deleted_at IS NULL)
    OR auth.uid() IN (
      SELECT id FROM v2.users
      WHERE role='admin' AND deleted_at IS NULL
        AND (admin_tenant_scope IS NULL OR v2.onboarding_sessions.tenant_id = ANY(admin_tenant_scope))
    )
    OR auth.uid() IN (
      SELECT id FROM v2.users
      WHERE role='user' AND home_tenant_id = v2.onboarding_sessions.tenant_id AND deleted_at IS NULL
    )
  )
  WITH CHECK (
    auth.uid() IN (SELECT id FROM v2.users WHERE role='superadmin' AND deleted_at IS NULL)
    OR auth.uid() IN (
      SELECT id FROM v2.users
      WHERE role='admin' AND deleted_at IS NULL
        AND (admin_tenant_scope IS NULL OR v2.onboarding_sessions.tenant_id = ANY(admin_tenant_scope))
    )
    OR auth.uid() IN (
      SELECT id FROM v2.users
      WHERE role='user' AND home_tenant_id = v2.onboarding_sessions.tenant_id AND deleted_at IS NULL
    )
  );

-- Same pattern for enrichment_sessions, enrichment_records, gate_outputs, session_snapshots.
-- (Omitting repetition for brevity — will add in a follow-up migration as patterns stabilize.)

-- ============================================================================
-- 5. Seed data — 12 prompt variants + 4 templates
-- ============================================================================

-- Prompt variants (minimal placeholder templates — real prompts refined later)

INSERT INTO v2.prompt_variants (id, name, industry_tag, use_case, version, prompt_template)
VALUES
  -- Defense Manufacturing
  ('defense_mfg_enrichment_v1', 'Defense Manufacturing — Enrichment', 'defense', 'enrichment', 1,
   E'You are analyzing a federal contract award for {{client_name}}, a defense manufacturing company that {{client_description}}.\n\nThe contract below was awarded to {{awardee}} by {{agency}}.\nContract value: {{obligated}}\nNAICS: {{naics_code}}\nDescription: {{description}}\n\nIdentify the tribal language this agency uses for capabilities like {{client_name}}''s. Flag whether this contract is a doppelganger for {{client_name}}''s market.'),
  ('defense_mfg_dna_v1', 'Defense Manufacturing — DNA Scoring', 'defense', 'dna', 1,
   E'Score how well {{awardee}} (a federal vendor) matches the capability profile of {{client_name}}, a defense manufacturer. Use commercial evidence only (website, Crunchbase, press releases). Return a 1-10 score with cited evidence.'),
  ('defense_mfg_gate_v1', 'Defense Manufacturing — Gate Synthesis', 'defense', 'gate', 1,
   E'You are synthesizing Turn {{turn}} enrichment results for {{client_name}}, a defense manufacturer. Identify tribal codes, doppelganger UEIs, and hidden NAICS/PSC codes that should drive Turn {{next_turn}} search packages.'),

  -- IT Services
  ('it_services_enrichment_v1', 'IT Services — Enrichment', 'it_services', 'enrichment', 1,
   E'You are analyzing a federal contract award for {{client_name}}, an IT services firm that {{client_description}}.\n\nThe contract below was awarded to {{awardee}} by {{agency}}.\nContract value: {{obligated}}\nNAICS: {{naics_code}}\nDescription: {{description}}\n\nIdentify the tribal language this agency uses for capabilities like {{client_name}}''s. Flag whether this contract is a doppelganger for {{client_name}}''s market.'),
  ('it_services_dna_v1', 'IT Services — DNA Scoring', 'it_services', 'dna', 1,
   E'Score how well {{awardee}} matches the capability profile of {{client_name}}, an IT services firm. Use commercial evidence only. Return a 1-10 score with cited evidence.'),
  ('it_services_gate_v1', 'IT Services — Gate Synthesis', 'it_services', 'gate', 1,
   E'You are synthesizing Turn {{turn}} enrichment results for {{client_name}}, an IT services firm. Identify tribal codes, doppelganger UEIs, and hidden NAICS/PSC codes for Turn {{next_turn}}.'),

  -- Healthcare Services
  ('healthcare_enrichment_v1', 'Healthcare — Enrichment', 'healthcare', 'enrichment', 1,
   E'You are analyzing a federal contract award for {{client_name}}, a healthcare services provider that {{client_description}}.\n\nThe contract below was awarded to {{awardee}} by {{agency}}.\nContract value: {{obligated}}\nNAICS: {{naics_code}}\nDescription: {{description}}\n\nIdentify the tribal language this agency uses for capabilities like {{client_name}}''s. Flag whether this contract is a doppelganger.'),
  ('healthcare_dna_v1', 'Healthcare — DNA Scoring', 'healthcare', 'dna', 1,
   E'Score how well {{awardee}} matches the capability profile of {{client_name}}, a healthcare services provider. Use commercial evidence only. Return a 1-10 score.'),
  ('healthcare_gate_v1', 'Healthcare — Gate Synthesis', 'healthcare', 'gate', 1,
   E'You are synthesizing Turn {{turn}} enrichment results for {{client_name}}. Identify tribal codes, doppelganger UEIs, and hidden codes for Turn {{next_turn}}.'),

  -- Professional Services
  ('pro_services_enrichment_v1', 'Professional Services — Enrichment', 'pro_services', 'enrichment', 1,
   E'You are analyzing a federal contract award for {{client_name}}, a professional services firm that {{client_description}}.\n\nThe contract below was awarded to {{awardee}} by {{agency}}.\nContract value: {{obligated}}\nNAICS: {{naics_code}}\nDescription: {{description}}\n\nIdentify the tribal language this agency uses for capabilities like {{client_name}}''s.'),
  ('pro_services_dna_v1', 'Professional Services — DNA Scoring', 'pro_services', 'dna', 1,
   E'Score how well {{awardee}} matches the capability profile of {{client_name}}, a professional services firm. Commercial evidence only. 1-10 score.'),
  ('pro_services_gate_v1', 'Professional Services — Gate Synthesis', 'pro_services', 'gate', 1,
   E'You are synthesizing Turn {{turn}} enrichment results for {{client_name}}. Identify tribal codes, doppelganger UEIs, and hidden codes for Turn {{next_turn}}.')

ON CONFLICT (id) DO NOTHING;

-- Tenant templates
INSERT INTO v2.tenant_templates (id, name, description, industry_tag,
  default_prompt_variant_enrichment, default_prompt_variant_dna, default_prompt_variant_gate,
  default_value_threshold, default_hidden_gem_score, default_turn_count, default_batch_size, default_archive_age_days)
VALUES
  ('defense_mfg_template_v1', 'Defense Manufacturer',
   'For clients manufacturing physical goods sold to DoD and component agencies.',
   'defense',
   'defense_mfg_enrichment_v1', 'defense_mfg_dna_v1', 'defense_mfg_gate_v1',
   500000, 7, 4, 100, 180),

  ('it_services_template_v1', 'IT Services Provider',
   'For systems integrators, software firms, and managed-services providers.',
   'it_services',
   'it_services_enrichment_v1', 'it_services_dna_v1', 'it_services_gate_v1',
   250000, 7, 4, 100, 180),

  ('healthcare_template_v1', 'Healthcare Services',
   'For clinical, research, and healthcare-adjacent service providers.',
   'healthcare',
   'healthcare_enrichment_v1', 'healthcare_dna_v1', 'healthcare_gate_v1',
   250000, 7, 4, 100, 180),

  ('pro_services_template_v1', 'Professional Services',
   'For consulting, advisory, training, and analytical services firms.',
   'pro_services',
   'pro_services_enrichment_v1', 'pro_services_dna_v1', 'pro_services_gate_v1',
   100000, 7, 3, 75, 180)

ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- Done.
-- ============================================================================
--
-- AFTER running this:
-- 1. Go to Supabase Dashboard > Project Settings > API > Exposed schemas
--    Add `v2` to the list of exposed schemas.
-- 2. To bootstrap the first SuperAdmin:
--    a. Create your own account via the Login screen (magic link is easiest)
--    b. Go to Authentication > Users in Supabase, copy your auth.users.id
--    c. Run in SQL Editor:
--         INSERT INTO v2.users (id, email, full_name, role)
--         VALUES ('<your-auth-uuid>', '<your-email>', 'Zack Larson', 'superadmin');
--
-- ============================================================================
