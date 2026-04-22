-- 0008 Market Analysis column on enrichment_sessions
-- Stores the value-weighted market analysis run over a full dataset:
-- top phrases, top vendors, top agencies, NAICS distribution.

SET search_path TO v2, public;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'v2' AND table_name = 'enrichment_sessions' AND column_name = 'market_analysis'
  ) THEN
    ALTER TABLE v2.enrichment_sessions
      ADD COLUMN market_analysis jsonb,
      ADD COLUMN market_analysis_at timestamptz;
  END IF;
END$$;
