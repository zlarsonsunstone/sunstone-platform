import { supabase } from '@/lib/supabase'

// =============================================================================
// FRAME - Q&A intake state per strategic profile
// =============================================================================

export type FramePurpose =
  | 'educate'
  | 'convince'
  | 'show_market_demand'
  | 'show_market_state'
  | 'unset'

export type FrameCompanySize =
  | 'micro'
  | 'small'
  | 'midmarket'
  | 'enterprise'
  | 'unset'

export type FrameEngagementOpenness =
  | 'sun_only'
  | 'sun_then_step'
  | 'full_ecosystem'
  | 'unset'

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
  human_classification?: string | null
  market_state?: MarketState | null
  axis_code?: string | null
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
  axis_code_pattern?: string | null
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
  market_sizing_score: number
  peer_cohort_score: number
  vehicle_landscape_score: number
  agency_map_score: number
  doppelganger_score: number
  trajectory_score: number
  total_score: number
  required_score: number
  is_sufficient: boolean
  last_computed_at: string
}

// =============================================================================
// READINESS - gates the "Generate Brief" button
// =============================================================================

export interface ReadinessState {
  cbp_ready: boolean
  frame_ready: boolean
  research_ready: boolean
  stones_ready: boolean
  generate_ready: boolean
  next_step_label?: string
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
// SUFFICIENCY SCORING (heuristic)
// =============================================================================

export async function loadSufficiencyScore(strategicProfileId: string): Promise<SufficiencyScore | null> {
  const { data, error } = await supabase
    .from('sufficiency_scores')
    .select('*')
    .eq('strategic_profile_id', strategicProfileId)
    .order('last_computed_at', { ascending: false })
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
    .upsert({
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
      computed_against_corpus_count: entries.length,
      last_computed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'strategic_profile_id' })
    .select()
    .single()
  if (error) {
    console.error('computeAndSaveSufficiency error:', error.message)
    return null
  }
  void frame
  return data as SufficiencyScore
}

// =============================================================================
// READINESS - composes the gate state for the Generate Brief button
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

  const generate_ready = cbp_ready && frame_ready && research_ready && stones_ready

  let next_step_label = 'Generate Recon Brief'
  if (!cbp_ready)        next_step_label = 'Build CBP first'
  else if (!frame_ready) next_step_label = 'Compose Framing the Frame first'
  else if (!research_ready) {
    const have = score?.total_score || 0
    const need = score?.required_score || 12
    next_step_label = 'Surface Research not yet sufficient (' + have + '/' + need + ')'
  }
  else if (!stones_ready) next_step_label = 'Configure Stones first'

  return {
    cbp_ready,
    frame_ready,
    research_ready,
    stones_ready,
    generate_ready,
    next_step_label,
  }
}
