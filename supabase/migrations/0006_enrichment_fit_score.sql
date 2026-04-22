-- 0006 Enrichment fit_score
-- Adds a dedicated fit_score integer column (0-100) to enrichment_records
-- for ranking/sorting. Claude's structured response writes here on each
-- enrichment run.

SET search_path TO v2, public;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'v2' AND table_name = 'enrichment_records' AND column_name = 'fit_score'
  ) THEN
    ALTER TABLE v2.enrichment_records
      ADD COLUMN fit_score integer CHECK (fit_score >= 0 AND fit_score <= 100);

    CREATE INDEX IF NOT EXISTS enrichment_records_fit_score_idx
      ON v2.enrichment_records (session_id, fit_score DESC NULLS LAST);
  END IF;
END$$;
