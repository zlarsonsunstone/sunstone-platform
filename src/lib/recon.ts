/**
 * Recon Engine — shared types and Supabase helpers
 *
 * Gate 4a: Frame intake + Surface Research + sufficiency scoring + persona library
 * Gate 4b: Adds 5-axis classification fields (market_state, axis_code, human_classification)
 *         per migration 0022. v1 build approach: human_classification is the canonical
 *         input until we calibrate the automated classifier after 20-25 prospects.
 */

import { supabase } from '@/lib/supabase'

// =============================================================================
// FRAME — Q&A intake state per strategic profile
// =============================================================================

export type FramePurpose =
  | 'educate'
  | 'convince'
  | 'show_market_demand'
  | 'show_market_state'
  | 'unset'

export type FrameCompanySize =
  | 'micro'        // < $1M revenue
  | 'small'        // $1M-$10M
  | 'midmarket'    // $10M-$100M
  | 'enterprise'   // $100M+
  | 'unset'

export type FrameEngagementOpenness =
  | 'sun_only'           // Sunstone-only entry
  | 'sun_then_step'      // Open to laddering up
  | 'full_ecosystem'     // Ready for full Sun+Step ecosystem
  | 'unset'

// Gate 4b additions
export type MarketState =
  | 'mature_defined'
  | 'mature_diffuse'
  | 'emerging'
  | 'recently_legislated'
  | 'novel'

export interface ReconFrame {
  id: string
  tenant_id: string
  strategic_profile_id: string
  purpose: FramePurpose
  purpose_notes?: string | null
  company_size_band: FrameCompanySize
  receptivity_notes?: string | null
  engagement_openness: FrameEngagementOpenness
  engagement_notes?: string | null
  persona_id: string | null
  is_complete: boolean
  // Gate 4b fields (migration 0022)
  human_classification?: string | null   // Free-text "Persona + approach (Zack's call)"
  market_state?: MarketState | null
  axis_code?: string | null              // Composed 5-letter code (computed/stored later)
  axis_classified_at?: string | null
  axis_classified_by?: string | null
  created_at: string
  updated_at: string
}

// =============================================================================
// PERSONAS
// =============================================================================

export interface ReconPersona {
  id: string
  slug: string
  name: string
  description: string
  narrative_implications: Record<string, unknown>
  what_about_pairs: unknown[]
  closing_framing: Record<string, unknown>
  axis_code_pattern?: string | null    // From migration 0022
  is_seeded: boolean
  created_at: string
  updated_at: string
}

// =============================================================================
// SURFACE RESEARCH
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
  title: string
  entry_kind: SurfaceEntryKind
  source_label?: string | null
  source_url?: string | null
  raw_payload: Record<string, unknown>
  signal_dimensions: SignalDimension[]
  extracted_facts: unknown[]
  created_at: string
}

export interface SufficiencyScore {
  id: string
  strategic_profile_id: string
  market_sizing_score: number       // 0-3
  peer_cohort_score: number
  vehicle_landscape_score: number
  agency_map_score: number
  doppelganger_score: number
  trajectory_score: number
  total_score: number
  required_score: number             // typically 12
  is_sufficient: boolean
  computed_at: string
}

// =============================================================================
// READINESS — gates the "Generate Brief" button
// =============================================================================

export interface ReadinessState {
  cbp_ready: boolean
  frame_ready: boolean
  research_ready: boolean
  stones_ready: boolean
  all_ready: boolean
  next_step_label: string
}

// =============================================================================
// FRAME HELPERS
// =============================================================================

export async function loadFrame(strategicProfileId: string): Promise<ReconFrame | null> {
  const { data, error } = await supabase
    .from('recon_frames')
    .select('*')
    .eq('strategic_profile_id', strategicProfileId)
    .maybeSingle()
  if (error) {
    console.error('loadFrame error:', error.message)
    return null
  }
  return data as ReconFrame | null
}

export async function upsertFrame(
  tenantId: string,
  strategicProfileId: string,
  patch: Partial<Omit<ReconFrame, 'id' | 'tenant_id' | 'strategic_profile_id' | 'created_at' | 'updated_at'>>
): Promise<ReconFrame | null> {
  // Compute completeness — frame is complete when all 4 core blocks have non-unset values
  // and persona is selected. human_classification and market_state are bonus context for
  // the brief generator but don't gate completeness in v1.
  const isComplete =
    !!patch.purpose && patch.purpose !== 'unset' &&
    !!patch.company_size_band && patch.company_size_band !== 'unset' &&
    !!patch.engagement_openness && patch.engagement_openness !== 'unset' &&
    !!patch.persona_id

  const { data, error } = await supabase
    .from('recon_frames')
    .upsert({
      tenant_id: tenantId,
      strategic_profile_id: strategicProfileId,
      ...patch,
      is_complete: isComplete,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'strategic_profile_id' })
    .select()
    .single()
  if (error) {
    console.error('upsertFrame error:', error.message)
    return null
  }
  return data as ReconFrame
}

// =============================================================================
// PERSONA HELPERS
// =============================================================================

export async function loadPersonas(): Promise<ReconPersona[]> {
  const { data, error } = await supabase
    .from('recon_personas')
    .select('*')
    .order('is_seeded', { ascending: false })
    .order('name', { ascending: true })
  if (error) {
    console.error('loadPersonas error:', error.message)
    return []
  }
  return (data || []) as ReconPersona[]
}

export async function addCustomPersona(
  name: string,
  description: string
): Promise<ReconPersona | null> {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
  const { data, error } = await supabase
    .from('recon_personas')
    .insert({
      slug,
      name,
      description,
      narrative_implications: {},
      what_about_pairs: [],
      closing_framing: {},
      is_seeded: false,
    })
    .select()
    .single()
  if (error) {
    console.error('addCustomPersona error:', error.message)
    return null
  }
  return data as ReconPersona
}

// =============================================================================
// SURFACE RESEARCH HELPERS
// =============================================================================

export async function loadSurfaceEntries(strategicProfileId: string): Promise<SurfaceEntry[]> {
  const { data, error } = await supabase
    .from('surface_research')
    .select('*')
    .eq('strategic_profile_id', strategicProfileId)
    .order('created_at', { ascending: false })
  if (error) {
    console.error('loadSurfaceEntries error:', error.message)
    return []
  }
  return (data || []) as SurfaceEntry[]
}

export async function addSurfaceEntry(
  tenantId: string,
  strategicProfileId: string,
  entry: Omit<SurfaceEntry, 'id' | 'tenant_id' | 'strategic_profile_id' | 'created_at'>
): Promise<SurfaceEntry | null> {
  const { data, error } = await supabase
    .from('surface_research')
    .insert({
      tenant_id: tenantId,
      strategic_profile_id: strategicProfileId,
      ...entry,
    })
    .select()
    .single()
  if (error) {
    console.error('addSurfaceEntry error:', error.message)
    return null
  }
  return data as SurfaceEntry
}

export async function deleteSurfaceEntry(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('surface_research')
    .delete()
    .eq('id', id)
  if (error) {
    console.error('deleteSurfaceEntry error:', error.message)
    return false
  }
  return true
}

// =============================================================================
// SUFFICIENCY SCORING (heuristic — gate 4a)
// =============================================================================

export async function loadSufficiencyScore(strategicProfileId: string): Promise<SufficiencyScore | null> {
  const { data, error } = await supabase
    .from('sufficiency_scores')
    .select('*')
    .eq('strategic_profile_id', strategicProfileId)
    .order('computed_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error('loadSufficiencyScore error:', error.message)
    return null
  }
  return data as SufficiencyScore | null
}

export async function computeAndSaveSufficiency(
  tenantId: string,
  strategicProfileId: string,
  frame: ReconFrame | null,
  entries: SurfaceEntry[]
): Promise<SufficiencyScore | null> {
  // Heuristic: each dimension scores 0-3 based on entry count contributing to it.
  // 0 = no entries, 1 = 1 entry, 2 = 2 entries, 3 = 3+ entries.
  // Required score is 12 (out of 18 possible). Frame's persona/purpose/sizing
  // can raise required threshold for sophisticated personas — but v1 keeps it flat at 12.
  const dimCount = (dim: SignalDimension) =>
    entries.filter(e => e.signal_dimensions.includes(dim)).length

  const score = (count: number): number => Math.min(3, count)

  const market_sizing_score = score(dimCount('market_sizing'))
  const peer_cohort_score = score(dimCount('peer_cohort'))
  const vehicle_landscape_score = score(dimCount('vehicle_landscape'))
  const agency_map_score = score(dimCount('agency_map'))
  const doppelganger_score = score(dimCount('doppelganger'))
  const trajectory_score = score(dimCount('trajectory'))

  const total_score =
    market_sizing_score + peer_cohort_score + vehicle_landscape_score +
    agency_map_score + doppelganger_score + trajectory_score

  const required_score = 12
  const is_sufficient = total_score >= required_score

  const { data, error } = await supabase
    .from('sufficiency_scores')
    .insert({
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
    })
    .select()
    .single()
  if (error) {
    console.error('computeAndSaveSufficiency error:', error.message)
    return null
  }
  // Suppress unused-frame warning — frame is reserved for v2 sufficiency scoring
  // (sophisticated personas may require higher dimension scores)
  void frame
  return data as SufficiencyScore
}

// =============================================================================
// READINESS — composes the gate state for the Generate Brief button
// =============================================================================

export async function loadReadiness(
  strategicProfileId: string,
  cbpComplete: boolean,
): Promise<ReadinessState> {
  const [frame, score, stonesConfig] = await Promise.all([
    loadFrame(strategicProfileId),
    loadSufficiencyScore(strategicProfileId),
    supabase
      .from('stones_config')
      .select('id')
      .eq('strategic_profile_id', strategicProfileId)
      .maybeSingle(),
  ])

  const cbp_ready = cbpComplete
  const frame_ready = !!frame?.is_complete
  const research_ready = !!score?.is_sufficient
  const stones_ready = !!stonesConfig.data

  const all_ready = cbp_ready && frame_ready && research_ready && stones_ready

  let next_step_label = 'Generate Recon Brief'
  if (!cbp_ready)        next_step_label = 'Build CBP first'
  else if (!frame_ready) next_step_label = 'Compose Framing the Frame first'
  else if (!research_ready) {
    const have = score?.total_score || 0
    const need = score?.required_score || 12
    next_step_label = `Surface Research not yet sufficient (${have}/${need})`
  }
  else if (!stones_ready) next_step_label = 'Configure Stones first'

  return {
    cbp_ready,
    frame_ready,
    research_ready,
    stones_ready,
    all_ready,
    next_step_label,
  }
}
