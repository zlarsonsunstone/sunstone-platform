-- 0017 Track prompt template version on reconciliation rows
--
-- Frameworks generated before PSC/NAICS reference grounding (prompt v1)
-- contain stale D3xx/7030 PSC codes. Frameworks generated after (v2+) use
-- the authoritative reference tables. We track which version generated a
-- given reconciliation so downstream actions (like "Create strategic profile
-- from these suggestions") can gate on it being current.

SET search_path TO v2, public;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'v2' AND table_name = 'reconciliation'
      AND column_name = 'prompt_template_version'
  ) THEN
    ALTER TABLE v2.reconciliation
      ADD COLUMN prompt_template_version integer;
  END IF;
END$$;

-- Backfill: existing rows predate reference grounding, mark as v1
UPDATE v2.reconciliation
SET prompt_template_version = 1
WHERE prompt_template_version IS NULL;
