-- 0016 Federal Entry Framework prompt — ground in PSC/NAICS reference tables
--
-- The v1 prompt from migration 0003 asked Claude to hallucinate NAICS/PSC codes
-- from training data. That produced stale D3xx/7030/7045 PSC codes. This
-- replaces the prompt with v2 that uses {{psc_reference}} and {{naics_reference}}
-- placeholders — the application runtime fills these with active codes queried
-- from v2.psc_codes and v2.naics_codes before calling Claude.

SET search_path TO v2, public;

UPDATE v2.prompt_variants
SET
  prompt_template = $PROMPT$You are building a FEDERAL ENTRY FRAMEWORK for a company that has NO existing federal presence (no SAM registration, no federal awards, no certifications). Your job is to translate their commercial profile into a comprehensive plan for how they should enter the federal market.

CLIENT: {{tenant_name}}

COMMERCIAL PROFILE:
{{commercial_profile}}

## AUTHORITATIVE PSC REFERENCE (April 2025 GSA Manual — currently active codes only)

You MUST pick PSC codes from this list. Do NOT use codes outside this list. Do NOT use deprecated codes like D3xx, 7030, 7045, R425, R408 — those were retired and replaced by the DA/DB/DC/DD/DE/DF/DG/DH/DJ service codes and 7A/7B/7C/7D/7E/7F/7G/7H/7J product codes.

{{psc_reference}}

## AUTHORITATIVE NAICS REFERENCE (2022 revision — 6-digit codes)

You MUST pick NAICS codes from this list.

{{naics_reference}}

---

Produce a rich framework covering FIVE sections. Be specific, not generic. Every recommendation must tie back to evidence in the commercial profile.

## NARRATIVE
(3-5 paragraphs) Read the commercial profile and describe:
- What this company's federal story SHOULD be — how they would introduce themselves to a contracting officer
- Which federal buyers most likely need what they already do commercially (specific agencies, program offices, buying commands)
- The strongest "wedge" — the one capability or offering that is the cleanest path into federal work
- Realistic timeline expectations given their current commercial traction (no federal past, so: SAM registration → one subcontract → first prime)
- What gaps the company has to close before federal buyers will take them seriously

## SUGGESTED NAICS CODES
List 5-12 NAICS codes they should register for on SAM. For each, give:
- The 6-digit code FROM THE AUTHORITATIVE LIST ABOVE
- The official title (as written in the reference list)
- Why it fits (one sentence tied to evidence in commercial profile)
- Priority tier: PRIMARY (register first, use as primary NAICS) / SECONDARY (add to registration) / FUTURE (revisit after first wins)

## SUGGESTED PSC CODES
List 5-10 Product Service Codes that best describe what they sell. For each:
- The PSC code FROM THE AUTHORITATIVE LIST ABOVE (e.g. DA01, DB10, DJ10, 7B22 — NOT D307, D310, 7030)
- The title (as written in the reference list)
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
- FedRAMP (if cloud/SaaS)
- CMMC Level 2 (if DoD)
- ISO 27001 / SOC 2 Type II (if handling sensitive data)
- Any state-level equivalents worth registering (state small business, minority business, etc.)

## SAM.GOV KEYWORDS
Give 15-25 keywords and phrases they should seed their SAM profile, capability statement, and search alerts with. Prioritize words federal buyers actually use, not commercial marketing speak. Include:
- Technical capability terms
- Agency-specific vocabulary (if commercial profile hints at target domains)
- Adjacent program office language
- Compliance/standard references if any apply (FedRAMP, FISMA, Section 508, IL2/IL4/IL5, CMMC, etc.)

Also return a ```json block with keys:
- narrative_summary (string, 2-3 sentences)
- primary_naics (array of strings — 2-3 codes max, from the authoritative list)
- all_naics (array of {code, title, priority})
- psc_codes (array of {code, title})
- certifications (array of {name, recommendation, rationale})
- keywords (array of strings)
- wedge_capability (string — the single clearest entry point)
- target_agencies (array of strings — specific buyers, not "federal government")
- realistic_first_award_timeline (string — e.g., "12-18 months to first subcontract")
$PROMPT$,
  version = 2,
  updated_at = now()
WHERE id = 'federal_entry_framework_v1';
