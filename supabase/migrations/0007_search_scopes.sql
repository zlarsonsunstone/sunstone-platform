-- 0007 Search Scopes (Round 1) — with correlation scoring and market estimates
--
-- Each scope combines NAICS codes + PSC prefixes and represents one shape of
-- federal procurement. Scopes carry BOTH AI-estimated market data (so you can
-- sort before searching) AND actual data that gets backfilled after you upload
-- a CSV tagged to the scope (so you can calibrate over time).
--
-- scope_tag is the provenance anchor: every enrichment record references the
-- scope that surfaced it, giving us a full daisy chain from scope → dataset
-- → records → analysis.

SET search_path TO v2, public;

CREATE TABLE IF NOT EXISTS v2.search_scopes (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                  text NOT NULL REFERENCES v2.tenants(id) ON DELETE CASCADE,

  -- Provenance tag (short slug)
  scope_tag                  text NOT NULL,
  name                       text NOT NULL,
  tier                       text NOT NULL CHECK (tier IN ('primary', 'secondary', 'exploratory')),
  rationale                  text,

  -- The taxonomy combination — NAICS × PSC
  naics_codes                text[] NOT NULL DEFAULT '{}',
  psc_prefixes               text[] NOT NULL DEFAULT '{}',

  -- Optional SOW language that could be layered on top of the NAICS/PSC filter
  keyword_layers             text[],

  -- AI correlation scoring
  -- How well does this scope fit the company's profile? 1-10.
  -- Below 5 = probably skip unless you're fishing.
  correlation_score          integer CHECK (correlation_score BETWEEN 1 AND 10),
  correlation_rationale      text,

  -- AI market size ESTIMATES (guesses, used for sorting before you have real data)
  estimated_annual_awards    integer,
  estimated_annual_dollars   bigint,
  estimated_size_label       text,  -- qualitative: "large", "medium", "small", "niche"

  -- ACTUAL market data (populated after a dataset tagged to this scope is imported)
  actual_award_count         integer,
  actual_dollar_volume       bigint,
  last_imported_at           timestamptz,

  -- Derived state machine: 'proposed' | 'searched' | 'imported'
  -- (we don't enforce this in SQL — frontend can derive from actual_award_count presence)

  -- Strategic
  strategic_angle            text,

  -- Generation metadata
  generated_by               text DEFAULT 'claude_sonnet_4_5',
  generated_at               timestamptz NOT NULL DEFAULT now(),

  -- User curation
  pinned                     boolean NOT NULL DEFAULT false,
  archived                   boolean NOT NULL DEFAULT false,
  notes                      text,

  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  deleted_at                 timestamptz,

  UNIQUE (tenant_id, scope_tag)
);

CREATE INDEX IF NOT EXISTS search_scopes_tenant_idx
  ON v2.search_scopes (tenant_id, archived, tier, correlation_score DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS search_scopes_market_idx
  ON v2.search_scopes (tenant_id, estimated_annual_dollars DESC NULLS LAST);

ALTER TABLE v2.search_scopes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS search_scopes_read ON v2.search_scopes;
CREATE POLICY search_scopes_read ON v2.search_scopes
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS search_scopes_write ON v2.search_scopes;
CREATE POLICY search_scopes_write ON v2.search_scopes
  FOR ALL USING (auth.uid() IS NOT NULL);

-- Tag enrichment records with their source scope (provenance)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'v2' AND table_name = 'enrichment_records' AND column_name = 'source_scope_id'
  ) THEN
    ALTER TABLE v2.enrichment_records
      ADD COLUMN source_scope_id uuid REFERENCES v2.search_scopes(id) ON DELETE SET NULL,
      ADD COLUMN source_scope_tag text;

    CREATE INDEX IF NOT EXISTS enrichment_records_scope_idx
      ON v2.enrichment_records (source_scope_id, session_id);
  END IF;
END$$;

-- Tag enrichment sessions (a session can span multiple scopes)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'v2' AND table_name = 'enrichment_sessions' AND column_name = 'source_scope_ids'
  ) THEN
    ALTER TABLE v2.enrichment_sessions
      ADD COLUMN source_scope_ids uuid[] DEFAULT '{}',
      ADD COLUMN source_scope_tags text[] DEFAULT '{}';
  END IF;
END$$;
