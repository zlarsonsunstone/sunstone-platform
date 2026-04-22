-- 0004 Digest pipeline
-- Adds per-source "digest" fields so we can process each source independently
-- through Claude (200-300 word structured summary) before final profile synthesis.
-- Solves the "17 sources = one giant prompt that times out" problem.
--
-- Each source gets digested once, digest saved, then profile synthesis uses
-- the digests instead of raw content. Fast individual calls, clean retries.

SET search_path TO v2, public;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'v2' AND table_name = 'profile_sources' AND column_name = 'digest_text'
  ) THEN
    ALTER TABLE v2.profile_sources
      ADD COLUMN digest_text      text,
      ADD COLUMN digest_structured jsonb,
      ADD COLUMN digest_status    text NOT NULL DEFAULT 'pending'
        CHECK (digest_status IN ('pending','running','ready','error','skipped')),
      ADD COLUMN digest_error     text,
      ADD COLUMN digested_at      timestamptz;
  END IF;
END$$;

-- Seed a generic "source digest" prompt variant
INSERT INTO v2.prompt_variants (id, name, industry_tag, use_case, version, prompt_template, is_active)
VALUES
  (
    'source_digest_v1',
    'Source Digest (per-source summary)',
    'generic',
    'commercial_profile',   -- reuse existing use_case; this prompt runs as sub-step
    1,
    $PROMPT$You are reading ONE source about a company and producing a tight, information-dense DIGEST that will feed into a larger profile synthesis later. Keep everything relevant, lose everything fluffy.

COMPANY: {{tenant_name}}
SOURCE TYPE: {{source_type}}
SOURCE LABEL: {{source_label}}
{{#if source_url}}SOURCE URL: {{source_url}}{{/if}}

SOURCE CONTENT:
{{source_content}}

Produce:

## DIGEST
(200-300 words) Capture what this source tells us about the company. Prioritize:
- Products, services, capabilities
- Customers, partners, markets
- Funding, revenue signals, traction events
- Leadership, team size, location
- Technical differentiators, IP, certifications
- Press/events/launches (with dates if present)
- Any federal / government / agency mentions

Skip: marketing adjectives, generic boilerplate, website nav chrome, duplicated info.

## STRUCTURED
Return a ```json block with keys (omit any key not present in the source):
- products (array of strings)
- services (array of strings)
- customers (array of strings)
- partners (array of strings)
- markets (array of strings)
- funding_events (array of {date, type, amount, source})
- leadership (array of {name, title})
- technical_signals (array of strings)
- dates_mentioned (array of strings)
- federal_signals (array of strings - any mention of federal/government/agency work)
- confidence (string: "high" | "medium" | "low" — how much useful signal this source contained)
$PROMPT$,
    true
  )
ON CONFLICT (id) DO UPDATE SET
  prompt_template = EXCLUDED.prompt_template,
  updated_at = now();

-- Done.
