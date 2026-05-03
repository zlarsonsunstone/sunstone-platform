// netlify/functions/build-recon-engine-background.mjs
//
// Brief generator — produces the paired Recon Brief + Options deck content.
// Fire-and-forget background function (15min timeout). Frontend polls brief_jobs.
//
// Pipeline (multi-shot per Sunstone Mission Architecture):
//   STAGE 1 — Trajectory milestones    (Claude extracts public-record timeline from CBP)
//   STAGE 2 — Peer Cohort framing      (Claude composes cohort definition + tier interpretation)
//   STAGE 3 — Recon Brief BLUF + posture (Claude writes 1pp diagnostic content)
//   STAGE 4 — Per-Stone narrative      (4 calls, one per Stone, content tied to stones_config)
//   STAGE 5 — "What about..." pairs    (Claude generates pairs from axis_code × market_state)
//   STAGE 6 — Brand resolution + assembly (compose final HTML payloads — text only in 4b)
//   STAGE 7 — Persist to recon_briefs
//
// Each stage writes its output back to brief_jobs.intermediate_outputs so the
// pipeline is resumable/inspectable. If any stage fails, the brief_job records
// the failure point and partial outputs.
//
// In gate 4b we ship text content only. Gate 4c (next phase) wires the SVG
// composers (Trajectory, Peer Cohort, per-Stone) and the HTML→PDF render.
//
// Conventions match build-commercial-profile-background.mjs:
//   - Reads ANTHROPIC_API_KEY from env
//   - Uses _supabase-admin.mjs service-role client
//   - Idempotent on retry (checks brief_job status before re-running)
//   - All log lines prefixed [recon-engine] for grep-ability

import { getSupabaseAdmin } from './_supabase-admin.mjs'

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
const ANTHROPIC_MODEL_DEFAULT = 'claude-sonnet-4-20250514'
const ANTHROPIC_MODEL_FRAME   = 'claude-opus-4-7'   // For non-default frames per memory entry 24
const ANTHROPIC_VERSION       = '2023-06-01'

// =============================================================================
// ENTRY POINT
// =============================================================================

export default async (request) => {
  const body = await request.json().catch(() => ({}))
  const { brief_job_id } = body

  if (!brief_job_id) {
    return new Response(JSON.stringify({ error: 'brief_job_id required' }), { status: 400 })
  }

  // Background functions return 202 immediately — work continues async
  // The frontend polls brief_jobs by id.
  runPipeline(brief_job_id).catch(err => {
    console.error('[recon-engine] pipeline crashed:', err)
  })

  return new Response(JSON.stringify({ accepted: true, brief_job_id }), { status: 202 })
}

// =============================================================================
// PIPELINE ORCHESTRATOR
// =============================================================================

async function runPipeline(brief_job_id) {
  const supabase = getSupabaseAdmin()
  const log = (stage, msg, extra) => console.log(`[recon-engine][${brief_job_id}][${stage}] ${msg}`, extra || '')

  // ---------------------------------------------------------------------------
  // 0. LOAD JOB + PRECONDITIONS
  // ---------------------------------------------------------------------------
  log('init', 'loading brief_job')

  const { data: job, error: jobErr } = await supabase
    .from('brief_jobs')
    .select('*')
    .eq('id', brief_job_id)
    .maybeSingle()

  if (jobErr || !job) {
    log('init', 'brief_job not found', jobErr)
    return
  }

  if (job.status === 'done') {
    log('init', 'brief_job already done — skipping')
    return
  }

  // Mark as running
  await supabase.from('brief_jobs').update({
    status: 'running',
    started_at: new Date().toISOString(),
    intermediate_outputs: {},
  }).eq('id', brief_job_id)

  const { strategic_profile_id, tenant_id } = job

  try {
    // -------------------------------------------------------------------------
    // 0.1 LOAD ALL INPUTS
    // -------------------------------------------------------------------------
    log('load', 'loading inputs')
    const inputs = await loadAllInputs(supabase, strategic_profile_id, tenant_id)

    if (!inputs.frame || !inputs.frame.is_complete) {
      throw new Error('Framing the Frame is incomplete — cannot generate brief')
    }
    if (!inputs.commercial_profile?.synthesized_text) {
      throw new Error('Commercial profile not built — CBP missing')
    }
    if (!inputs.federal_profile?.synthesized_text) {
      throw new Error('Federal profile not built — federal entry framework missing')
    }
    if (!inputs.stones_config) {
      throw new Error('Stones not configured for this strategic profile')
    }

    log('load', `loaded ${inputs.surface_entries.length} surface entries; persona=${inputs.persona?.name || 'none'}; market_state=${inputs.frame.market_state || 'unset'}`)

    // -------------------------------------------------------------------------
    // STAGE 1 — Trajectory milestones
    // -------------------------------------------------------------------------
    log('stage1', 'extracting trajectory milestones')
    const trajectory = await stageTrajectory(inputs, log)
    await persistIntermediate(supabase, brief_job_id, 'trajectory', trajectory)

    // -------------------------------------------------------------------------
    // STAGE 2 — Peer Cohort framing
    // -------------------------------------------------------------------------
    log('stage2', 'composing peer cohort')
    const peerCohort = await stagePeerCohort(inputs, log)
    await persistIntermediate(supabase, brief_job_id, 'peer_cohort', peerCohort)

    // -------------------------------------------------------------------------
    // STAGE 3 — Recon Brief BLUF + posture
    // -------------------------------------------------------------------------
    log('stage3', 'composing Recon Brief BLUF + posture')
    const reconBrief = await stageReconBrief(inputs, trajectory, peerCohort, log)
    await persistIntermediate(supabase, brief_job_id, 'recon_brief', reconBrief)

    // -------------------------------------------------------------------------
    // STAGE 4 — Per-Stone narrative (4 calls, parallelizable)
    // -------------------------------------------------------------------------
    log('stage4', 'composing per-Stone narratives (4 parallel calls)')
    const stones = await stagePerStoneNarratives(inputs, peerCohort, log)
    await persistIntermediate(supabase, brief_job_id, 'stones', stones)

    // -------------------------------------------------------------------------
    // STAGE 5 — "What about..." pairs (axis_code × market_state)
    // -------------------------------------------------------------------------
    log('stage5', 'generating What About pairs')
    const whatAbout = await stageWhatAboutPairs(inputs, log)
    await persistIntermediate(supabase, brief_job_id, 'what_about', whatAbout)

    // -------------------------------------------------------------------------
    // STAGE 6 — Brand resolution + final assembly
    // -------------------------------------------------------------------------
    log('stage6', 'assembling final payload')
    const brand = await loadBrandProfile(supabase, strategic_profile_id, tenant_id)

    const finalPayload = {
      version: 1,
      generated_at: new Date().toISOString(),
      brand,
      recon_brief: {
        ...reconBrief,
        trajectory,
        peer_cohort: peerCohort,
      },
      options_deck: {
        cover: {
          title: 'Options for Federal Engagement',
          prospect_name: inputs.commercial_profile?.legal_name || 'Prospect',
        },
        trajectory,
        peer_cohort: peerCohort,
        stones,        // 4-stone array
        what_about: whatAbout,
      },
    }

    // -------------------------------------------------------------------------
    // STAGE 7 — Persist to recon_briefs
    // -------------------------------------------------------------------------
    log('stage7', 'writing recon_briefs row')

    // Find the next version number for this strategic profile
    const { data: existingBriefs } = await supabase
      .from('recon_briefs')
      .select('version')
      .eq('strategic_profile_id', strategic_profile_id)
      .order('version', { ascending: false })
      .limit(1)
    const nextVersion = (existingBriefs?.[0]?.version || 0) + 1

    // Try to look up the conditional profile that was used (if any)
    const axisCode = inputs.frame.axis_code
    const marketState = inputs.frame.market_state
    let conditionalProfileId = null
    let conditionalProfileVersion = null
    if (axisCode && marketState) {
      const { data: condProf } = await supabase
        .rpc('lookup_conditional_profile', { p_axis_code: axisCode, p_market_state: marketState })
      if (condProf) {
        conditionalProfileId = condProf.id
        conditionalProfileVersion = condProf.version
      }
    }

    const { data: brief, error: briefErr } = await supabase
      .from('recon_briefs')
      .insert({
        tenant_id,
        strategic_profile_id,
        version: nextVersion,
        is_current: true,
        rendered_payload: finalPayload,
        input_snapshot: {
          frame: inputs.frame,
          stones_config: inputs.stones_config,
          surface_entry_count: inputs.surface_entries.length,
          sufficiency_score: inputs.sufficiency_score,
        },
        axis_code_used: axisCode,
        market_state_used: marketState,
        conditional_profile_id: conditionalProfileId,
        conditional_profile_version: conditionalProfileVersion,
      })
      .select()
      .single()

    if (briefErr) throw new Error(`recon_briefs insert failed: ${briefErr.message}`)

    // Mark all earlier briefs for this profile as not-current
    await supabase
      .from('recon_briefs')
      .update({ is_current: false })
      .eq('strategic_profile_id', strategic_profile_id)
      .neq('id', brief.id)

    // -------------------------------------------------------------------------
    // DONE
    // -------------------------------------------------------------------------
    await supabase.from('brief_jobs').update({
      status: 'done',
      completed_at: new Date().toISOString(),
      result: { brief_id: brief.id, version: nextVersion },
    }).eq('id', brief_job_id)

    log('done', `brief generated successfully — brief_id=${brief.id}, version=${nextVersion}`)

  } catch (err) {
    console.error(`[recon-engine][${brief_job_id}] FAILED:`, err)
    await supabase.from('brief_jobs').update({
      status: 'error',
      completed_at: new Date().toISOString(),
      error: String(err?.message || err),
    }).eq('id', brief_job_id)
  }
}

// =============================================================================
// INPUT LOADERS
// =============================================================================

async function loadAllInputs(supabase, strategicProfileId, tenantId) {
  const [
    profileRes,
    cbpRes,
    fpRes,
    frameRes,
    surfaceRes,
    suffRes,
    stonesRes,
  ] = await Promise.all([
    supabase.from('strategic_profiles').select('*').eq('id', strategicProfileId).maybeSingle(),
    supabase.from('commercial_profile').select('*').eq('tenant_id', tenantId).maybeSingle(),
    supabase.from('federal_profile').select('*').eq('tenant_id', tenantId).maybeSingle(),
    supabase.from('recon_frames').select('*').eq('strategic_profile_id', strategicProfileId).maybeSingle(),
    supabase.from('surface_research').select('*').eq('strategic_profile_id', strategicProfileId).order('created_at', { ascending: false }),
    supabase.from('sufficiency_scores').select('*').eq('strategic_profile_id', strategicProfileId).order('computed_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('stones_config').select('*').eq('strategic_profile_id', strategicProfileId).maybeSingle(),
  ])

  // Load persona separately if frame has one
  let persona = null
  if (frameRes.data?.persona_id) {
    const { data } = await supabase
      .from('recon_personas')
      .select('*')
      .eq('id', frameRes.data.persona_id)
      .maybeSingle()
    persona = data
  }

  return {
    strategic_profile: profileRes.data,
    commercial_profile: cbpRes.data,
    federal_profile: fpRes.data,
    frame: frameRes.data,
    surface_entries: surfaceRes.data || [],
    sufficiency_score: suffRes.data,
    stones_config: stonesRes.data,
    persona,
  }
}

async function loadBrandProfile(supabase, strategicProfileId, tenantId) {
  // Try strategic-profile-specific brand first; fall back to tenant default
  const { data: brand } = await supabase
    .from('brand_profiles')
    .select('*')
    .eq('strategic_profile_id', strategicProfileId)
    .maybeSingle()

  if (brand) return brand

  // Sunstone canonical default if no per-profile brand
  return {
    recon_firm_name: 'Sunstone Advisory Group',
    recon_firm_short: 'SUNSTONE',
    recon_firm_doc_id_prefix: 'SUN',
    lobby_firm_name: 'Steptoe LLP',
    lobby_firm_short: 'STEPTOE',
    palette_cocoa: '#2A2622',
    palette_orange: '#F0A742',
    palette_cream: '#F5F4EF',
    palette_burgundy: '#9B3838',
    prepared_by_text: 'Sunstone Advisory Group',
  }
}

async function persistIntermediate(supabase, briefJobId, stageKey, output) {
  // Append to intermediate_outputs JSONB blob
  const { data: job } = await supabase
    .from('brief_jobs')
    .select('intermediate_outputs')
    .eq('id', briefJobId)
    .maybeSingle()
  const existing = job?.intermediate_outputs || {}
  await supabase.from('brief_jobs').update({
    intermediate_outputs: { ...existing, [stageKey]: output },
  }).eq('id', briefJobId)
}

// =============================================================================
// STAGE 1 — TRAJECTORY MILESTONES
// =============================================================================

async function stageTrajectory(inputs, log) {
  const cbp = inputs.commercial_profile
  const fp = inputs.federal_profile
  const surfaceText = inputs.surface_entries
    .filter(e => e.signal_dimensions?.includes('trajectory'))
    .map(e => `${e.title}: ${JSON.stringify(e.raw_payload).slice(0, 1000)}`)
    .join('\n\n')

  const systemPrompt = `You are a federal contracting analyst extracting public-record milestones for a prospect's Trajectory page.

OUTPUT a JSON object with this exact shape:
{
  "headline": "<one-sentence scoreboard summary, e.g., '5 milestones up. 2 down. Zero awards in 5 years.'>",
  "milestones": [
    { "date": "YYYY-MM", "label": "<concise milestone>", "valence": "positive|negative|neutral" }
  ],
  "tiles": [
    { "label": "<short tile name>", "value": "<value>", "source": "<source>" }
  ],
  "window_start": "YYYY-MM",
  "window_end": "YYYY-MM"
}

DOCTRINE:
- Public-record only. No prospect-derived statements.
- Adapt to what's actually true. If the prospect has no SAM registration, no GSA, no certifications — that IS the trajectory. The page reflects whatever the public record shows.
- Most prospects will NOT have a clean five-milestone narrative. Render whatever's actually there.
- 3-7 milestones. 3-5 supporting tiles.
- Valence: positive = entity formed, registration achieved, schedule awarded, certification obtained, contract won. Negative = schedule canceled, SAM expired, contract lost. Neutral = filings, name changes, scope clarifications.

Return ONLY the JSON object. No prose, no markdown, no explanation.`

  const userPrompt = `COMMERCIAL PROFILE:
${cbp?.synthesized_text || '(none)'}

FEDERAL PROFILE:
${fp?.synthesized_text || '(none)'}

SURFACE RESEARCH (trajectory-tagged):
${surfaceText || '(none)'}

Generate the Trajectory JSON for this prospect.`

  return await callAnthropicJSON(systemPrompt, userPrompt, ANTHROPIC_MODEL_DEFAULT, log)
}

// =============================================================================
// STAGE 2 — PEER COHORT
// =============================================================================

async function stagePeerCohort(inputs, log) {
  const cbp = inputs.commercial_profile
  const fp = inputs.federal_profile
  const surfaceText = inputs.surface_entries
    .filter(e => e.signal_dimensions?.includes('peer_cohort'))
    .map(e => `${e.title}: ${JSON.stringify(e.raw_payload).slice(0, 1500)}`)
    .join('\n\n')

  const systemPrompt = `You are a federal market analyst composing the Peer Cohort page.

OUTPUT a JSON object with this exact shape:
{
  "cohort_definition": {
    "criteria": "<one-sentence cohort definition, e.g., 'Same primary NAICS, same SAM-registration year, same business size'>",
    "fy_window": "<e.g., 'FY24–FY26'>",
    "rationale": "<why this cohort definition fits this prospect's situation>"
  },
  "tiers": [
    {
      "tier_label": "Tier 1",
      "firm_count": <int>,
      "pct_of_cohort": <float 0-100>,
      "avg_per_firm": <numeric or null>,
      "dollar_range": "<e.g., '$0' or '$1M-$5M'>",
      "tier_description": "<one-line description, e.g., 'Zero federal awards'>"
    }
    /* exactly 4 tiers */
  ],
  "prospect_tier": <int 1-4>,
  "prospect_uei": "<UEI if known>",
  "headline": "<one-sentence scoreboard, e.g., '94% of the cohort received zero federal awards.'>",
  "body_paragraph": "<2-3 sentences interpreting where the prospect sits and why>"
}

DOCTRINE:
- Cohort definition flexes per prospect:
  - SAM-registered with NAICS history → same-NAICS, same-registration-year, same-size
  - SAM-registered no NAICS history → same-state, same-size, recent registrants
  - State-active not federal → state-to-federal transition cohort (5yr lookback)
  - Brand new no federal context → first-year SAM registrants in same NAICS
  - GSA holder no sales → same-schedule, same-SIN
  - Cert holder no sales → same-certification, same-size
  - No federal context at all → 5yr lookback against any business that could be a peer
- Four-tier quartile structure is universal. What defines the cohort is per-prospect.
- Prospect tier placement is honest. If they're Tier 1 (bottom), say so. If Tier 4, say so.
- Volatility lives on the prospect side. Sunstone makes no assumptions. The cohort math IS the math.

Return ONLY the JSON object.`

  const userPrompt = `COMMERCIAL PROFILE:
${cbp?.synthesized_text || '(none)'}

FEDERAL PROFILE:
${fp?.synthesized_text || '(none)'}

PERSONA: ${inputs.persona?.name || 'unset'}
MARKET STATE: ${inputs.frame?.market_state || 'unset'}

SURFACE RESEARCH (peer_cohort-tagged):
${surfaceText || '(none)'}

Generate the Peer Cohort JSON.`

  return await callAnthropicJSON(systemPrompt, userPrompt, ANTHROPIC_MODEL_DEFAULT, log)
}

// =============================================================================
// STAGE 3 — RECON BRIEF BLUF + POSTURE
// =============================================================================

async function stageReconBrief(inputs, trajectory, peerCohort, log) {
  const cbp = inputs.commercial_profile
  const fp = inputs.federal_profile
  const persona = inputs.persona
  const frame = inputs.frame

  const systemPrompt = `You are composing the 1-page Recon Brief — Sunstone's public-record diagnostic artifact.

OUTPUT a JSON object with this exact shape:
{
  "title_line_1": "Your Story, Based on",
  "title_line_2": "Publicly Available Federal Data.",
  "identifier_line": "<Legal Name · UEI · CAGE · State · Ownership>",
  "section_eyebrow": "FEDERAL MARKET POSITION · PUBLIC-RECORD BRIEF",
  "bluf": {
    "headline": "<one-line declarative diagnosis, e.g., 'Sub-prime plateau is structural, not effort-based.'>",
    "body": "<2-3 sentences explaining the diagnosis with key facts emphasized>"
  },
  "posture_tiles": [
    { "eyebrow": "<short label>", "value": "<current value>", "source": "<source citation>" }
    /* 6 tiles in a 2x3 grid */
  ],
  "cohort_paragraph": "<2-3 sentence prose interpretation of the peer cohort context, with the dominant statistic bolded inline>",
  "closing_question": {
    "headline": "<the question on the table — short, declarative>",
    "body": "<1-2 sentences pointing to the Options companion deck>"
  },
  "footer_disclaimer": "All claims sourced to public records · No prospect-derived statements"
}

DOCTRINE — RECON BRIEF V2 CANON:
- Public-record only. Zero prospect-derived statements.
- BLUF: dark-blue background, declarative, supports the brief's central diagnosis.
- 6 posture tiles: each has eyebrow / value / source citation. Tiles answer the structural question "where does this prospect sit right now?"
- Cohort paragraph: ONE statistic emphasized, the rest is prose context.
- Closing question: orange-bordered close box. Opens the Options deck conversation.
- Footer: universal disclaimer.
- No "What about..." pairs in the Recon Brief — those live in the Options deck.

Persona-driven posture: ${persona?.name || 'unset'} prospects need ${persona ? '<persona-specific tone>' : '<neutral analytical tone>'}.
Market state: ${frame?.market_state || 'unset'}.

Volatility lives on the prospect side. The brief presents what the public record shows. Sunstone makes no projections.

Return ONLY the JSON object.`

  const userPrompt = `COMMERCIAL PROFILE:
${cbp?.synthesized_text || '(none)'}

FEDERAL PROFILE:
${fp?.synthesized_text || '(none)'}

ZACK'S CLASSIFICATION CALL (drives tone, evidence emphasis, BLUF angle):
${frame?.human_classification || '(no classification provided — render with neutral persona-default tone)'}

FRAME PURPOSE: ${frame?.purpose || 'unset'}
FRAME PURPOSE NOTES: ${frame?.purpose_notes || '(none)'}
FRAME COMPANY SIZE: ${frame?.company_size_band || 'unset'}
FRAME RECEPTIVITY NOTES: ${frame?.receptivity_notes || '(none)'}
FRAME ENGAGEMENT OPENNESS: ${frame?.engagement_openness || 'unset'}
FRAME ENGAGEMENT NOTES: ${frame?.engagement_notes || '(none)'}

PERSONA: ${persona?.name || 'unset'}
PERSONA DESCRIPTION: ${persona?.description || ''}
PERSONA NARRATIVE IMPLICATIONS: ${JSON.stringify(persona?.narrative_implications || {}).slice(0, 1500)}

MARKET STATE: ${frame?.market_state || 'unset'}

TRAJECTORY (from stage 1):
${JSON.stringify(trajectory).slice(0, 2000)}

PEER COHORT (from stage 2):
${JSON.stringify(peerCohort).slice(0, 2000)}

Generate the Recon Brief JSON.`

  // Use Opus for non-default frames — they require sharper editorial judgment
  const useOpus = frame?.purpose === 'convince' || frame?.purpose === 'show_market_state'
  const model = useOpus ? ANTHROPIC_MODEL_FRAME : ANTHROPIC_MODEL_DEFAULT
  return await callAnthropicJSON(systemPrompt, userPrompt, model, log)
}

// =============================================================================
// STAGE 4 — PER-STONE NARRATIVE (parallel)
// =============================================================================

async function stagePerStoneNarratives(inputs, peerCohort, log) {
  const stonesConfig = inputs.stones_config?.stones_state || {}
  const persona = inputs.persona
  const frame = inputs.frame

  // Generate one narrative per Stone (1-4) in parallel
  const promises = [1, 2, 3, 4].map(stoneNum =>
    stagePerStone(stoneNum, stonesConfig, peerCohort, persona, frame, log)
  )
  const results = await Promise.all(promises)
  return results
}

async function stagePerStone(stoneNum, stonesConfig, peerCohort, persona, frame, log) {
  const stoneState = stonesConfig?.[`stone_${stoneNum}`] || stonesConfig?.[stoneNum] || {}

  const systemPrompt = `You are composing the per-Stone narrative for Stone ${stoneNum} of the Options for Federal Engagement deck.

The 4 Stones doctrine:
- Stone 01: Sunstone enters. Better odds on the 2 open slices + access 1-2 reserved slices.
- Stone 02: Steptoe activates. Changes HOW slices are sliced — bigger slices.
- Stone 03: Steptoe expands. Grows the pie + biggest slices.
- Stone 04: Full ecosystem. Creates new pies others don't know exist + decides who gets slices.

OUTPUT a JSON object with this exact shape:
{
  "stone_number": ${stoneNum},
  "title": "<short stone title>",
  "meta_strip": {
    "owner": "<Sunstone or Steptoe-led label>",
    "horizon": "<e.g., '0-18 months', '18-36 months'>",
    "active_lanes": ["<lane name>", ...],
    "empirical_anchor": "<peer-cohort outcome anchor for this tier>"
  },
  "narrative": "<3-5 sentences explaining what Stone ${stoneNum} does, what changes, what the prospect actually gets>",
  "stones_map_summary": "<short callout describing what the Stones Map visualization will show for this stone>",
  "cumulative_table_caption": "<short caption framing the cumulative table>"
}

DOCTRINE:
- Pie metaphor: Stone ${stoneNum} represents a specific level of intervention in the market structure.
- No assumptions: anchored to peer cohort outcomes (peer_cohort empirical anchor) for tiers 1-3; tier 4 is extrapolated and labeled as such.
- No specific dollar amounts in narrative. The cumulative table will hold those.
- Volatility lives on prospect side. We get them in the room. They convince.
- Use terms not numbers ("meaningful share", "real federal dollars") — render-time fills in specific numbers from stones_config.

Return ONLY the JSON object.`

  const userPrompt = `STONE ${stoneNum} CONFIG (from stones_config.stones_state):
${JSON.stringify(stoneState).slice(0, 2000)}

PERSONA: ${persona?.name || 'unset'}
ZACK'S CLASSIFICATION: ${frame?.human_classification || '(none)'}
MARKET STATE: ${frame?.market_state || 'unset'}

PEER COHORT EMPIRICAL ANCHORS:
${JSON.stringify(peerCohort).slice(0, 1500)}

Generate the Stone ${stoneNum} narrative JSON.`

  return await callAnthropicJSON(systemPrompt, userPrompt, ANTHROPIC_MODEL_DEFAULT, log)
}

// =============================================================================
// STAGE 5 — "WHAT ABOUT..." PAIRS
// =============================================================================

async function stageWhatAboutPairs(inputs, log) {
  const persona = inputs.persona
  const frame = inputs.frame
  const cbp = inputs.commercial_profile
  const surfaceFacts = inputs.surface_entries
    .map(e => `[${e.entry_kind}] ${e.title}: ${JSON.stringify(e.raw_payload).slice(0, 800)}`)
    .join('\n')
    .slice(0, 8000)

  const systemPrompt = `You are composing the "What about..." page for the Options deck.

This page lives in the Options deck (NOT the Recon Brief). It addresses the prospect's decision-level questions head-on with three columns: "What about..." / "What's actually true" / "The implication".

OUTPUT a JSON object with this exact shape:
{
  "page_eyebrow": "WHAT ABOUT...",
  "page_headline": "<short headline framing the section, e.g., 'The questions worth asking.'>",
  "pairs": [
    {
      "what_about": "<prospect's actual internal monologue — 1 sentence in their voice>",
      "whats_actually_true": "<validates the legitimate concern before turning — 1-2 sentences>",
      "the_implication": "<analytical voice, no WIFM language — 2-3 sentences with prospect-specific data substituted from CBP and Surface Research>"
    }
    /* 4-6 pairs, persona-tuned */
  ]
}

CRITICAL DOCTRINE — VOCABULARY DISCIPLINE:
- Col 1 ("What about...") MUST match the buying behavior of someone in this persona's actual state. NOT vendor-side anxiety. NOT questions a vendor wants asked. Questions this prospect would actually ask themselves.
- Col 2 ("What's actually true") validates the legitimate concern before turning. Names what's real about the worry.
- Col 3 ("The implication") is analytical voice. NO WIFM ("what's in it for you"). Reader generates their own WIFM. Use prospect-specific data.
- Use terms not numbers in default content. Specific numbers from CBP/Surface Research where available.

PERSONA-SPECIFIC CONTENT (from memory entry 23):
- Brand New: questions about entry vehicles, learning curve, capability vs. past performance
- Registered but Unsuccessful: capability-first reframing, NOT "your certs aren't working"
- Successful Hungry for More: HOW / at what cost / vs. alternatives / vs. building internally
- Successful Skeptical: decision-level only, three-question framework, evidence-not-testimonial
- Successful Know-it-All: mirror posture (their own pursuit math vs. parallel sole-source landscape)
- State-to-Federal: what translates / what doesn't / transition cohort outcomes
- GSA Holder No Sales: schedule-as-listing-not-selling, eBuy/SIN expansion
- Cert Holder No Sales: capability-first, not collectibles-first
- Sub-to-Prime: graduation pathway, FAR 19.7, past performance reconstruction

NEVER: "Objection", "Why you're right", WIFM, "Defensibility" (use "Why this combination, specifically").

NEVER include questions that belong in Recon Funnel intake (history-with-vendors, "tell me more"). Brief-page questions are decision-level only.

Return ONLY the JSON object.`

  const userPrompt = `PERSONA: ${persona?.name || 'unset'}
PERSONA DESCRIPTION: ${persona?.description || ''}
PERSONA NARRATIVE IMPLICATIONS: ${JSON.stringify(persona?.narrative_implications || {}).slice(0, 2000)}

ZACK'S CLASSIFICATION CALL (specific approach for this prospect):
${frame?.human_classification || '(none — use persona defaults)'}

MARKET STATE: ${frame?.market_state || 'unset'}
AXIS CODE: ${frame?.axis_code || 'unset'}

PROSPECT FACTS (from CBP):
${cbp?.synthesized_text?.slice(0, 3000) || '(none)'}

SURFACE RESEARCH (for prospect-specific data substitution):
${surfaceFacts || '(none)'}

Generate the "What about..." pairs JSON.`

  // Always use Opus for What About — vocabulary discipline is sharpest editorial test
  return await callAnthropicJSON(systemPrompt, userPrompt, ANTHROPIC_MODEL_FRAME, log)
}

// =============================================================================
// ANTHROPIC CALL HELPER
// =============================================================================

async function callAnthropicJSON(systemPrompt, userPrompt, model, log) {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set in env')

  const startedAt = Date.now()
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model,
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`Anthropic API ${response.status}: ${errText.slice(0, 500)}`)
  }

  const data = await response.json()
  const elapsed = Date.now() - startedAt
  log?.('anthropic', `model=${model} elapsed=${elapsed}ms`)

  // Extract text content (handle multi-block responses)
  const textBlocks = (data.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')

  // Strip code fences if present, then parse
  const cleaned = textBlocks
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```\s*$/m, '')
    .trim()

  try {
    return JSON.parse(cleaned)
  } catch (e) {
    log?.('anthropic', 'JSON parse failed; returning raw text', cleaned.slice(0, 200))
    throw new Error(`Failed to parse Anthropic JSON response: ${e.message}. Raw: ${cleaned.slice(0, 300)}`)
  }
}

// Required for Netlify scheduled/background functions
export const config = { type: 'experimental-background' }
