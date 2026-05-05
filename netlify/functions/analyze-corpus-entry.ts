/**
 * analyze-corpus-entry
 *
 * Per-artifact analysis pipeline for the Sunstone contradiction model.
 *
 * INPUT:  { entry_id: uuid }
 * OUTPUT: { ok: true, analysis: {...}, claim_ids: [...], evidence_ids: [...] }
 *
 * Flow:
 *   1. Load the surface_research entry by id
 *   2. Load the strategic_profile (Frame, CBP, current understanding)
 *   3. Build a structured prompt for Claude with the truth-pyramid doctrine
 *   4. Call Claude, parse JSON response
 *   5. Write analysis to surface_research.analysis
 *   6. Write claims to profile_claims (Tier 1/3/4 only)
 *   7. Write evidence to profile_evidence (Tier 2/3 only)
 *   8. Update profile_understanding (convergent state)
 *   9. Mark entry analysis_status = 'awaiting_review'
 *
 * The consultant then reviews in the UI, answers framing questions,
 * and either accepts or edits the proposed claims/evidence.
 */

import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

// -----------------------------------------------------------------------------
// CONFIG
// -----------------------------------------------------------------------------

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const ANTHROPIC_API_KEY = process.env.VITE_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || ''

const CLAUDE_MODEL = 'claude-sonnet-4-5-20250929'
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const MAX_ARTIFACT_TEXT_CHARS = 80000  // ~20K tokens, fits comfortably with system prompt + context

// -----------------------------------------------------------------------------
// TYPES
// -----------------------------------------------------------------------------

interface AnalysisRequest {
  entry_id: string
}

interface SurfaceEntry {
  id: string
  tenant_id: string
  strategic_profile_id: string
  title: string
  entry_kind: string
  source_label: string | null
  source_url: string | null
  raw_payload: any
  signal_dimensions: string[]
  tier: number | null
  tier_label: string | null
}

interface StrategicProfile {
  id: string
  tenant_id: string
  name: string
  description: string | null
  positioning: string | null
  profile_understanding: any
}

interface ClaimProposal {
  claim_text: string
  claim_category: string
  confidence_level: 'high' | 'medium' | 'low'
  is_brief_critical: boolean
}

interface EvidenceProposal {
  evidence_text: string
  evidence_category: string
  citation_url?: string
  data_as_of?: string
}

interface ClaudeAnalysis {
  summary: string
  detected_tier: 1 | 2 | 3 | 4
  detected_tier_reasoning: string
  proposed_claims: ClaimProposal[]
  proposed_evidence: EvidenceProposal[]
  market_state_read: {
    read: 'mature_defined' | 'mature_diffuse' | 'emerging' | 'recently_legislated' | 'novel' | 'no_change'
    confidence: 'high' | 'medium' | 'low'
    reasoning: string
  }
  persona_read: {
    read: string
    confidence: 'high' | 'medium' | 'low'
    reasoning: string
  }
  dynamic_findings: Array<{
    topic: string
    finding: string
    confidence: 'high' | 'medium' | 'low'
  }>
  framing_questions: Array<{
    question: string
    why_asking: string
    expected_answer_shape: string
  }>
  open_questions: string[]
}

// -----------------------------------------------------------------------------
// SYSTEM PROMPT
// -----------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a federal market intelligence analyst working on a Sunstone Recon Brief.

Your job is to analyze ONE artifact at a time and contribute to the convergent understanding of a federal contracting prospect.

THE TRUTH PYRAMID (this is the core doctrinal frame):

  Tier 1 - IDENTITY: Website, marketing materials, public press
    What they say to the world. The identity claim.

  Tier 2 - GROUND TRUTH: USASpending direct awards, USASpending subcontracts, HigherGov
    The federal record. Unmediated truth. What actually happened.

  Tier 3 - POSITIONING: SAM.gov profile, SBA profile, Capability Statement, GSA Schedule contract
    Their federal-facing claims. How they describe themselves to the procurement system.

  Tier 4 - CONTEXT: Interview transcripts, pitch decks, emails, org charts
    Color and nuance. Secondary identity claims.

YOUR ANALYTICAL POSTURE:

- Tier 1 and Tier 4 artifacts contain CLAIMS (what the prospect or their materials assert).
- Tier 2 artifacts contain EVIDENCE (what the federal record shows).
- Tier 3 artifacts may contain BOTH (e.g., SAM profile contains the prospect's NAICS claims AND government's record of registration status).

You extract:
  - CLAIMS from Tier 1, 3, 4 artifacts (verbatim or close-paraphrase, with category)
  - EVIDENCE from Tier 2, 3 artifacts (what the data shows, with category and citation)

You also maintain:
  - Market state read (mature_defined / mature_diffuse / emerging / recently_legislated / novel)
  - Persona read (one of the 9 canonical personas, or a custom string if none fit)
  - Confidence level on each (high / medium / low)
  - Dynamic findings unique to this prospect
  - Open questions that this artifact raised but didn't answer
  - Framing questions for the consultant about how to use this artifact

THE EDITORIAL GOAL:

The eventual brief lives or dies on COGNITIVE DISSONANCE. The brief must surface the gap between what the prospect believes about themselves (claims) and what the federal record actually shows (evidence). This dissonance is the dissonance engine that compels them to act.

When you extract claims, you are setting up future contradiction tests. When you extract evidence, you are running those tests against past claims.

You are NOT writing the brief. You are populating the analytical layer that the brief generator will read.

OUTPUT FORMAT:

Return ONLY a JSON object. No preamble, no markdown, no code fences. Just the JSON.

The JSON schema is exactly:

{
  "summary": "2-3 sentence what this artifact is and what it contributes",
  "detected_tier": 1 | 2 | 3 | 4,
  "detected_tier_reasoning": "Why you classified it this tier",
  "proposed_claims": [
    {
      "claim_text": "Verbatim or close-paraphrase of what the artifact asserts",
      "claim_category": "identity | capability | past_performance | certification | contract_vehicle | partnership | market_position | sales_motion | financial | other",
      "confidence_level": "high | medium | low",
      "is_brief_critical": true | false
    }
  ],
  "proposed_evidence": [
    {
      "evidence_text": "What the federal record shows",
      "evidence_category": "award_history_direct | award_history_subcontract | sam_registration | sba_certification | gsa_schedule | naics_assignment | psc_assignment | agency_relationship | teaming_partner | jv_arrangement | cage_lineage | other",
      "citation_url": "url if available",
      "data_as_of": "YYYY-MM-DD if known"
    }
  ],
  "market_state_read": {
    "read": "mature_defined | mature_diffuse | emerging | recently_legislated | novel | no_change",
    "confidence": "high | medium | low",
    "reasoning": "Why this read, what evidence in the artifact supports it. Use 'no_change' if the artifact doesn't speak to market state."
  },
  "persona_read": {
    "read": "string (one of the 9 canonical or a custom)",
    "confidence": "high | medium | low",
    "reasoning": "What in the artifact informs this read"
  },
  "dynamic_findings": [
    {
      "topic": "Short topic name",
      "finding": "Specific finding unique to this prospect",
      "confidence": "high | medium | low"
    }
  ],
  "framing_questions": [
    {
      "question": "Question for the consultant",
      "why_asking": "Why this matters for the brief",
      "expected_answer_shape": "What kind of answer helps - free text, yes/no, etc."
    }
  ],
  "open_questions": [
    "Question this artifact raised but did not answer"
  ]
}

Empty arrays are fine. If there are no claims, return []. If no evidence, return []. If you can't read a market state from this artifact, set "no_change" with low confidence.

Be specific. Be evidence-grounded. Do not hallucinate. If the artifact is truncated or you can only see part of it, acknowledge that in your reasoning fields.`

// -----------------------------------------------------------------------------
// HELPERS
// -----------------------------------------------------------------------------

function truncate(s: string | null | undefined, max: number): string {
  if (!s) return ''
  if (s.length <= max) return s
  return s.slice(0, max) + '\n\n[... truncated for analysis, full text on file]'
}

function buildArtifactContext(entry: SurfaceEntry): string {
  const parts: string[] = []
  parts.push(`ARTIFACT TITLE: ${entry.title}`)
  parts.push(`ARTIFACT KIND: ${entry.entry_kind}`)
  if (entry.source_label) parts.push(`SOURCE LABEL: ${entry.source_label}`)
  if (entry.source_url) parts.push(`SOURCE URL: ${entry.source_url}`)
  if (entry.tier) parts.push(`USER-SUGGESTED TIER: ${entry.tier} (${entry.tier_label || 'unknown'})`)

  const text = entry.raw_payload?.text || ''
  const userNote = entry.raw_payload?.user_note || ''
  const fileMetadata = entry.raw_payload?.file_metadata

  if (fileMetadata) {
    parts.push(`FILE METADATA: ${JSON.stringify(fileMetadata)}`)
  }

  if (userNote) {
    parts.push(`\nCONSULTANT NOTE ABOUT THIS ARTIFACT:\n${userNote}`)
  }

  if (text) {
    parts.push(`\nARTIFACT CONTENT:\n${truncate(text, MAX_ARTIFACT_TEXT_CHARS)}`)
  } else {
    parts.push(`\nARTIFACT CONTENT: [No extracted text - file may be PDF/DOC pending extraction, or this is a note/fact entry]`)
  }

  return parts.join('\n')
}

function buildProfileContext(profile: StrategicProfile, frame: any): string {
  const parts: string[] = []
  parts.push(`STRATEGIC PROFILE: ${profile.name}`)
  if (profile.description) parts.push(`DESCRIPTION: ${profile.description}`)
  if (profile.positioning) parts.push(`POSITIONING: ${profile.positioning}`)

  if (frame) {
    parts.push(`\nFRAME:`)
    if (frame.purpose) parts.push(`  Purpose: ${frame.purpose}`)
    if (frame.purpose_notes) parts.push(`  Purpose notes: ${frame.purpose_notes}`)
    if (frame.company_size_band) parts.push(`  Sizing: ${frame.company_size_band}`)
    if (frame.engagement_openness) parts.push(`  Engagement: ${frame.engagement_openness}`)
    if (frame.market_state) parts.push(`  Market state (consultant initial read): ${frame.market_state}`)
    if (frame.human_classification) {
      parts.push(`  Consultant classification (free text):\n${frame.human_classification}`)
    }
  }

  const understanding = profile.profile_understanding || {}
  if (understanding.market_state?.current_read) {
    parts.push(`\nCURRENT UNDERSTANDING:`)
    parts.push(`  Market state read so far: ${understanding.market_state.current_read} (${understanding.market_state.confidence})`)
  }
  if (understanding.persona?.current_read) {
    parts.push(`  Persona read so far: ${understanding.persona.current_read} (${understanding.persona.confidence})`)
  }

  return parts.join('\n')
}

function extractJSON(s: string): any {
  // Handle responses that may have markdown fences despite the prompt
  let cleaned = s.trim()
  if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7)
  if (cleaned.startsWith('```')) cleaned = cleaned.slice(3)
  if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3)
  cleaned = cleaned.trim()
  return JSON.parse(cleaned)
}

// -----------------------------------------------------------------------------
// MAIN HANDLER
// -----------------------------------------------------------------------------

export const handler: Handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' }
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  if (!ANTHROPIC_API_KEY) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }) }
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Supabase env not configured' }) }
  }

  let req: AnalysisRequest
  try {
    req = JSON.parse(event.body || '{}')
  } catch {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid JSON body' }) }
  }

  if (!req.entry_id) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'entry_id required' }) }
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    db: { schema: 'v2' },
    auth: { persistSession: false },
  })

  // ---------------------------------------------------------------------------
  // 1. Load the entry
  // ---------------------------------------------------------------------------

  const { data: entry, error: entryError } = await supabase
    .from('surface_research')
    .select('*')
    .eq('id', req.entry_id)
    .single()

  if (entryError || !entry) {
    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Entry not found', detail: entryError?.message }),
    }
  }

  // Mark as analyzing
  await supabase
    .from('surface_research')
    .update({ analysis_status: 'analyzing' })
    .eq('id', req.entry_id)

  // ---------------------------------------------------------------------------
  // 2. Load profile + frame
  // ---------------------------------------------------------------------------

  const [profileResult, frameResult] = await Promise.all([
    supabase.from('strategic_profiles').select('*').eq('id', entry.strategic_profile_id).single(),
    supabase.from('recon_frames').select('*').eq('strategic_profile_id', entry.strategic_profile_id).maybeSingle(),
  ])

  const profile = profileResult.data as StrategicProfile | null
  const frame = frameResult.data

  if (!profile) {
    await supabase
      .from('surface_research')
      .update({ analysis_status: 'error', analysis: { error: 'Strategic profile not found' } })
      .eq('id', req.entry_id)
    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Strategic profile not found' }),
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Build prompt context and call Claude
  // ---------------------------------------------------------------------------

  const artifactContext = buildArtifactContext(entry as SurfaceEntry)
  const profileContext = buildProfileContext(profile, frame)

  const userMessage = `${profileContext}

==========================
ARTIFACT TO ANALYZE:
==========================

${artifactContext}

==========================

Analyze this artifact per the doctrine. Return ONLY the JSON object.`

  const anthropicHeaders = {
    'Content-Type': 'application/json',
    'x-api-key': ANTHROPIC_API_KEY,
    'anthropic-version': ANTHROPIC_VERSION,
  }

  let analysis: ClaudeAnalysis
  let claudeRaw = ''

  try {
    const response = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: anthropicHeaders,
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 8000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      throw new Error(`Claude API error ${response.status}: ${errorBody.slice(0, 500)}`)
    }

    const data = await response.json() as { content?: Array<{ type: string; text?: string }> }
    const textBlock = data.content?.find(b => b.type === 'text')
    if (!textBlock || !textBlock.text) {
      throw new Error('No text block in Claude response')
    }
    claudeRaw = textBlock.text
    analysis = extractJSON(claudeRaw) as ClaudeAnalysis
  } catch (err: any) {
    await supabase
      .from('surface_research')
      .update({
        analysis_status: 'error',
        analysis: { error: err.message, claude_raw: claudeRaw.slice(0, 2000) },
      })
      .eq('id', req.entry_id)
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Claude analysis failed', detail: err.message }),
    }
  }

  // ---------------------------------------------------------------------------
  // 4. Write proposed claims (Tier 1, 3, 4 only)
  // ---------------------------------------------------------------------------

  const claimIds: string[] = []
  const isClaimTier = analysis.detected_tier === 1 || analysis.detected_tier === 3 || analysis.detected_tier === 4

  if (isClaimTier && analysis.proposed_claims?.length > 0) {
    const claimsToInsert = analysis.proposed_claims.map(c => ({
      tenant_id: entry.tenant_id,
      strategic_profile_id: entry.strategic_profile_id,
      source_entry_id: entry.id,
      source_label: entry.source_label || entry.title,
      source_tier: analysis.detected_tier as 1 | 3 | 4,
      claim_text: c.claim_text,
      claim_category: c.claim_category,
      status: 'untested',
      confidence_level: c.confidence_level,
      is_brief_critical: c.is_brief_critical || false,
    }))

    const { data: insertedClaims, error: claimsError } = await supabase
      .from('profile_claims')
      .insert(claimsToInsert)
      .select('id')

    if (claimsError) {
      console.error('Claims insert failed:', claimsError.message)
    } else if (insertedClaims) {
      claimIds.push(...insertedClaims.map(c => c.id))
    }
  }

  // ---------------------------------------------------------------------------
  // 5. Write proposed evidence (Tier 2, 3 only)
  // ---------------------------------------------------------------------------

  const evidenceIds: string[] = []
  const isEvidenceTier = analysis.detected_tier === 2 || analysis.detected_tier === 3

  if (isEvidenceTier && analysis.proposed_evidence?.length > 0) {
    const evidenceToInsert = analysis.proposed_evidence.map(e => ({
      tenant_id: entry.tenant_id,
      strategic_profile_id: entry.strategic_profile_id,
      source_entry_id: entry.id,
      source_label: entry.source_label || entry.title,
      source_tier: analysis.detected_tier as 2 | 3,
      evidence_text: e.evidence_text,
      evidence_category: e.evidence_category,
      citation_url: e.citation_url || null,
      data_as_of: e.data_as_of || null,
      confirms_claim_ids: [],
      contradicts_claim_ids: [],
    }))

    const { data: insertedEvidence, error: evidenceError } = await supabase
      .from('profile_evidence')
      .insert(evidenceToInsert)
      .select('id')

    if (evidenceError) {
      console.error('Evidence insert failed:', evidenceError.message)
    } else if (insertedEvidence) {
      evidenceIds.push(...insertedEvidence.map(e => e.id))
    }
  }

  // ---------------------------------------------------------------------------
  // 6. Update profile_understanding (convergent state)
  // ---------------------------------------------------------------------------

  const currentUnderstanding = profile.profile_understanding || {
    market_state: null,
    persona: null,
    dynamic_findings: [],
    open_questions: [],
  }

  const now = new Date().toISOString()
  const updatedUnderstanding: any = {
    market_state: currentUnderstanding.market_state,
    persona: currentUnderstanding.persona,
    dynamic_findings: [...(currentUnderstanding.dynamic_findings || [])],
    open_questions: [...(currentUnderstanding.open_questions || [])],
  }

  // Update market_state if Claude returned a non-no_change read
  if (analysis.market_state_read && analysis.market_state_read.read !== 'no_change') {
    const prior = currentUnderstanding.market_state
    updatedUnderstanding.market_state = {
      current_read: analysis.market_state_read.read,
      confidence: analysis.market_state_read.confidence,
      reasoning: analysis.market_state_read.reasoning,
      last_updated_at: now,
      after_artifact: entry.id,
      history: [
        ...(prior?.history || []),
        ...(prior?.current_read ? [{
          read: prior.current_read,
          confidence: prior.confidence,
          after_artifact: prior.after_artifact || null,
          at: prior.last_updated_at || prior.created_at || null,
        }] : []),
      ],
    }
  }

  // Update persona
  if (analysis.persona_read?.read) {
    const prior = currentUnderstanding.persona
    updatedUnderstanding.persona = {
      current_read: analysis.persona_read.read,
      confidence: analysis.persona_read.confidence,
      reasoning: analysis.persona_read.reasoning,
      last_updated_at: now,
      after_artifact: entry.id,
      history: [
        ...(prior?.history || []),
        ...(prior?.current_read ? [{
          read: prior.current_read,
          confidence: prior.confidence,
          after_artifact: prior.after_artifact || null,
          at: prior.last_updated_at || null,
        }] : []),
      ],
    }
  }

  // Append dynamic findings
  if (analysis.dynamic_findings?.length > 0) {
    for (const f of analysis.dynamic_findings) {
      updatedUnderstanding.dynamic_findings.push({
        topic: f.topic,
        finding: f.finding,
        confidence: f.confidence,
        after_artifact: entry.id,
        at: now,
      })
    }
  }

  // Append open questions
  if (analysis.open_questions?.length > 0) {
    for (const q of analysis.open_questions) {
      updatedUnderstanding.open_questions.push({
        question: q,
        raised_by_artifact: entry.id,
        raised_at: now,
        answered: false,
        answer_text: null,
      })
    }
  }

  await supabase
    .from('strategic_profiles')
    .update({
      profile_understanding: updatedUnderstanding,
      understanding_updated_at: now,
    })
    .eq('id', profile.id)

  // ---------------------------------------------------------------------------
  // 7. Write the analysis back to the entry, mark awaiting_review
  // ---------------------------------------------------------------------------

  await supabase
    .from('surface_research')
    .update({
      analysis: analysis,
      tier: analysis.detected_tier,
      tier_label: ['identity', 'ground_truth', 'positioning', 'context'][analysis.detected_tier - 1],
      analysis_status: 'awaiting_review',
      analyzed_at: now,
    })
    .eq('id', req.entry_id)

  // ---------------------------------------------------------------------------
  // 8. Return
  // ---------------------------------------------------------------------------

  return {
    statusCode: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ok: true,
      analysis,
      claim_ids: claimIds,
      evidence_ids: evidenceIds,
      tier_detected: analysis.detected_tier,
    }),
  }
}
