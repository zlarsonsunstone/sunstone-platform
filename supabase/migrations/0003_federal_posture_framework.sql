-- 0003 Federal posture + Framework mode
-- Adds tenants.federal_posture to let a company declare "no federal presence yet"
-- When federal_posture = 'no_federal', the Reconciliation column runs in Framework mode:
-- comprehensive entry recommendations (NAICS, PSC, certifications, keywords, narrative)
-- based purely on the commercial profile.
--
-- Safe to re-run. Idempotent.

SET search_path TO v2, public;

-- =============================================================================
-- Add federal_posture column to tenants
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'v2'
      AND table_name = 'tenants'
      AND column_name = 'federal_posture'
  ) THEN
    ALTER TABLE v2.tenants
      ADD COLUMN federal_posture text NOT NULL DEFAULT 'unknown'
        CHECK (federal_posture IN ('unknown','has_federal','no_federal'));
  END IF;
END$$;

-- =============================================================================
-- Add mode column to reconciliation so we can tell "alignment" vs "framework" rows apart
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'v2'
      AND table_name = 'reconciliation'
      AND column_name = 'mode'
  ) THEN
    ALTER TABLE v2.reconciliation
      ADD COLUMN mode text NOT NULL DEFAULT 'reconcile'
        CHECK (mode IN ('reconcile','framework'));
  END IF;
END$$;

-- =============================================================================
-- Seed: Federal Entry Framework prompt variant
-- =============================================================================
INSERT INTO v2.prompt_variants (id, name, industry_tag, use_case, version, prompt_template, is_active)
VALUES
  (
    'federal_entry_framework_v1',
    'Federal Entry Framework (no existing federal profile)',
    'generic',
    'reconciliation',
    1,
    $PROMPT$You are building a FEDERAL ENTRY FRAMEWORK for a company that has NO existing federal presence (no SAM registration, no federal awards, no certifications). Your job is to translate their commercial profile into a comprehensive plan for how they should enter the federal market.

CLIENT: {{tenant_name}}

COMMERCIAL PROFILE:
{{commercial_profile}}

Produce a rich framework covering FIVE sections. Be specific, not generic. Every recommendation must tie back to evidence in the commercial profile.

## NARRATIVE
(3-5 paragraphs) Read the commercial profile and describe:
- What this company's federal story SHOULD be — how they'd introduce themselves to a contracting officer
- Which federal buyers most likely need what they already do commercially (specific agencies, program offices, buying commands)
- The strongest "wedge" — the one capability or offering that's the cleanest path into federal work
- Realistic timeline expectations given their current commercial traction (no federal past, so: SAM registration → one subcontract → first prime)
- What gaps the company has to close before federal buyers will take them seriously

## SUGGESTED NAICS CODES
List 5-12 NAICS codes they should register for on SAM. For each, give:
- The 6-digit code
- The official title
- Why it fits (one sentence tied to evidence in commercial profile)
- Priority tier: PRIMARY (register first, use as primary NAICS) / SECONDARY (add to registration) / FUTURE (revisit after first wins)

## SUGGESTED PSC CODES
List 5-10 Product Service Codes that best describe what they sell. For each:
- The 4-character PSC code
- The title
- Why it fits

## CERTIFICATIONS TO PURSUE
For each of these, say whether to PURSUE NOW, PURSUE LATER, or SKIP, with one-line rationale:
- 8(a) Business Development (socioeconomic)
- HUBZone (location-dependent)
- WOSB / EDWOSB (ownership-dependent)
- SDVOSB / VOSB (ownership-dependent)
- SBIR/STTR eligibility (R&D companies)
- Small business size standard fit under chosen NAICS
- GSA Schedule (revisit after first award)
- Any state-level equivalents worth registering (state small business, minority business, etc.)

## SAM.GOV KEYWORDS
Give 15-25 keywords and phrases they should seed their SAM profile, capability statement, and search alerts with. Prioritize words federal buyers actually use, not commercial marketing speak. Include:
- Technical capability terms
- Agency-specific vocabulary (if commercial profile hints at target domains)
- Adjacent program office language
- Compliance/standard references if any apply (FedRAMP, FISMA, Section 508, IL2/IL4/IL5, CMMC, etc.)

Also return a ```json block with keys:
- narrative_summary (string, 2-3 sentences)
- primary_naics (array of strings — 2-3 codes max)
- all_naics (array of {code, title, priority})
- psc_codes (array of {code, title})
- certifications (array of {name, recommendation, rationale})
- keywords (array of strings)
- wedge_capability (string — the single clearest entry point)
- target_agencies (array of strings — specific buyers, not "federal government")
- realistic_first_award_timeline (string — e.g., "12-18 months to first subcontract")
$PROMPT$,
    true
  )
ON CONFLICT (id) DO UPDATE SET
  prompt_template = EXCLUDED.prompt_template,
  updated_at = now();

-- Done
