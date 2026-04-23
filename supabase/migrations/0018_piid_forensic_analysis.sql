-- 0018 Forensic PIID analysis layer
--
-- Introduces three tables for per-contract forensic analysis:
--
-- 1. sam_registry — cache of SAM Public Extract lookups by UEI. Seeded from
--    the user-uploaded SAM Monthly Extract file so vendor research doesn't
--    require a web search every time.
--
-- 2. vendor_intel — Claude-synthesized analysis of a vendor. Keyed by UEI.
--    Shared across all PIIDs for the same vendor (analyzed once, referenced
--    many). Includes description, business model, federal posture, and a
--    similarity score to the active tenant.
--
-- 3. piid_analysis — per-(session, piid, phrase) forensic record. Each row
--    captures a single contract being evaluated against a single keyword
--    phrase. Includes: contract interpretation, NAICS/PSC alignment scoring,
--    per-PIID relevance, and a vendor_intel_id FK.

SET search_path TO v2, public;

-- ============================================================================
-- sam_registry
-- ============================================================================

CREATE TABLE IF NOT EXISTS v2.sam_registry (
  uei text PRIMARY KEY,
  cage text,
  legal_business_name text,
  dba_name text,
  website text,
  ingested_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sam_registry_name_idx ON v2.sam_registry USING gin (to_tsvector('english', legal_business_name));

ALTER TABLE v2.sam_registry ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sam_registry_read ON v2.sam_registry;
CREATE POLICY sam_registry_read ON v2.sam_registry
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS sam_registry_write ON v2.sam_registry;
CREATE POLICY sam_registry_write ON v2.sam_registry
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================================
-- vendor_intel
-- ============================================================================

CREATE TABLE IF NOT EXISTS v2.vendor_intel (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL REFERENCES v2.tenants(id) ON DELETE CASCADE,
  uei text,
  legal_business_name text NOT NULL,
  cage text,
  website text,
  city text,
  state text,

  -- Where did we get the info?
  source text CHECK (source IN ('sam_registry', 'web_search', 'manual', 'usaspending')),
  source_notes text,

  -- Claude synthesis
  description text,                  -- "What does this company do"
  business_model text,               -- prime | subcontractor | federal-native | commercial-native
  federal_posture text,              -- has_federal | no_federal | unknown | heavy_federal
  similarity_score integer CHECK (similarity_score BETWEEN 0 AND 10),
  similarity_rationale text,
  key_capabilities text[],

  -- Audit
  analyzed_by_model text,
  analyzed_at timestamptz,
  web_search_cost_estimate numeric,  -- rough cost tracking if web search was used
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, uei)
);

CREATE INDEX IF NOT EXISTS vendor_intel_tenant_uei_idx ON v2.vendor_intel (tenant_id, uei);
CREATE INDEX IF NOT EXISTS vendor_intel_tenant_name_idx ON v2.vendor_intel (tenant_id, legal_business_name);

ALTER TABLE v2.vendor_intel ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vendor_intel_access ON v2.vendor_intel;
CREATE POLICY vendor_intel_access ON v2.vendor_intel
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================================
-- piid_analysis
-- ============================================================================

CREATE TABLE IF NOT EXISTS v2.piid_analysis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL REFERENCES v2.tenants(id) ON DELETE CASCADE,
  session_id uuid REFERENCES v2.enrichment_sessions(session_id) ON DELETE CASCADE,
  round_number integer,
  turn_number integer,

  -- The contract being analyzed
  record_id uuid REFERENCES v2.enrichment_records(id) ON DELETE CASCADE,
  piid text NOT NULL,
  contract_award_unique_key text,

  -- Which phrase triggered this analysis (one PIID can be analyzed under multiple phrases)
  matched_phrase text NOT NULL,

  -- Denormalized for fast display in the forensic drawer
  contract_description text,
  obligated numeric,
  awardee text,
  agency text,
  naics_code text,
  psc_code text,

  -- Claude analysis outputs
  system_interpretation text,         -- "This contract is for..."
  naics_alignment_score integer CHECK (naics_alignment_score BETWEEN 0 AND 10),
  naics_alignment_rationale text,
  psc_alignment_score integer CHECK (psc_alignment_score BETWEEN 0 AND 10),
  psc_alignment_rationale text,
  per_piid_relevance_score integer CHECK (per_piid_relevance_score BETWEEN 0 AND 10),
  per_piid_relevance_rationale text,

  -- Vendor link
  vendor_intel_id uuid REFERENCES v2.vendor_intel(id) ON DELETE SET NULL,

  -- Audit
  analyzed_by_model text,
  analyzed_at timestamptz NOT NULL DEFAULT now(),
  prompt_chars integer,

  UNIQUE (session_id, piid, matched_phrase)
);

CREATE INDEX IF NOT EXISTS piid_analysis_session_phrase_idx
  ON v2.piid_analysis (session_id, matched_phrase);
CREATE INDEX IF NOT EXISTS piid_analysis_tenant_phrase_idx
  ON v2.piid_analysis (tenant_id, matched_phrase);
CREATE INDEX IF NOT EXISTS piid_analysis_piid_idx
  ON v2.piid_analysis (piid);

ALTER TABLE v2.piid_analysis ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS piid_analysis_access ON v2.piid_analysis;
CREATE POLICY piid_analysis_access ON v2.piid_analysis
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
