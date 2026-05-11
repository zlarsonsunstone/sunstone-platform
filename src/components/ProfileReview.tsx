/**
 * ProfileReview - consultant-facing strategic profile viewer.
 *
 * URL: /profile/review?strategic_profile_id=<uuid>
 *
 * Renders for a given strategic_profile:
 *   - Header: company name, tenant, status, alignment score (if reconciliation exists)
 *   - 3 tabs: Federal Profile | Commercial Profile | Reconciliation
 *   - Below tabs: Claims grid filtered to current tab's claim_category
 *
 * Every claim hovers to a citation popover that pulls from surface_research
 * via profile_claims.source_entry_id.
 *
 * This is Phase 1A: read-only consultant view. Editing controls (status flip,
 * dispute_reason capture, line delete) come in Phase 1B.
 *
 * Auth-gated. Path-intercepted in App.tsx like /prelim/review and
 * /admin/submissions.
 */
import { useState, useEffect, CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'

// =============================================================================
// PALETTE - matches existing platform
// =============================================================================

const palette = {
  cream: '#FBF7F0',
  espresso: '#2A2622',
  amber: '#F0A742',
  amberHover: '#E69828',
  hairline: '#E8E1D5',
  textSecondary: '#5C5249',
  textTertiary: '#8B7E70',
  success: '#4A7C59',
  warning: '#C0892B',
  danger: '#C0392B',
  info: '#3E6B89',
  white: '#FFFFFF',
}

// =============================================================================
// TYPES
// =============================================================================

interface StrategicProfile {
  id: string
  tenant_id: string
  name: string
  client_status: string | null
  engagement_stage: string | null
  description: string | null
  created_at: string
}

interface FederalProfile {
  id: string
  tenant_id: string
  synthesized_text: string | null
  structured_data: any | null
  last_built_at: string | null
  source_count: number | null
}

interface CommercialProfile {
  id: string
  tenant_id: string
  synthesized_text: string | null
  structured_data: any | null
  last_built_at: string | null
  source_count: number | null
}

interface Reconciliation {
  id: string
  tenant_id: string
  alignment: string | null
  divergence: string | null
  suggestions: string | null
  structured_data: any | null
  version: number | null
  last_built_at: string | null
  mode: string | null
}

interface SurfaceResearch {
  id: string
  entry_kind: string | null
  title: string | null
  source_label: string | null
  source_url: string | null
  tier: number | null
  tier_label: string | null
}

interface ProfileClaim {
  id: string
  tenant_id: string
  strategic_profile_id: string
  source_entry_id: string | null
  source_label: string | null
  source_tier: number | null
  claim_text: string
  claim_category: string | null
  status: string | null
  status_reason: string | null
  confidence_level: string | null
  is_brief_critical: boolean | null
  interpretation_attestation: string | null
  attested_at: string | null
  attested_by: string | null
  dispute_reason: string | null
  created_at: string
  // Joined surface_research data
  surface_research?: SurfaceResearch | null
}

type TabKey = 'federal' | 'commercial' | 'reconciliation'

// =============================================================================
// STYLES
// =============================================================================

const containerStyle: CSSProperties = {
  minHeight: '100vh',
  background: palette.cream,
  fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, sans-serif',
  color: palette.espresso,
}

const innerStyle: CSSProperties = {
  maxWidth: '1280px',
  margin: '0 auto',
  padding: '40px 32px',
}

const headerStyle: CSSProperties = {
  marginBottom: '24px',
  paddingBottom: '20px',
  borderBottom: `1px solid ${palette.hairline}`,
}

const eyebrowStyle: CSSProperties = {
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: palette.textTertiary,
  marginBottom: '8px',
}

const h1Style: CSSProperties = {
  fontSize: '28px',
  fontWeight: 700,
  margin: 0,
  marginBottom: '8px',
  color: palette.espresso,
  lineHeight: 1.25,
}

const tabBarStyle: CSSProperties = {
  display: 'flex',
  gap: '4px',
  marginBottom: '24px',
  borderBottom: `2px solid ${palette.hairline}`,
}

const tabStyle = (active: boolean): CSSProperties => ({
  padding: '12px 20px',
  fontSize: '14px',
  fontWeight: active ? 700 : 500,
  fontFamily: 'inherit',
  background: 'transparent',
  color: active ? palette.espresso : palette.textSecondary,
  border: 'none',
  borderBottom: `3px solid ${active ? palette.amber : 'transparent'}`,
  cursor: 'pointer',
  marginBottom: '-2px',
  transition: 'all 0.15s',
})

const sectionCardStyle: CSSProperties = {
  background: palette.white,
  border: `1px solid ${palette.hairline}`,
  borderRadius: '12px',
  padding: '28px',
  marginBottom: '20px',
}

const narrativeTextStyle: CSSProperties = {
  fontSize: '14px',
  lineHeight: 1.65,
  color: palette.espresso,
  whiteSpace: 'pre-wrap',
}

const claimRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '90px 1fr 140px 80px',
  gap: '16px',
  alignItems: 'flex-start',
  padding: '14px 16px',
  background: palette.white,
  border: `1px solid ${palette.hairline}`,
  borderRadius: '8px',
  marginBottom: '8px',
  fontSize: '13px',
}

const statusBadgeStyle = (status: string | null): CSSProperties => {
  const map: Record<string, { bg: string; fg: string }> = {
    untested: { bg: '#FFF6E5', fg: palette.warning },
    assumed: { bg: '#FFF6E5', fg: palette.warning },
    attested: { bg: '#EAF4ED', fg: palette.success },
    disputed: { bg: '#F7E6E3', fg: palette.danger },
  }
  const tone = map[status || 'untested'] || { bg: palette.hairline, fg: palette.textSecondary }
  return {
    display: 'inline-block',
    padding: '3px 10px',
    fontSize: '10px',
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    background: tone.bg,
    color: tone.fg,
    borderRadius: '12px',
  }
}

const tierBadgeStyle = (tier: number | null): CSSProperties => {
  const fg = tier === 1 ? palette.success : tier === 2 ? palette.info : palette.textTertiary
  return {
    display: 'inline-block',
    padding: '2px 8px',
    fontSize: '10px',
    fontWeight: 700,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    background: palette.cream,
    color: fg,
    border: `1px solid ${palette.hairline}`,
    borderRadius: '4px',
  }
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Extract the overall alignment score from a reconciliation's structured_data.
 * The CBP-style reconciliation puts it at structured_data.overall_alignment_score (0-100).
 */
function extractAlignmentScore(r: Reconciliation | null): number | null {
  if (!r || !r.structured_data) return null
  const sd = r.structured_data as any
  if (typeof sd.overall_alignment_score === 'number') return sd.overall_alignment_score
  return null
}

/**
 * Categorize each claim into a tab. Default rule:
 *   - 'capability', 'differentiator', 'past_performance' -> all tabs
 *   - claim_category starting with 'federal_' -> federal tab
 *   - claim_category starting with 'commercial_' -> commercial tab
 *   - everything else -> all tabs
 * Refine later as we see what categories actually exist.
 */
function claimMatchesTab(claim: ProfileClaim, tab: TabKey): boolean {
  if (tab === 'reconciliation') return true   // reconciliation shows all claims
  const cat = (claim.claim_category || '').toLowerCase()
  if (cat.startsWith('federal_') || cat.startsWith('federal ')) return tab === 'federal'
  if (cat.startsWith('commercial_') || cat.startsWith('commercial ')) return tab === 'commercial'
  return true   // generic claims show in both
}

// =============================================================================
// COMPONENT
// =============================================================================

interface ProfileReviewProps {
  strategicProfileId?: string
}

type Stage = 'loading' | 'ready' | 'error'

export function ProfileReview({ strategicProfileId: propStrategicProfileId }: ProfileReviewProps) {
  const [stage, setStage] = useState<Stage>('loading')
  const [error, setError] = useState<string | null>(null)

  const [profile, setProfile] = useState<StrategicProfile | null>(null)
  const [federal, setFederal] = useState<FederalProfile | null>(null)
  const [commercial, setCommercial] = useState<CommercialProfile | null>(null)
  const [reconciliation, setReconciliation] = useState<Reconciliation | null>(null)
  const [claims, setClaims] = useState<ProfileClaim[]>([])

  const [activeTab, setActiveTab] = useState<TabKey>('reconciliation')
  const [hoveredClaimId, setHoveredClaimId] = useState<string | null>(null)

  const strategicProfileId = propStrategicProfileId || (() => {
    if (typeof window === 'undefined') return null
    return new URLSearchParams(window.location.search).get('strategic_profile_id')
  })()

  useEffect(() => {
    if (!strategicProfileId) {
      setError('No strategic_profile_id provided. Open this page with ?strategic_profile_id=<uuid>.')
      setStage('error')
      return
    }
    void load(strategicProfileId)
  }, [strategicProfileId])

  async function load(id: string) {
    setStage('loading')
    setError(null)

    try {
      // 1. strategic_profiles
      const { data: spRow, error: spErr } = await supabase
        .schema('v2')
        .from('strategic_profiles')
        .select('*')
        .eq('id', id)
        .maybeSingle()

      if (spErr) throw new Error(`strategic_profiles fetch failed: ${spErr.message}`)
      if (!spRow) throw new Error('No strategic profile found with that id.')
      setProfile(spRow as StrategicProfile)

      const tenantId = (spRow as any).tenant_id

      // 2. federal_profile + commercial_profile + reconciliation (one each per tenant)
      // These are tenant-scoped (not strategic_profile-scoped) per the existing schema.
      const [fpRes, cpRes, rcRes] = await Promise.all([
        supabase.schema('v2').from('federal_profile').select('*').eq('tenant_id', tenantId).maybeSingle(),
        supabase.schema('v2').from('commercial_profile').select('*').eq('tenant_id', tenantId).maybeSingle(),
        supabase.schema('v2').from('reconciliation').select('*').eq('tenant_id', tenantId).order('version', { ascending: false }).limit(1).maybeSingle(),
      ])

      if (fpRes.error) console.warn('federal_profile load:', fpRes.error.message)
      if (cpRes.error) console.warn('commercial_profile load:', cpRes.error.message)
      if (rcRes.error) console.warn('reconciliation load:', rcRes.error.message)

      setFederal((fpRes.data as FederalProfile) || null)
      setCommercial((cpRes.data as CommercialProfile) || null)
      setReconciliation((rcRes.data as Reconciliation) || null)

      // 3. profile_claims for this strategic_profile_id (NOT just tenant - claims are strategic-profile scoped)
      const { data: claimRows, error: claimErr } = await supabase
        .schema('v2')
        .from('profile_claims')
        .select('*')
        .eq('strategic_profile_id', id)
        .order('claim_category', { ascending: true })
        .order('created_at', { ascending: true })

      if (claimErr) throw new Error(`profile_claims fetch failed: ${claimErr.message}`)

      const claimsList = (claimRows || []) as ProfileClaim[]

      // 4. Bulk-fetch the surface_research rows referenced by source_entry_id
      const sourceIds = Array.from(new Set(claimsList.map(c => c.source_entry_id).filter(Boolean))) as string[]
      let srMap = new Map<string, SurfaceResearch>()
      if (sourceIds.length > 0) {
        const { data: srRows, error: srErr } = await supabase
          .schema('v2')
          .from('surface_research')
          .select('id, entry_kind, title, source_label, source_url, tier, tier_label')
          .in('id', sourceIds)

        if (srErr) console.warn('surface_research lookup:', srErr.message)
        ;(srRows || []).forEach((r: any) => srMap.set(r.id, r as SurfaceResearch))
      }

      // Attach surface_research to each claim
      claimsList.forEach(c => {
        if (c.source_entry_id) {
          c.surface_research = srMap.get(c.source_entry_id) || null
        }
      })

      setClaims(claimsList)
      setStage('ready')
    } catch (e: any) {
      setError(e?.message || 'Unknown error')
      setStage('error')
    }
  }

  // -------------------------------------------------------------------------
  // RENDER STATES
  // -------------------------------------------------------------------------

  if (stage === 'loading') {
    return (
      <div style={containerStyle}>
        <div style={innerStyle}>
          <p style={{ color: palette.textSecondary }}>Loading strategic profile...</p>
        </div>
      </div>
    )
  }

  if (stage === 'error') {
    return (
      <div style={containerStyle}>
        <div style={innerStyle}>
          <h1 style={h1Style}>Error</h1>
          <p style={{ color: palette.danger }}>{error}</p>
        </div>
      </div>
    )
  }

  if (!profile) {
    return null
  }

  const alignmentScore = extractAlignmentScore(reconciliation)
  const filteredClaims = claims.filter(c => claimMatchesTab(c, activeTab))

  // -------------------------------------------------------------------------
  // MAIN RENDER
  // -------------------------------------------------------------------------

  return (
    <div style={containerStyle}>
      <div style={innerStyle}>

        {/* HEADER */}
        <div style={headerStyle}>
          <div style={eyebrowStyle}>Strategic Profile Review</div>
          <h1 style={h1Style}>{profile.name}</h1>
          <div style={{ display: 'flex', gap: '20px', alignItems: 'center', marginTop: '12px', fontSize: '13px', color: palette.textSecondary, flexWrap: 'wrap' }}>
            <span><strong>Tenant:</strong> {profile.tenant_id}</span>
            <span><strong>Status:</strong> {profile.client_status || '-'}</span>
            <span><strong>Stage:</strong> {profile.engagement_stage || '-'}</span>
            {alignmentScore !== null && (
              <span style={{ marginLeft: 'auto' }}>
                <strong>Alignment:</strong>{' '}
                <span style={{
                  fontWeight: 700,
                  color: alignmentScore >= 75 ? palette.success
                    : alignmentScore >= 50 ? palette.warning
                    : palette.danger,
                  fontSize: '16px',
                }}>
                  {alignmentScore}/100
                </span>
              </span>
            )}
          </div>
        </div>

        {/* TABS */}
        <div style={tabBarStyle}>
          <button onClick={() => setActiveTab('reconciliation')} style={tabStyle(activeTab === 'reconciliation')}>
            Reconciliation {reconciliation ? '' : ' (none)'}
          </button>
          <button onClick={() => setActiveTab('federal')} style={tabStyle(activeTab === 'federal')}>
            Federal Profile {federal ? '' : ' (none)'}
          </button>
          <button onClick={() => setActiveTab('commercial')} style={tabStyle(activeTab === 'commercial')}>
            Commercial Profile {commercial ? '' : ' (none)'}
          </button>
          <div style={{ marginLeft: 'auto', alignSelf: 'center', fontSize: '12px', color: palette.textTertiary }}>
            {claims.length} total claims
          </div>
        </div>

        {/* TAB CONTENT */}
        {activeTab === 'reconciliation' && (
          <ReconciliationTab reconciliation={reconciliation} />
        )}
        {activeTab === 'federal' && (
          <NarrativeTab title="Federal Profile" profile={federal} emptyMessage="No federal profile built yet." />
        )}
        {activeTab === 'commercial' && (
          <NarrativeTab title="Commercial Profile" profile={commercial} emptyMessage="No commercial profile built yet." />
        )}

        {/* CLAIMS GRID - shown beneath every tab */}
        <div style={{ marginTop: '32px' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '12px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: palette.textTertiary, margin: 0 }}>
              Claims ({filteredClaims.length})
            </h3>
            <span style={{ marginLeft: '12px', fontSize: '12px', color: palette.textTertiary }}>
              Hover any claim to see its source.
            </span>
          </div>
          {filteredClaims.length === 0 ? (
            <div style={{ padding: '24px', background: palette.white, border: `1px solid ${palette.hairline}`, borderRadius: '8px', color: palette.textTertiary, fontStyle: 'italic', textAlign: 'center' }}>
              No claims for this tab.
            </div>
          ) : (
            <div>
              {filteredClaims.map(claim => (
                <ClaimRow
                  key={claim.id}
                  claim={claim}
                  hovered={hoveredClaimId === claim.id}
                  onHoverIn={() => setHoveredClaimId(claim.id)}
                  onHoverOut={() => setHoveredClaimId(prev => prev === claim.id ? null : prev)}
                />
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}

// =============================================================================
// TAB COMPONENTS
// =============================================================================

function NarrativeTab({ title, profile, emptyMessage }: {
  title: string
  profile: FederalProfile | CommercialProfile | null
  emptyMessage: string
}) {
  if (!profile || !profile.synthesized_text) {
    return (
      <div style={sectionCardStyle}>
        <p style={{ color: palette.textTertiary, fontStyle: 'italic', margin: 0 }}>{emptyMessage}</p>
      </div>
    )
  }

  return (
    <div style={sectionCardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '16px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 700, color: palette.espresso, margin: 0 }}>{title}</h2>
        <span style={{ fontSize: '11px', color: palette.textTertiary }}>
          {profile.source_count !== null && `${profile.source_count} sources`}
          {profile.last_built_at && ` - built ${new Date(profile.last_built_at).toLocaleDateString()}`}
        </span>
      </div>
      <div style={narrativeTextStyle}>{profile.synthesized_text}</div>
    </div>
  )
}

function ReconciliationTab({ reconciliation }: { reconciliation: Reconciliation | null }) {
  if (!reconciliation) {
    return (
      <div style={sectionCardStyle}>
        <p style={{ color: palette.textTertiary, fontStyle: 'italic', margin: 0 }}>No reconciliation built yet.</p>
      </div>
    )
  }

  return (
    <>
      {reconciliation.alignment && (
        <div style={sectionCardStyle}>
          <h2 style={{ fontSize: '18px', fontWeight: 700, color: palette.success, margin: 0, marginBottom: '12px' }}>
            Alignment
          </h2>
          <div style={narrativeTextStyle}>{reconciliation.alignment}</div>
        </div>
      )}
      {reconciliation.divergence && (
        <div style={sectionCardStyle}>
          <h2 style={{ fontSize: '18px', fontWeight: 700, color: palette.warning, margin: 0, marginBottom: '12px' }}>
            Divergence
          </h2>
          <div style={narrativeTextStyle}>{reconciliation.divergence}</div>
        </div>
      )}
      {reconciliation.suggestions && (
        <div style={sectionCardStyle}>
          <h2 style={{ fontSize: '18px', fontWeight: 700, color: palette.info, margin: 0, marginBottom: '12px' }}>
            Suggestions
          </h2>
          <div style={narrativeTextStyle}>{reconciliation.suggestions}</div>
        </div>
      )}
    </>
  )
}

// =============================================================================
// CLAIM ROW with hover citation popover
// =============================================================================

function ClaimRow({ claim, hovered, onHoverIn, onHoverOut }: {
  claim: ProfileClaim
  hovered: boolean
  onHoverIn: () => void
  onHoverOut: () => void
}) {
  const sr = claim.surface_research || null
  const sourceLabel = sr?.source_label || claim.source_label || 'Unknown source'
  const sourceUrl = sr?.source_url || null
  const tierLabel = sr?.tier_label || (claim.source_tier ? `Tier ${claim.source_tier}` : '-')

  return (
    <div
      style={{ ...claimRowStyle, position: 'relative' }}
      onMouseEnter={onHoverIn}
      onMouseLeave={onHoverOut}
    >
      <div>
        <span style={statusBadgeStyle(claim.status)}>{claim.status || 'untested'}</span>
      </div>
      <div>
        <div style={{ color: palette.espresso, marginBottom: '4px', lineHeight: 1.45 }}>{claim.claim_text}</div>
        <div style={{ fontSize: '11px', color: palette.textTertiary }}>
          {claim.claim_category && <span style={{ marginRight: '10px' }}>{claim.claim_category}</span>}
          {claim.confidence_level && <span style={{ marginRight: '10px' }}>confidence: {claim.confidence_level}</span>}
          {claim.is_brief_critical && <span style={{ color: palette.danger, fontWeight: 600 }}>brief-critical</span>}
        </div>
      </div>
      <div style={{ fontSize: '11px', color: palette.textTertiary }}>
        <div style={{ marginBottom: '4px' }}><span style={tierBadgeStyle(claim.source_tier ?? null)}>{tierLabel}</span></div>
        <div style={{ lineHeight: 1.3 }}>{sourceLabel.length > 60 ? sourceLabel.slice(0, 60) + '...' : sourceLabel}</div>
      </div>
      <div style={{ textAlign: 'right' }}>
        {sourceUrl && (
          <a href={sourceUrl} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: '11px', color: palette.amber, textDecoration: 'underline' }}>
            view source
          </a>
        )}
      </div>

      {/* Hover popover - source detail */}
      {hovered && (sr || claim.source_label) && (
        <div style={{
          position: 'absolute',
          top: '100%',
          right: '16px',
          marginTop: '6px',
          zIndex: 30,
          background: palette.espresso,
          color: palette.white,
          padding: '14px 16px',
          borderRadius: '8px',
          minWidth: '320px',
          maxWidth: '440px',
          fontSize: '12px',
          lineHeight: 1.5,
          boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
        }}>
          <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: palette.amber, marginBottom: '6px' }}>
            Source
          </div>
          <div style={{ fontWeight: 600, marginBottom: '6px' }}>
            {sr?.title || sourceLabel}
          </div>
          {sr?.entry_kind && (
            <div style={{ fontSize: '11px', color: palette.hairline, marginBottom: '4px' }}>
              Kind: {sr.entry_kind}
            </div>
          )}
          {tierLabel && (
            <div style={{ fontSize: '11px', color: palette.hairline, marginBottom: '4px' }}>
              Tier: {tierLabel}
            </div>
          )}
          {sourceUrl && (
            <div style={{ fontSize: '11px', marginTop: '8px' }}>
              <a href={sourceUrl} target="_blank" rel="noopener noreferrer"
                style={{ color: palette.amber, textDecoration: 'underline' }}>
                {sourceUrl}
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default ProfileReview
