-- 0009 Round 1 Keyword Bank
--
-- Persistent per-tenant store of curated Round 1 search keywords.
-- Keywords are extracted by Claude from uploaded datasets (contract
-- descriptions, value-weighted, relevance-scored for the tenant), and
-- the user picks which ones to save to their Round 1 list.
--
-- Full provenance: each keyword remembers which scope's dataset
-- surfaced it and which session it came from.

SET search_path TO v2, public;

CREATE TABLE IF NOT EXISTS v2.round_1_keywords (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              text NOT NULL REFERENCES v2.tenants(id) ON DELETE CASCADE,

  phrase                 text NOT NULL,
  dollar_volume          bigint,
  award_count            integer,
  avg_contract           bigint,
  relevance_score        integer CHECK (relevance_score BETWEEN 1 AND 10),
  relevance_rationale    text,
  claude_context         text,  -- what Claude said the phrase signals

  -- Provenance daisy chain
  source_scope_id        uuid REFERENCES v2.search_scopes(id) ON DELETE SET NULL,
  source_scope_tag       text,
  source_session_id      uuid REFERENCES v2.enrichment_sessions(session_id) ON DELETE SET NULL,

  -- User curation
  notes                  text,

  picked_by              uuid,
  picked_at              timestamptz NOT NULL DEFAULT now(),

  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  deleted_at             timestamptz,

  UNIQUE (tenant_id, phrase)
);

CREATE INDEX IF NOT EXISTS round_1_keywords_tenant_idx
  ON v2.round_1_keywords (tenant_id, deleted_at, picked_at DESC);

CREATE INDEX IF NOT EXISTS round_1_keywords_scope_idx
  ON v2.round_1_keywords (source_scope_id);

ALTER TABLE v2.round_1_keywords ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS round_1_keywords_read ON v2.round_1_keywords;
CREATE POLICY round_1_keywords_read ON v2.round_1_keywords
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS round_1_keywords_write ON v2.round_1_keywords;
CREATE POLICY round_1_keywords_write ON v2.round_1_keywords
  FOR ALL USING (auth.uid() IS NOT NULL);
