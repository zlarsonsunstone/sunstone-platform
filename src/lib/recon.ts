/**
 * Recon Engine — shared types and Supabase helpers
 *
 * Used by Framing the Frame intake modal, Surface Research workspace, and
 * the Generate Brief gating logic on the Strategic Profile card.
 *
 * All tables live in v2 schema; supabase client is already schema-scoped.
 */

import { supabase } from '@/lib/supabase'

// =============================================================================
// PERSONA
// =============================================================================
export interface ReconPersona {
  id: string
  slug: string
  name: string
  description: string
  narrative_implications: {
    tone?: string
    evidence_emphasis?: string
    bluf_posture?: string
    feature?: string
    background?: string
  }
  what_about_pairs: Array<{
    question: string
    whats_true: string
    implication: string
  }>
  closing_framing: {
    cta_voicing?: string
    urgency_lever?: string
    decision_type?: string
  }
  is_seeded: boolean
  display_order: number
}

export async function loadPersonas(): Promise<ReconPersona[]> {
  const { data, error } = await supabase
    .from('recon_personas')
    .select('*')
    .is('deleted_at', null)
    .order('display_order', { ascending: true })
  if (error) {
    console.error('Failed to load personas:', error)
    return []
  }
  return (data || []) as ReconPersona[]
}

export async function addCustomPersona(
  name: string,
  description: string,
): Promise<ReconPersona | null> {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 60)
    + '_' + Math.random().toString(36).slice(2, 6)

  const { data, error } = await supabase
    .from('recon_personas')
    .insert({
      slug,
      name,
      description,
      is_seeded: false,
      display_order: 999,
    })
    .select('*')
    .single()
  if (error) {
    console.error('Failed to add custom persona:', error)
    return null
  }
  return data as ReconPersona
}

// =============================================================================
// FRAME — Framing the Frame intake state
// =============================================================================
export type FramePurpose = 'educate' | 'convince' | 'show_market_demand' | 'show_market_state'
export type FrameCompanySize = '<1M' | '1M-10M' | '10M-50M' | '50M-250M' | '250M+'
export type FrameEngagementOpenness = 'sun_only' | 'sun_step_full' | 'undecided'

export interface ReconFrame {
  id: string
  tenant_id: string
  strategic_profile_id: string
  purpose: FramePurpose | null
  purpose_notes: string | null
  company_size_band: FrameCompanySize | null
  receptivity_notes: string | null
  engagement_openness: FrameEngagementOpenness | null
  engagement_notes: string | null
  persona_id: string | null
  persona_overrides: Record<string, any>
  is_complete: boolean
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface FramePatch {
  purpose?: FramePurpose | null
  purpose_notes?: string | null
  company_size_band?: FrameCompanySize | null
  receptivity_notes?: string | null
  engagement_openness?: FrameEngagementOpenness | null
  engagement_notes?: string | null
  persona_id?: string | null
  persona_overrides?: Record<string, any>
}

export async function loadFrame(
  strategicProfileId: string,
): Promise<ReconFrame | null> {
  const { data, error } = await supabase
    .from('recon_frames')
    .select('*')
    .eq('strategic_profile_id', strategicProfileId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error && error.code !== 'PGRST116') {
    console.error('Failed to load frame:', error)
    return null
  }
  return (data || null) as ReconFrame | null
}

export async function upsertFrame(
  tenantId: string,
  strategicProfileId: string,
  patch: FramePatch,
): Promise<ReconFrame | null> {
  // Compute is_complete from the patch + existing state.
  const existing = await loadFrame(strategicProfileId)
  const merged = { ...(existing || {}), ...patch } as Partial<ReconFrame>
  const isComplete = !!(
    merged.purpose &&
    merged.company_size_band &&
    merged.engagement_openness &&
    merged.persona_id
  )

  const row: any = {
    tenant_id: tenantId,
    strategic_profile_id: strategicProfileId,
    ...patch,
    is_complete: isComplete,
    completed_at: isComplete && !existing?.completed_at
      ? new Date().toISOString()
      : existing?.completed_at,
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from('recon_frames')
    .upsert(row, { onConflict: 'strategic_profile_id' })
    .select('*')
    .single()
  if (error) {
    console.error('Failed to upsert frame:', error)
    return null
  }
  return data as ReconFrame
}

// =============================================================================
// SURFACE RESEARCH — corpus entries
// =============================================================================
export type SurfaceEntryKind =
  | 'highergov_pull'
  | 'usaspending_pull'
  | 'paste_in'
  | 'file_upload'
  | 'note'
  | 'fact'

export type SignalDimension =
  | 'market_sizing'
  | 'peer_cohort'
  | 'vehicle_landscape'
  | 'agency_map'
  | 'doppelganger'
  | 'trajectory'

export interface SurfaceEntry {
  id: string
  tenant_id: string
  strategic_profile_id: string
  entry_kind: SurfaceEntryKind
  title: string
  source_label: string | null
  source_url: string | null
  query_meta: Record<string, any>
  raw_payload: Record<string, any>
  extracted_facts: Array<{
    dimension: SignalDimension
    claim: string
    value?: number | string
    confidence?: number
  }>
  signal_dimensions: SignalDimension[]
  added_by: string | null
  created_at: string
  updated_at: string
}

export async function loadSurfaceEntries(
  strategicProfileId: string,
): Promise<SurfaceEntry[]> {
  const { data, error } = await supabase
    .from('surface_research')
    .select('*')
    .eq('strategic_profile_id', strategicProfileId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
  if (error) {
    console.error('Failed to load surface entries:', error)
    return []
  }
  return (data || []) as SurfaceEntry[]
}

export async function addSurfaceEntry(
  tenantId: string,
  strategicProfileId: string,
  entry: Partial<SurfaceEntry> & { title: string; entry_kind: SurfaceEntryKind },
): Promise<SurfaceEntry | null> {
  const { data, error } = await supabase
    .from('surface_research')
    .insert({
      tenant_id: tenantId,
      strategic_profile_id: strategicProfileId,
      title: entry.title,
      entry_kind: entry.entry_kind,
      source_label: entry.source_label || null,
      source_url: entry.source_url || null,
      query_meta: entry.query_meta || {},
      raw_payload: entry.raw_payload || {},
      extracted_facts: entry.extracted_facts || [],
      signal_dimensions: entry.signal_dimensions || [],
    })
    .select('*')
    .single()
  if (error) {
    console.error('Failed to add surface entry:', error)
    return null
  }
  return data as SurfaceEntry
}

export async function deleteSurfaceEntry(entryId: string): Promise<boolean> {
  const { error } = await supabase
    .from('surface_research')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', entryId)
  if (error) {
    console.error('Failed to delete surface entry:', error)
    return false
  }
  return true
}

// =============================================================================
// SUFFICIENCY SCORES
// =============================================================================
export interface SufficiencyScore {
  id: string
  tenant_id: string
  strategic_profile_id: string
  market_sizing_score: number
  peer_cohort_score: number
  vehicle_landscape_score: number
  agency_map_score: number
  doppelganger_score: number
  trajectory_score: number
  total_score: number
  required_score: number
  is_sufficient: boolean
  what_is_thin: string | null
  recommended_actions: Array<{
    action: string
    rationale: string
    dimension: SignalDimension
  }>
  computed_against_corpus_count: number
  computed_against_frame_hash: string | null
  last_computed_at: string
  created_at: string
  updated_at: string
}

export async function loadSufficiencyScore(
  strategicProfileId: string,
): Promise<SufficiencyScore | null> {
  const { data, error } = await supabase
    .from('sufficiency_scores')
    .select('*')
    .eq('strategic_profile_id', strategicProfileId)
    .maybeSingle()
  if (error && error.code !== 'PGRST116') {
    console.error('Failed to load sufficiency score:', error)
    return null
  }
  return (data || null) as SufficiencyScore | null
}

/**
 * Compute the sufficiency score heuristically from the corpus.
 * Heuristic dimensions: 0-3 each based on corpus presence.
 *
 * The LLM commentary layer (what_is_thin / recommended_actions) is computed
 * by a Netlify function in gate 4b. For gate 4a, sufficiency is heuristic-only
 * — gives the consultant a number, doesn't yet give them prose guidance.
 */
export async function computeAndSaveSufficiency(
  tenantId: string,
  strategicProfileId: string,
  frame: ReconFrame | null,
  entries: SurfaceEntry[],
): Promise<SufficiencyScore | null> {
  // Tally signal dimension coverage across entries.
  const dimensionCounts: Record<SignalDimension, number> = {
    market_sizing: 0,
    peer_cohort: 0,
    vehicle_landscape: 0,
    agency_map: 0,
    doppelganger: 0,
    trajectory: 0,
  }
  let totalFacts = 0
  for (const e of entries) {
    for (const dim of e.signal_dimensions) {
      dimensionCounts[dim] = (dimensionCounts[dim] || 0) + 1
    }
    totalFacts += e.extracted_facts.length
  }

  // Heuristic: 0 entries → 0; 1 entry → 1; 2-3 entries → 2; 4+ → 3
  const scoreFor = (count: number): number => {
    if (count === 0) return 0
    if (count === 1) return 1
    if (count <= 3) return 2
    return 3
  }

  const market_sizing_score     = scoreFor(dimensionCounts.market_sizing)
  const peer_cohort_score       = scoreFor(dimensionCounts.peer_cohort)
  const vehicle_landscape_score = scoreFor(dimensionCounts.vehicle_landscape)
  const agency_map_score        = scoreFor(dimensionCounts.agency_map)
  const doppelganger_score      = scoreFor(dimensionCounts.doppelganger)
  const trajectory_score        = scoreFor(dimensionCounts.trajectory)

  const total_score =
    market_sizing_score +
    peer_cohort_score +
    vehicle_landscape_score +
    agency_map_score +
    doppelganger_score +
    trajectory_score

  // Required score adjusts by Frame:
  //   - Successful Skeptical / Know-it-All: +3 (need stronger evidence)
  //   - Brand New: -2 (lower bar; brief is more educational)
  //   - default: 12
  let required_score = 12
  if (frame?.persona_id) {
    // We don't load the persona slug here without an extra query;
    // the UI can refine this with persona context. Use defaults for now.
  }

  const is_sufficient = total_score >= required_score

  const frameHash = frame
    ? `${frame.purpose}|${frame.company_size_band}|${frame.engagement_openness}|${frame.persona_id}`
    : 'no-frame'

  const row: any = {
    tenant_id: tenantId,
    strategic_profile_id: strategicProfileId,
    market_sizing_score,
    peer_cohort_score,
    vehicle_landscape_score,
    agency_map_score,
    doppelganger_score,
    trajectory_score,
    total_score,
    required_score,
    is_sufficient,
    what_is_thin: null,        // populated by LLM in gate 4b
    recommended_actions: [],   // populated by LLM in gate 4b
    computed_against_corpus_count: entries.length,
    computed_against_frame_hash: frameHash,
    last_computed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from('sufficiency_scores')
    .upsert(row, { onConflict: 'strategic_profile_id' })
    .select('*')
    .single()
  if (error) {
    console.error('Failed to save sufficiency score:', error)
    return null
  }
  return data as SufficiencyScore
}

// =============================================================================
// READINESS — overall state of the Generate Brief gate
// =============================================================================
export interface ReadinessState {
  cbp_ready: boolean        // commercial_profile + federal_profile both built
  frame_ready: boolean      // recon_frames.is_complete
  research_ready: boolean   // sufficiency_scores.is_sufficient
  stones_ready: boolean     // stones_config has at least Stone 1 active
  generate_ready: boolean   // all four above
}

export async function loadReadiness(
  strategicProfileId: string,
  cbpReady: boolean,
): Promise<ReadinessState> {
  // Frame
  const { data: frame } = await supabase
    .from('recon_frames')
    .select('is_complete')
    .eq('strategic_profile_id', strategicProfileId)
    .is('deleted_at', null)
    .maybeSingle()
  const frame_ready = !!frame?.is_complete

  // Research
  const { data: score } = await supabase
    .from('sufficiency_scores')
    .select('is_sufficient')
    .eq('strategic_profile_id', strategicProfileId)
    .maybeSingle()
  const research_ready = !!score?.is_sufficient

  // Stones
  const { data: stones } = await supabase
    .from('stones_config')
    .select('stones_state')
    .eq('strategic_profile_id', strategicProfileId)
    .maybeSingle()
  const stonesState = stones?.stones_state as any
  const stones_ready = !!(
    stonesState &&
    stonesState.stones &&
    Array.isArray(stonesState.stones) &&
    stonesState.stones[0]?.status === 'active'
  )

  return {
    cbp_ready: cbpReady,
    frame_ready,
    research_ready,
    stones_ready,
    generate_ready: cbpReady && frame_ready && research_ready && stones_ready,
  }
}
