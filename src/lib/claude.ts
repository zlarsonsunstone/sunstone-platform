// =============================================================================
// INTAKE PERSONALIZATION HELPERS
// =============================================================================
//
// These helpers take a public_intake_submission row + prelim_profile row
// and generate a ScriptPersonalization payload for the IntakeRunner UI.
//
// To be added to /src/lib/claude.ts (do NOT replace the file - APPEND these
// functions and types at the end).
// =============================================================================

export interface IntakeFormSnapshot {
  // Contact
  full_name: string
  email: string
  phone?: string | null

  // About you
  industry_sector?: string | null
  referred_by?: string | null
  catalyst?: string | null

  // Commercial
  company_name?: string | null
  company_website?: string | null
  year_founded?: number | null
  headcount?: string | null
  revenue_range?: string | null
  capabilities?: string | null
  customers?: string | null
  geographic_footprint?: string[] | null
  differentiator?: string | null
  linkedin_url?: string | null

  // Federal
  federal_path?: string | null
  federal_answers?: Record<string, any> | null
}

export interface PrelimProfileSnapshot {
  company_overview?: string | null
  capabilities?: string[] | null
  past_performance?: string[] | null
  target_agencies?: string[] | null
  current_naics?: string[] | null
  recommended_naics?: string[] | null
  certifications?: string[] | null
  narrative_final?: string | null
}

export interface ScriptPersonalization {
  recommended_branches: Array<{
    branch: string
    confidence: 'high' | 'medium' | 'low'
    reasoning: string
  }>

  foundation_personalizations: Record<string, {
    question_id: string
    original_text: string
    personalized_text: string | null
    form_context: Array<{ field: string; value: any }>
    recommendation: 'use_personalized' | 'use_original' | 'skip_already_answered'
  }>

  branch_personalizations: Record<string, Array<{
    question_id: string
    original_text: string
    personalized_text: string | null
    form_context: Array<{ field: string; value: any }>
    recommendation: 'use_personalized' | 'use_original' | 'skip_already_answered' | 'replace_with_probe'
    replacement_probe?: string
  }>>

  conversational_intel: {
    catalyst_summary: string | null
    pre_known_pain_points: string[]
    pre_known_blockers: string[]
    revenue_band: string | null
    budget_band: string | null
    federal_posture: string | null
    persona_hypothesis: string | null
  }
}

/**
 * Generate the script personalization payload for an intake session.
 *
 * Reads the public intake submission + cleaned prelim profile, asks Claude to
 * recommend branch modules and personalize foundation + branch questions
 * based on what the prospect has already told us.
 */
export async function recommendIntakeBranches(
  submission: IntakeFormSnapshot,
  prelim: PrelimProfileSnapshot | null,
): Promise<ScriptPersonalization> {
  const system = `You are a federal market intake interview architect for Sunstone Advisory Group.

Your job: read what a prospect has told us in their public intake form (and our cleaned-up prelim profile), and personalize their 30-minute Zoom intake script.

THE 30-MIN ZOOM SCRIPT STRUCTURE:
- Foundation (every prospect): 4 anchor questions (F1 Catalyst, F2 Mirror, F3 Money Reality, F4 Decision Authority)
- Plus 1-2 branch modules picked from these 6:
  * branch_naive_capitalized: no federal experience + healthy revenue + real budget
  * branch_naive_undercapitalized: no federal experience + limited revenue/budget
  * branch_stuck_sub: federal sub experience but never prime
  * branch_plateau_prime: has primes, can't grow them
  * branch_displacement_threat: has prime book, work changing under them
  * branch_pivoting_incumbent: has prime book, intentionally pivoting

YOUR TASK has THREE parts:

PART 1 - RECOMMEND BRANCHES
Based on the form data, recommend 1-2 branch modules with reasoning. Use these decision rules:
- federal_path == 'none' + revenue >=$2M + budget >=$25k -> branch_naive_capitalized
- federal_path == 'none' + revenue <$2M or budget <$25k -> branch_naive_undercapitalized
- federal_path == 'sub' -> branch_stuck_sub
- federal_path == 'limited_prime' default -> branch_plateau_prime; if Q2.D3 mentions market change -> branch_displacement_threat
- federal_path == 'established_prime' + actively_pivoting in [yes_describe, considering] -> branch_pivoting_incumbent
- federal_path == 'established_prime' + actively_pivoting == 'no_defending' -> branch_displacement_threat
- federal_path == 'some' + blocker == 'past_performance' -> branch_stuck_sub; otherwise branch_naive_capitalized

PART 2 - PERSONALIZE FOUNDATION QUESTIONS
For each foundation question (F1, F2, F3, F4), produce a personalized version that references what the prospect already told us in the form. If the form didn't supply useful context for a question, set personalized_text to null and recommend 'use_original'.

F1 (Catalyst): If form catalyst is non-empty, personalize to reference it. "You wrote: '[catalyst]'. Walk me through what's happened since you wrote that..."
F2 (Mirror): If customers field has named companies (not generic types), personalize to reference them.
F3 (Money Reality): If form has budget signals (Q2.A3 or revenue range), personalize to reference them.
F4 (Decision): Always use_original. Decision authority is an in-call signal.

PART 3 - CONVERSATIONAL INTEL
Provide a brief synthesis of what the consultant should know going in:
- catalyst_summary: 1-sentence summary of what's prompting this
- pre_known_pain_points: array of things they've already named as struggles
- pre_known_blockers: array of things they've already named as blocking them
- revenue_band, budget_band, federal_posture: what we already know
- persona_hypothesis: pre-call guess at which Sunstone persona fits (Subcontractor Stuck in the Middle, Successful and Skeptical, Brand New, Compliance-maintaining non-participant, Recently Re-Energized, Sub-Prime Plateau, Disruptive Entrant, Mature Player Pivoting, Adjacent Market Crossover)

Return ONLY valid JSON in a json fenced block. Example structure:

\`\`\`json
{
  "recommended_branches": [
    {"branch": "branch_naive_capitalized", "confidence": "high", "reasoning": "..."}
  ],
  "foundation_personalizations": {
    "F1": {
      "question_id": "F1",
      "original_text": "Walk me through how we ended up on this call today...",
      "personalized_text": "You wrote: '...'. Walk me through what's happened since...",
      "form_context": [{"field": "catalyst", "value": "..."}],
      "recommendation": "use_personalized"
    },
    "F2": {...},
    "F3": {...},
    "F4": {...}
  },
  "branch_personalizations": {
    "branch_naive_capitalized": [
      {
        "question_id": "A1",
        "original_text": "Two years from now, you've won your first federal contract...",
        "personalized_text": null,
        "form_context": [],
        "recommendation": "use_original"
      }
    ]
  },
  "conversational_intel": {
    "catalyst_summary": "...",
    "pre_known_pain_points": ["..."],
    "pre_known_blockers": ["..."],
    "revenue_band": "...",
    "budget_band": "...",
    "federal_posture": "...",
    "persona_hypothesis": "..."
  }
}
\`\`\``

  const userMessage = `PUBLIC INTAKE FORM SUBMISSION:

Name: ${submission.full_name}
Company: ${submission.company_name || '(not provided)'}
Industry sector: ${submission.industry_sector || '(not provided)'}
Referred by: ${submission.referred_by || '(none)'}

CATALYST:
${submission.catalyst || '(not provided)'}

COMMERCIAL PROFILE:
- Year founded: ${submission.year_founded || 'unknown'}
- Headcount: ${submission.headcount || 'unknown'}
- Revenue: ${submission.revenue_range || 'unknown'}
- Geographic footprint: ${(submission.geographic_footprint || []).join(', ') || 'unknown'}

Capabilities:
${submission.capabilities || '(not provided)'}

Top customers:
${submission.customers || '(not provided)'}

Differentiator:
${submission.differentiator || '(not provided)'}

Website: ${submission.company_website || '(not provided)'}
LinkedIn: ${submission.linkedin_url || '(not provided)'}

FEDERAL POSTURE:
Path: ${submission.federal_path || 'unknown'}

Federal answers:
${JSON.stringify(submission.federal_answers || {}, null, 2)}

${prelim ? `\nCLEANED PRELIM PROFILE (from consultant):\n${JSON.stringify(prelim, null, 2)}` : '\n(No prelim profile yet - just form data)'}

Generate the personalization payload.`

  const response = await callClaudeBrowser(userMessage, {
    system,
    model: 'claude-sonnet-4-5',
    maxTokens: 4096,
  })

  const parsed = extractJsonBlock(response.text)
  if (!parsed) {
    throw new Error('Could not parse personalization JSON')
  }
  return parsed as ScriptPersonalization
}

/**
 * Cross-reference engine - INTERNAL ONLY.
 * Compares prelim profile + intake transcript + signal scores.
 * Returns structured findings (contradictions, confirmations, extensions, new_insights).
 *
 * Output rows go into v2.intake_cross_reference with internal_only=true.
 * Prospects NEVER see these.
 */
export interface CrossReferenceFindings {
  findings: Array<{
    finding_type: 'contradiction' | 'confirmation' | 'extension' | 'new_insight'
    prelim_claim: string
    intake_statement: string
    consultant_interpretation: string
  }>
}

export async function generateCrossReferenceFindings(
  prelim: PrelimProfileSnapshot,
  transcriptText: string,
  signalScores: Record<string, any>,
): Promise<CrossReferenceFindings> {
  const system = `You are a federal market analyst for Sunstone Advisory Group.

Your job: cross-reference what a prospect TOLD us in their prelim profile against what they SAID in the 30-min Zoom intake, plus the consultant's signal scoring rubric.

Look for these four types of findings:

1. CONTRADICTION - prelim claims X, intake reveals not-X (or different X)
2. CONFIRMATION - prelim claims X, intake provides specific evidence for X
3. EXTENSION - prelim is silent on something, intake adds new dimension
4. NEW_INSIGHT - intake reveals something not in prelim that materially changes our framing

CRITICAL: This is INTERNAL framing only. Prospects MAY NOT see these findings. Be candid. Note delusion, defensiveness, evasion, or contradictions you'd never say to the prospect's face. The cross-reference is the consultant's private analytical tool.

Return ONLY valid JSON:

\`\`\`json
{
  "findings": [
    {
      "finding_type": "contradiction|confirmation|extension|new_insight",
      "prelim_claim": "what the prelim said",
      "intake_statement": "what they said in the call",
      "consultant_interpretation": "what this means for our framing"
    }
  ]
}
\`\`\``

  const userMessage = `PRELIM PROFILE (cleaned by consultant):
${JSON.stringify(prelim, null, 2)}

INTAKE TRANSCRIPT:
${transcriptText.slice(0, 30000)}${transcriptText.length > 30000 ? '\n[transcript truncated]' : ''}

CONSULTANT'S SIGNAL SCORING:
${JSON.stringify(signalScores, null, 2)}

Generate cross-reference findings.`

  const response = await callClaudeBrowser(userMessage, {
    system,
    model: 'claude-sonnet-4-5',
    maxTokens: 4096,
  })

  const parsed = extractJsonBlock(response.text)
  if (!parsed) {
    throw new Error('Could not parse cross-reference findings JSON')
  }
  return parsed as CrossReferenceFindings
}
