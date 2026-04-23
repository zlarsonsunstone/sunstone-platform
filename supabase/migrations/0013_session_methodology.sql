-- 0013 Session Methodology Metadata
--
-- Captures the WHY behind every dataset upload: NAICS rationale, PSC rationale,
-- date range rationale, threshold rationale. All required at upload time so the
-- methodology report can reconstruct the analyst's reasoning for every layer.
--
-- methodology JSONB shape:
-- {
--   "naics_codes": ["541513", "518210"],
--   "naics_rationale": "Why these NAICS codes",
--   "psc_prefixes": ["D3"],
--   "psc_rationale": "Why these PSC prefixes",
--   "date_range_start": "2025-01-01",
--   "date_range_end": null,
--   "date_range_rationale": "Why this date range",
--   "min_dollar_value": 0,
--   "min_dollar_rationale": "Why this threshold"
-- }

SET search_path TO v2, public;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'v2' AND table_name = 'enrichment_sessions' AND column_name = 'methodology'
  ) THEN
    ALTER TABLE v2.enrichment_sessions
      ADD COLUMN methodology jsonb,
      ADD COLUMN display_name text;
  END IF;
END$$;

-- Index for methodology searches in the report generator (optional, light)
CREATE INDEX IF NOT EXISTS enrichment_sessions_has_methodology_idx
  ON v2.enrichment_sessions ((methodology IS NOT NULL));
