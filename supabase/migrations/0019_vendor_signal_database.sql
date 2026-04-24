-- 0019 Vendor Signal Database (VSD)
--
-- Canonical, client-agnostic intelligence asset. Every vendor we scan lives
-- here ONCE with a rich capability profile, reusable across every Sunstone
-- client engagement.
--
-- Design principle: the vendor's own profile is CLIENT-INDEPENDENT.
-- Client-specific similarity scoring lives in vendor_client_match (separate)
-- so one vendor can have different similarity scores against different
-- clients without duplicating the base data.
--
-- Tier progression:
--   Tier 0 (instant): structural filter — in SAM, has website, in kept NAICS
--   Tier 1 (free):    name-signal pre-filter — vendor name contains tokens
--   Tier 2 (cheap):   quick Haiku scan of homepage — populates vsd_entity
--   Tier 3 (deep):    full Haiku analysis of multiple pages — confidence=HIGH
--   Tier 4 (enrich):  federal award history from USASpending
--
-- `analysis_tier` field records how far each entity has been processed.

SET search_path TO v2, public;

-- ============================================================================
-- vsd_entity  — one row per vendor, client-agnostic
-- ============================================================================

CREATE TABLE IF NOT EXISTS v2.vsd_entity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  uei text UNIQUE NOT NULL,
  cage text,
  legal_business_name text NOT NULL,
  dba_name text,
  website text,
  primary_naics text,
  city text,
  state text,

  -- Tier progression (highest tier completed)
  analysis_tier text NOT NULL DEFAULT 'tier_0'
    CHECK (analysis_tier IN ('tier_0', 'tier_1', 'tier_2', 'tier_3', 'tier_4')),

  -- Tier 0 derivations
  naics_sector text GENERATED ALWAYS AS (substr(primary_naics, 1, 2)) STORED,

  -- Tier 1 signals (free, name-based)
  has_tech_name_signal boolean,
  has_federal_name_signal boolean,
  tech_tokens_matched text[],
  federal_tokens_matched text[],

  -- Tier 2/3 Claude classifications
  entity_type text
    CHECK (entity_type IN (
      'COMMERCIAL_VENDOR', 'FEDERAL_INTEGRATOR', 'RESEARCH_INSTITUTION',
      'NONPROFIT', 'GOVERNMENT_ENTITY', 'CONSULTING_FIRM',
      'INDIVIDUAL_CONTRACTOR', 'SHELL_OR_DORMANT', 'UNCLASSIFIABLE'
    )),
  entity_type_rationale text,

  capability_primary text,                   -- primary category (see app layer for enum)
  capability_secondary text[],               -- secondary categories
  capability_rationale text,

  federal_posture text
    CHECK (federal_posture IN (
      'FEDERAL_NATIVE', 'FEDERAL_ACTIVE', 'FEDERAL_ADJACENT',
      'FEDERAL_INTERESTED', 'COMMERCIAL_ONLY', 'UNKNOWN'
    )),
  federal_posture_rationale text,

  business_model text
    CHECK (business_model IN (
      'PRIME_CAPABLE', 'SUB_SPECIALIST', 'PRODUCT_VENDOR',
      'MANUFACTURER', 'RESEARCH_CONTRACTOR', 'HOLDING_COMPANY',
      'SOLO_CONSULTANT', 'UNKNOWN'
    )),
  business_model_rationale text,

  -- Confidence in the above classifications
  classification_confidence text
    CHECK (classification_confidence IN ('HIGH', 'MEDIUM', 'LOW', 'UNVERIFIED')),

  -- Signal flags (populated during Tier 2+)
  website_accessible boolean,
  website_content_rich boolean,
  has_product_pages boolean,
  has_capability_statement boolean,
  mentions_clearances boolean,
  mentions_compliance boolean,
  clearance_tokens text[],          -- e.g. ['TS', 'TS/SCI', 'Secret']
  compliance_tokens text[],         -- e.g. ['FedRAMP High', 'IL5', 'CMMC L3']

  -- Rich capability description (Claude-generated, used for semantic match)
  capability_narrative text,        -- 50-150 words describing what they do
  key_capabilities text[],          -- 3-10 short phrases (e.g. 'H100 GPU inference')
  key_differentiators text[],       -- what sets them apart
  target_customers text[],          -- who do they sell to

  -- Website content cache (for later reanalysis without re-fetch)
  website_content_cache text,
  website_fetched_at timestamptz,

  -- Tier 4 federal enrichment (populated separately)
  federal_award_count integer,
  federal_award_total numeric,
  federal_naics_codes text[],       -- distinct codes they've won under
  federal_psc_codes text[],
  federal_agencies text[],
  federal_first_award_date date,
  federal_last_award_date date,

  -- Audit
  analyzed_by_model text,
  analyzed_at timestamptz,
  tier_2_cost_cents integer,        -- rough cost tracking
  tier_3_cost_cents integer,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vsd_entity_sector_idx ON v2.vsd_entity (naics_sector);
CREATE INDEX IF NOT EXISTS vsd_entity_tier_idx ON v2.vsd_entity (analysis_tier);
CREATE INDEX IF NOT EXISTS vsd_entity_capability_idx ON v2.vsd_entity (capability_primary);
CREATE INDEX IF NOT EXISTS vsd_entity_posture_idx ON v2.vsd_entity (federal_posture);
CREATE INDEX IF NOT EXISTS vsd_entity_confidence_idx ON v2.vsd_entity (classification_confidence);
CREATE INDEX IF NOT EXISTS vsd_entity_name_gin ON v2.vsd_entity USING gin (to_tsvector('english', legal_business_name));
CREATE INDEX IF NOT EXISTS vsd_entity_narrative_gin ON v2.vsd_entity USING gin (to_tsvector('english', coalesce(capability_narrative, '')));

ALTER TABLE v2.vsd_entity ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vsd_entity_access ON v2.vsd_entity;
CREATE POLICY vsd_entity_access ON v2.vsd_entity FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================================
-- vsd_entity_client_match  — per-(vendor, client) similarity
-- ============================================================================
-- Keeps client-specific scoring out of the base vendor profile. One vendor
-- can have different similarity scores against different clients without
-- polluting the canonical data.

CREATE TABLE IF NOT EXISTS v2.vsd_entity_client_match (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES v2.vsd_entity(id) ON DELETE CASCADE,
  tenant_id text NOT NULL REFERENCES v2.tenants(id) ON DELETE CASCADE,

  -- Scoring
  similarity_score integer CHECK (similarity_score BETWEEN 0 AND 10),
  similarity_rationale text,
  match_strength text CHECK (match_strength IN (
    'DIRECT_DOPPELGANGER',    -- near-identical capability
    'STRONG_MATCH',            -- core overlap, some differentiation
    'ADJACENT',                -- related market, not same capability
    'TEAMING_CANDIDATE',       -- complementary rather than competitive
    'LOW_MATCH',               -- minimal overlap
    'NOT_A_MATCH'
  )),
  relationship_type text CHECK (relationship_type IN (
    'COMPETITOR',
    'POTENTIAL_PARTNER',
    'POTENTIAL_PRIME',
    'POTENTIAL_SUBCONTRACTOR',
    'ACQUISITION_TARGET',
    'REFERENCE_ONLY',
    'NOT_RELEVANT'
  )),

  -- Claude analysis
  overlapping_capabilities text[],
  complementary_capabilities text[],
  gap_analysis text,               -- what does client have that vendor doesn't / vice versa
  strategic_notes text,            -- how to approach this vendor relative to this client

  -- Audit
  analyzed_by_model text,
  analyzed_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (entity_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS vsd_match_tenant_score_idx ON v2.vsd_entity_client_match (tenant_id, similarity_score DESC);
CREATE INDEX IF NOT EXISTS vsd_match_tenant_rel_idx ON v2.vsd_entity_client_match (tenant_id, relationship_type);
CREATE INDEX IF NOT EXISTS vsd_match_entity_idx ON v2.vsd_entity_client_match (entity_id);

ALTER TABLE v2.vsd_entity_client_match ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vsd_match_access ON v2.vsd_entity_client_match;
CREATE POLICY vsd_match_access ON v2.vsd_entity_client_match FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================================
-- vsd_scan_batch  — tracks big scan runs
-- ============================================================================

CREATE TABLE IF NOT EXISTS v2.vsd_scan_batch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_name text,
  target_tier text CHECK (target_tier IN ('tier_1', 'tier_2', 'tier_3', 'tier_4')),
  tenant_id text REFERENCES v2.tenants(id) ON DELETE SET NULL,   -- nullable for client-agnostic scans
  entities_target integer,
  entities_processed integer DEFAULT 0,
  entities_succeeded integer DEFAULT 0,
  entities_failed integer DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  status text CHECK (status IN ('running', 'completed', 'failed', 'paused')) DEFAULT 'running',
  config_json jsonb,           -- the scan's configuration snapshot
  cost_estimate_cents integer
);

ALTER TABLE v2.vsd_scan_batch ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vsd_scan_batch_access ON v2.vsd_scan_batch;
CREATE POLICY vsd_scan_batch_access ON v2.vsd_scan_batch FOR ALL TO authenticated USING (true) WITH CHECK (true);
