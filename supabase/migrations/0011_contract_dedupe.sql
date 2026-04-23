-- 0011 Contract dedupe architecture
--
-- Adds columns + indexes required for cross-session contract dedupe by
-- (award_id_piid, contract_award_unique_key). When a CSV is uploaded tagged
-- to scope B, any contract already ingested from scope A gets its
-- source_scope_tags array appended rather than being inserted as a new row.
--
-- - contract_award_unique_key: full USASpending composite ID for exact-match
--   dedupe (e.g. "CONT_AWD_11316025F0001CEA_1100_11316021A0005EOP_1100")
-- - source_scope_tags: array of all scope slugs that have surfaced this record
-- - source_scope_ids: array of all scope UUIDs that have surfaced this record
-- - source_session_ids: array of all session UUIDs that ingested this record

SET search_path TO v2, public;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'v2' AND table_name = 'enrichment_records' AND column_name = 'contract_award_unique_key'
  ) THEN
    ALTER TABLE v2.enrichment_records
      ADD COLUMN contract_award_unique_key text,
      ADD COLUMN source_scope_tags text[] DEFAULT '{}',
      ADD COLUMN source_scope_ids uuid[] DEFAULT '{}',
      ADD COLUMN source_session_ids uuid[] DEFAULT '{}';
  END IF;
END$$;

-- Dedupe index: (tenant_id, contract_number, contract_award_unique_key) uniquely
-- identifies a contract for a tenant. We use this to find existing records when
-- importing a new CSV.
CREATE INDEX IF NOT EXISTS enrichment_records_dedupe_idx
  ON v2.enrichment_records (tenant_id, contract_number, contract_award_unique_key);

-- Index on scope tags for filtering the keyword bank by scope
CREATE INDEX IF NOT EXISTS enrichment_records_scope_tags_idx
  ON v2.enrichment_records USING GIN (source_scope_tags);

-- Backfill: copy existing singular fields into the arrays for records
-- inserted before dedupe logic existed. Safe no-op if columns already have data.
UPDATE v2.enrichment_records
SET
  source_scope_tags = ARRAY[source_scope_tag]::text[],
  source_scope_ids = CASE WHEN source_scope_id IS NOT NULL THEN ARRAY[source_scope_id] ELSE '{}' END,
  source_session_ids = ARRAY[session_id]::uuid[]
WHERE source_scope_tag IS NOT NULL
  AND (source_scope_tags = '{}' OR source_scope_tags IS NULL);
