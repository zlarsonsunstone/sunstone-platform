-- 0019 Vendor universe + capability analysis + research routing
--
-- Introduces the infrastructure for the Vendor Doppelganger research path
-- (as opposed to the existing NAICS-based keyword extraction path).
--
-- Three new tables:
--
-- 1. vendor_universe — shared across tenants. The SAM-registered vendor
--    pool (with websites + primary NAICS) filtered to the "logically broad"
--    fence. Seeded once from the uploaded SAM extract, refreshed monthly.
--    NOT tenant-scoped because the pool is the same for every analysis —
--    only the scoring and filtering are tenant-specific.
--
-- 2. vendor_capability_analysis — per-(tenant, vendor) analysis output.
--    Holds both capability score and evidence confidence score, plus
--    rationales and citations. Keyed so re-runs update in place.
--
-- 3. research_route — per-tenant routing decision. Records which path
--    (NAICS or VENDOR) was taken for each round, the signals that drove
--    the decision, and allows pivots mid-engagement.

SET search_path TO v2, public;

-- ============================================================================
-- vendor_universe (shared, not tenant-scoped)
-- ============================================================================

CREATE TABLE IF NOT EXISTS v2.vendor_universe (
  uei text PRIMARY KEY,
  cage text,
  legal_business_name text NOT NULL,
  website text,
  primary_naics text,
  primary_naics_sector text,      -- first 2 digits for easy filtering
  in_fence boolean DEFAULT true,  -- whether in the kept-NAICS fence

  -- Tier 1 name-signal flags (set at import time, no AI cost)
  has_capability_signal boolean DEFAULT false,
  signal_tokens text[],           -- which tokens matched, for transparency

  ingested_at timestamptz NOT NULL DEFAULT now(),
  source text DEFAULT 'sam_extract_monthly'
);

CREATE INDEX IF NOT EXISTS vendor_universe_naics_idx ON v2.vendor_universe (primary_naics);
CREATE INDEX IF NOT EXISTS vendor_universe_sector_idx ON v2.vendor_universe (primary_naics_sector);
CREATE INDEX IF NOT EXISTS vendor_universe_signal_idx ON v2.vendor_universe (has_capability_signal) WHERE has_capability_signal = true;
CREATE INDEX IF NOT EXISTS vendor_universe_name_idx ON v2.vendor_universe USING gin (to_tsvector('english', legal_business_name));

ALTER TABLE v2.vendor_universe ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vendor_universe_read ON v2.vendor_universe;
CREATE POLICY vendor_universe_read ON v2.vendor_universe
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS vendor_universe_write ON v2.vendor_universe;
CREATE POLICY vendor_universe_write ON v2.vendor_universe
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================================
-- vendor_capability_analysis (per-tenant)
-- ============================================================================

CREATE TABLE IF NOT EXISTS v2.vendor_capability_analysis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL REFERENCES v2.tenants(id) ON DELETE CASCADE,
  vendor_uei text NOT NULL REFERENCES v2.vendor_universe(uei) ON DELETE CASCADE,

  -- Which tier ran this analysis
  tier integer NOT NULL CHECK (tier IN (2, 3)),

  -- What website content was analyzed
  website_url text,
  pages_fetched text[],           -- URLs actually read
  content_chars integer,          -- raw content length fed to Haiku

  -- DUAL SCORING

  -- Axis 1: Capability match to the tenant (0-10)
  capability_score integer CHECK (capability_score BETWEEN 0 AND 10),
  capability_rationale text,
  capability_keywords text[],     -- capability keywords Claude inferred

  -- Axis 2: Evidence confidence — how strongly proven are the claims (0-10)
  evidence_score integer CHECK (evidence_score BETWEEN 0 AND 10),
  evidence_rationale text,
  evidence_citations text[],      -- direct quotes from the page supporting the score
  evidence_markers jsonb,         -- structured markers found: case_studies, testimonials,
                                  -- federal_past_performance, certifications, team_credentials,
                                  -- media_coverage, partnership_disclosures

  -- Derived tier based on (capability, evidence) matrix
  doppelganger_tier text CHECK (doppelganger_tier IN
    ('true_doppelganger', 'unproven_doppelganger', 'adjacent_capability',
     'loud_claimant', 'proven_adjacent', 'false_positive', 'inconclusive')),

  -- Audit
  analyzed_by_model text,
  analyzed_at timestamptz NOT NULL DEFAULT now(),
  analysis_cost_estimate numeric,
  fetch_error text,               -- populated if website fetch failed

  UNIQUE (tenant_id, vendor_uei, tier)
);

CREATE INDEX IF NOT EXISTS vca_tenant_tier_idx ON v2.vendor_capability_analysis (tenant_id, tier);
CREATE INDEX IF NOT EXISTS vca_tenant_cap_idx ON v2.vendor_capability_analysis (tenant_id, capability_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS vca_tenant_doppel_idx ON v2.vendor_capability_analysis (tenant_id, doppelganger_tier);

ALTER TABLE v2.vendor_capability_analysis ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vca_access ON v2.vendor_capability_analysis;
CREATE POLICY vca_access ON v2.vendor_capability_analysis
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================================
-- research_route (per-tenant routing decisions)
-- ============================================================================

CREATE TABLE IF NOT EXISTS v2.research_route (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL REFERENCES v2.tenants(id) ON DELETE CASCADE,
  round_number integer NOT NULL,

  route text NOT NULL CHECK (route IN ('NAICS', 'VENDOR', 'BOTH')),
  route_rationale text,

  -- Signals that led to this routing decision
  signals_json jsonb,             -- structured evidence: known_naics, probe_contract_count,
                                  -- probe_avg_per_piid_score, cbp_maturity_signals, etc.

  -- Outcome once the round completes
  outcome text CHECK (outcome IN
    ('confirmed_fit', 'wrong_room', 'hidden_market_discovered', 'pre_commercial',
     'pending', 'abandoned')),
  outcome_notes text,

  decided_by text DEFAULT 'platform',  -- 'platform' | 'user' | 'override'
  decided_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, round_number)
);

CREATE INDEX IF NOT EXISTS research_route_tenant_idx ON v2.research_route (tenant_id);

ALTER TABLE v2.research_route ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS research_route_access ON v2.research_route;
CREATE POLICY research_route_access ON v2.research_route
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================================
-- Helper: capability signal tokens
-- ============================================================================
-- Shared list of tokens that trigger Tier 1 "has_capability_signal" flag.
-- Populated per-tenant based on their CBP — but we also ship a sensible
-- default for tech/compute/AI tenants since that's the first use case.

CREATE TABLE IF NOT EXISTS v2.capability_signal_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text REFERENCES v2.tenants(id) ON DELETE CASCADE,  -- nullable = default set
  token text NOT NULL,
  category text,                  -- grouping for UI
  added_by text DEFAULT 'default',
  added_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, token)
);

CREATE INDEX IF NOT EXISTS cst_tenant_idx ON v2.capability_signal_tokens (tenant_id);

ALTER TABLE v2.capability_signal_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cst_access ON v2.capability_signal_tokens;
CREATE POLICY cst_access ON v2.capability_signal_tokens
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Seed the default set (tenant_id IS NULL means applies to all unless overridden)
INSERT INTO v2.capability_signal_tokens (tenant_id, token, category, added_by)
VALUES
  (NULL, 'compute', 'infrastructure', 'default'),
  (NULL, 'gpu', 'infrastructure', 'default'),
  (NULL, 'ai', 'ml', 'default'),
  (NULL, 'ml', 'ml', 'default'),
  (NULL, 'machine learning', 'ml', 'default'),
  (NULL, 'artificial intelligence', 'ml', 'default'),
  (NULL, 'cloud', 'infrastructure', 'default'),
  (NULL, 'hosting', 'infrastructure', 'default'),
  (NULL, 'data center', 'infrastructure', 'default'),
  (NULL, 'hpc', 'infrastructure', 'default'),
  (NULL, 'high performance', 'infrastructure', 'default'),
  (NULL, 'supercomput', 'infrastructure', 'default'),
  (NULL, 'inference', 'ml', 'default'),
  (NULL, 'training', 'ml', 'default'),
  (NULL, 'model', 'ml', 'default'),
  (NULL, 'neural', 'ml', 'default'),
  (NULL, 'confidential comput', 'security', 'default'),
  (NULL, 'secure enclave', 'security', 'default'),
  (NULL, 'trusted execution', 'security', 'default'),
  (NULL, 'attestation', 'security', 'default'),
  (NULL, 'encryption', 'security', 'default'),
  (NULL, 'cybersecurity', 'security', 'default'),
  (NULL, 'zero trust', 'security', 'default'),
  (NULL, 'distributed', 'infrastructure', 'default'),
  (NULL, 'decentralized', 'infrastructure', 'default'),
  (NULL, 'blockchain', 'infrastructure', 'default'),
  (NULL, 'marketplace', 'commerce', 'default'),
  (NULL, 'platform', 'infrastructure', 'default'),
  (NULL, 'infrastructure', 'infrastructure', 'default'),
  (NULL, 'cyber', 'security', 'default'),
  (NULL, 'quant', 'analytics', 'default'),
  (NULL, 'analytics', 'analytics', 'default'),
  (NULL, 'data science', 'analytics', 'default'),
  (NULL, 'llm', 'ml', 'default'),
  (NULL, 'intel tdx', 'security', 'default'),
  (NULL, 'tpm', 'security', 'default')
ON CONFLICT (tenant_id, token) DO NOTHING;
