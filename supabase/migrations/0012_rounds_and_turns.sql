-- 0012 Rounds + Turns architecture
--
-- Introduces explicit "rounds" as a user-controlled phase of federal market
-- analysis, replacing the implicit "iteration" counter on sessions.
--
--   Round 1 — Discovery:  stack NAICS/PSC scope uploads; extract keywords
--                         from dataset descriptions; pick keywords into bank
--   Round 2 — Targeted:   use curated keywords from bank to pull focused
--                         datasets; run per-record fit scoring
--   Round 3+ — Future:    vendor deep-dive / agency capture / etc.
--
-- User moves between rounds explicitly. "Turns" exist within a round
-- (numbering restarts each round).

SET search_path TO v2, public;

-- Tenant-level round state
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'v2' AND table_name = 'tenants' AND column_name = 'current_round'
  ) THEN
    ALTER TABLE v2.tenants
      ADD COLUMN current_round integer NOT NULL DEFAULT 1;
  END IF;
END$$;

-- Session-level round + turn
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'v2' AND table_name = 'enrichment_sessions' AND column_name = 'round_number'
  ) THEN
    ALTER TABLE v2.enrichment_sessions
      ADD COLUMN round_number integer NOT NULL DEFAULT 1,
      ADD COLUMN turn_number integer;
  END IF;
END$$;

-- Backfill: treat all existing sessions as Round 1, copy iteration to turn_number
UPDATE v2.enrichment_sessions
SET round_number = 1,
    turn_number = iteration
WHERE turn_number IS NULL;

-- Index for "all sessions in a round" queries
CREATE INDEX IF NOT EXISTS enrichment_sessions_round_idx
  ON v2.enrichment_sessions (tenant_id, round_number, turn_number);
