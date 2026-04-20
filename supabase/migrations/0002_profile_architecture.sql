-- 0002 Profile Architecture
-- Adds commercial/federal profile reconciliation + strategic profile lanes
-- Commercial sources: website, LinkedIn (paste), press releases, uploaded docs, free text
-- Federal sources: HigherGov (auto), SAM/SBA/USASpending/GSA (paste-in for v1), cape statements, free text
-- Every source feeds Claude-synthesis -> profile -> reconciliation -> strategic lanes
-- Safe to re-run: uses IF NOT EXISTS / ON CONFLICT everywhere

SET search_path TO v2, public;

-- =============================================================================
-- PROFILE SOURCES  (every input blob — auto or pasted)
-- =============================================================================
CREATE TABLE IF NOT EXISTS v2.profile_sources (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         text NOT NULL REFERENCES v2.tenants(id) ON DELETE CASCADE,
  bucket            text NOT NULL CHECK (bucket IN ('commercial','federal')),
  source_type       text NOT NULL CHECK (source_type IN (
                      'website','linkedin','press_release','uploaded_doc','free_text',
                      'highergov','sam_gov','sba_dsbs','usaspending','gsa_elibrary','cape_statement'
                    )),
  label             text NOT NULL,
  url               text,
  raw_content       text,
  extracted_text    text,
  metadata          jsonb,
  fetched_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES v2.users(id)
);

CREATE INDEX IF NOT EXISTS profile_sources_tenant_bucket_idx
  ON v2.profile_sources (tenant_id, bucket);

ALTER TABLE v2.profile_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profile_sources_read ON v2.profile_sources;
CREATE POLICY profile_sources_read ON v2.profile_sources
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS profile_sources_write ON v2.profile_sources;
CREATE POLICY profile_sources_write ON v2.profile_sources
  FOR ALL USING (auth.uid() IS NOT NULL);

-- =============================================================================
-- COMMERCIAL PROFILE  (one per tenant — synthesized from commercial sources)
-- =============================================================================
CREATE TABLE IF NOT EXISTS v2.commercial_profile (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         text NOT NULL UNIQUE REFERENCES v2.tenants(id) ON DELETE CASCADE,
  synthesized_text  text,
  structured_data   jsonb,
  last_built_at     timestamptz,
  source_count      int NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE v2.commercial_profile ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS commercial_profile_read ON v2.commercial_profile;
CREATE POLICY commercial_profile_read ON v2.commercial_profile
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS commercial_profile_write ON v2.commercial_profile;
CREATE POLICY commercial_profile_write ON v2.commercial_profile
  FOR ALL USING (auth.uid() IS NOT NULL);

-- =============================================================================
-- FEDERAL PROFILE  (one per tenant — synthesized from federal sources)
-- =============================================================================
CREATE TABLE IF NOT EXISTS v2.federal_profile (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         text NOT NULL UNIQUE REFERENCES v2.tenants(id) ON DELETE CASCADE,
  synthesized_text  text,
  structured_data   jsonb,
  naics_codes       text[],
  certifications    text[],
  psc_codes         text[],
  uei               text,
  cage              text,
  last_built_at     timestamptz,
  source_count      int NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE v2.federal_profile ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS federal_profile_read ON v2.federal_profile;
CREATE POLICY federal_profile_read ON v2.federal_profile
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS federal_profile_write ON v2.federal_profile;
CREATE POLICY federal_profile_write ON v2.federal_profile
  FOR ALL USING (auth.uid() IS NOT NULL);

-- =============================================================================
-- RECONCILIATION  (versioned — alignment/divergence/suggestions)
-- =============================================================================
CREATE TABLE IF NOT EXISTS v2.reconciliation (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         text NOT NULL REFERENCES v2.tenants(id) ON DELETE CASCADE,
  alignment         text,
  divergence        text,
  suggestions       text,
  structured_data   jsonb,
  version           int NOT NULL DEFAULT 1,
  last_built_at     timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reconciliation_tenant_version_idx
  ON v2.reconciliation (tenant_id, version DESC);

ALTER TABLE v2.reconciliation ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reconciliation_read ON v2.reconciliation;
CREATE POLICY reconciliation_read ON v2.reconciliation
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS reconciliation_write ON v2.reconciliation;
CREATE POLICY reconciliation_write ON v2.reconciliation
  FOR ALL USING (auth.uid() IS NOT NULL);

-- =============================================================================
-- STRATEGIC PROFILES  (many per tenant — the "lanes" for enrichment)
-- =============================================================================
CREATE TABLE IF NOT EXISTS v2.strategic_profiles (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         text NOT NULL REFERENCES v2.tenants(id) ON DELETE CASCADE,
  name              text NOT NULL,
  description       text,
  positioning       text,
  target_agencies   text[],
  target_naics      text[],
  target_psc        text[],
  is_default        boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES v2.users(id),
  deleted_at        timestamptz
);

CREATE INDEX IF NOT EXISTS strategic_profiles_tenant_idx
  ON v2.strategic_profiles (tenant_id) WHERE deleted_at IS NULL;

ALTER TABLE v2.strategic_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS strategic_profiles_read ON v2.strategic_profiles;
CREATE POLICY strategic_profiles_read ON v2.strategic_profiles
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS strategic_profiles_write ON v2.strategic_profiles;
CREATE POLICY strategic_profiles_write ON v2.strategic_profiles
  FOR ALL USING (auth.uid() IS NOT NULL);

-- =============================================================================
-- ENRICHMENT SESSION: add strategic_profile_id link
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='v2' AND table_name='enrichment_sessions' AND column_name='strategic_profile_id'
  ) THEN
    ALTER TABLE v2.enrichment_sessions
      ADD COLUMN strategic_profile_id uuid REFERENCES v2.strategic_profiles(id);
  END IF;
END$$;

-- =============================================================================
-- PROMPT VARIANTS: extend use_case set + seed new synthesis variants
-- =============================================================================
DO $$
BEGIN
  -- Drop and recreate the use_case constraint to accept new values
  BEGIN
    ALTER TABLE v2.prompt_variants DROP CONSTRAINT IF EXISTS prompt_variants_use_case_check;
  EXCEPTION WHEN others THEN NULL;
  END;
  ALTER TABLE v2.prompt_variants
    ADD CONSTRAINT prompt_variants_use_case_check CHECK (use_case IN (
      'enrichment','dna_scoring','gate_synthesis',
      'commercial_profile','federal_profile','reconciliation'
    ));
END$$;

-- Seed the three synthesis prompts (generic — industry-agnostic, applies to every tenant)
INSERT INTO v2.prompt_variants (id, name, industry_tag, use_case, version, prompt_template, is_active)
VALUES
  (
    'commercial_profile_v1',
    'Commercial Profile Synthesis',
    'generic',
    'commercial_profile',
    1,
    $PROMPT$You are analyzing a company to build a COMPREHENSIVE COMMERCIAL COMPANY PROFILE from commercial sources only.

CLIENT: {{tenant_name}}
WEBSITE: {{tenant_website}}

COMMERCIAL SOURCES:
{{commercial_sources}}

Produce a rich commercial profile covering:
1. What the company does (products, services, capabilities, technical differentiators)
2. Who they sell to (commercial customers, industries, geographies)
3. Traction signals (funding, press, partnerships, leadership moves, recent launches)
4. Positioning and narrative (how they describe themselves to commercial buyers)
5. Evident strengths and possible gaps

Be factual. Cite which source each claim comes from. If a claim is weak or inferred, say so. Produce two sections:

## NARRATIVE
(2-4 paragraphs of flowing prose describing the company as a commercial entity)

## STRUCTURED
Return a JSON object in a ```json block with keys:
- products (array of strings)
- services (array of strings)
- industries_served (array of strings)
- key_customers (array of strings, if known)
- traction_signals (array of {type, description, source})
- leadership (array of {name, title, source})
- strengths (array of strings)
- gaps (array of strings)
$PROMPT$,
    true
  ),
  (
    'federal_profile_v1',
    'Federal Profile Synthesis',
    'generic',
    'federal_profile',
    1,
    $PROMPT$You are analyzing a company to build a COMPREHENSIVE FEDERAL COMPANY PROFILE from federal sources only.

CLIENT: {{tenant_name}}

FEDERAL SOURCES:
{{federal_sources}}

Produce a rich federal profile covering:
1. Registered identity (UEI, CAGE, legal name, entity type)
2. NAICS codes and PSC codes they hold
3. Certifications and set-asides (8(a), WOSB, SDVOSB, HUBZone, etc.)
4. Award history (prime + sub, top agencies, dollar volume, recency)
5. GSA Schedule holdings if any
6. Federal positioning (how they present themselves in capability statements)
7. Evident federal strengths and gaps

Be factual. Cite which source each claim comes from. If a field is missing, explicitly say "not found in federal sources". Produce two sections:

## NARRATIVE
(2-4 paragraphs describing the company as a federal contractor)

## STRUCTURED
Return a JSON object in a ```json block with keys:
- uei (string or null)
- cage (string or null)
- legal_name (string or null)
- entity_type (string or null)
- naics_codes (array of strings)
- psc_codes (array of strings)
- certifications (array of strings)
- set_asides (array of strings)
- gsa_schedules (array of strings)
- top_agencies (array of {name, award_count, total_value})
- prime_award_count (int)
- sub_award_count (int)
- total_award_value (number)
- most_recent_award_date (string or null)
- federal_strengths (array of strings)
- federal_gaps (array of strings)
$PROMPT$,
    true
  ),
  (
    'reconciliation_v1',
    'Commercial ↔ Federal Reconciliation',
    'generic',
    'reconciliation',
    1,
    $PROMPT$You are reconciling a company's COMMERCIAL PROFILE against its FEDERAL PROFILE to find where they align, where they diverge, and what strategic suggestions follow.

CLIENT: {{tenant_name}}

COMMERCIAL PROFILE:
{{commercial_profile}}

FEDERAL PROFILE:
{{federal_profile}}

Produce three sections:

## ALIGNMENT
What the commercial profile and federal profile agree on. Where the company's federal positioning accurately reflects its commercial capability. Cite specifics (e.g., "Commercial profile lists X as a core service, federal profile shows Y NAICS code which covers X"). These are the strongest grounds for federal pursuit.

## DIVERGENCE
Where the two profiles DON'T match. Two types:
- Commercial strength NOT reflected federally (company sells Y commercially but has no NAICS, PSC, certification, or award history supporting Y federally)
- Federal claims NOT supported commercially (federal capability statement claims X but commercial evidence is thin)

For each divergence, be specific about which side is stronger and why.

## SUGGESTIONS
Concrete, actionable recommendations. Examples:
- NAICS codes to add to SAM based on commercial capabilities
- Certifications worth pursuing given evident commercial traction
- PSC codes that would better reflect their actual offerings
- Where to focus capability statement revisions
- If federal profile is missing entirely: build a model federal profile from the commercial profile

If no federal profile exists at all (empty federal sources), spend SUGGESTIONS on "here is what this company's federal profile SHOULD look like based purely on its commercial profile."

Also return a ```json block with keys:
- alignment_points (array of strings)
- divergence_points (array of {area, commercial_side, federal_side, stronger_side})
- suggested_naics (array of strings)
- suggested_certifications (array of strings)
- suggested_psc (array of strings)
- overall_alignment_score (int 0-100)
- priority_actions (array of strings, ordered)
$PROMPT$,
    true
  )
ON CONFLICT (id) DO UPDATE SET
  prompt_template = EXCLUDED.prompt_template,
  updated_at = now();

-- =============================================================================
-- Make enrichment_sessions strategic_profile_id nullable (already is)
-- Seed: give every existing tenant a default Strategic Profile if they have none
-- =============================================================================
INSERT INTO v2.strategic_profiles (tenant_id, name, description, is_default)
SELECT t.id, 'Default Strategic Profile', 'Auto-created on profile architecture migration.', true
FROM v2.tenants t
WHERE t.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM v2.strategic_profiles sp
    WHERE sp.tenant_id = t.id AND sp.deleted_at IS NULL
  );

-- Done
