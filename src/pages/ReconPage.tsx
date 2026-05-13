/**
 * ReconPage - Full-page Dartboard Tool, auth-gated, Supabase-backed.
 *
 * Renders at /recon. No NavBar chrome - this is a prospect-facing experience.
 * Reads from v2.tenant_recon_awards + v2.recon_clusters.
 * Writes every click (Accept/Decline/Note/Cold storage/Scan) to v2.recon_feedback.
 *
 * Visual identity ported from recon-wb.html standalone.
 * Cluster view is the primary display mode (15 L1 capability clusters, 54 L2
 * agency sub-clusters, Accept All / Decline All at any level).
 */

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { useStore } from '@/store/useStore'
import { callClaudeBrowser, extractJsonBlock } from '@/lib/claude'

// =============================================================================
// TYPES
// =============================================================================

interface ReconAwardRow {
  award_pk: string
  tenant_id: string
  award_id: string
  award_kind: 'contract' | 'idv'
  idv_type: string | null
  ring: 1 | 2 | 3 | 4
  description: string | null
  naics: string | null
  psc: string | null
  awardee_name: string | null
  awardee_uei: string | null
  awardee_cage: string | null
  dollars_obligated: number | null
  vehicle_ceiling: number | null
  agency_dept: string | null
  capability: string | null
  pop_start: string | null
  pop_end: string | null
  fss: string | null
  cluster_id: string | null
  fit_status: 'yes' | 'unsure' | 'no' | null
  similar_status: 'yes' | 'unsure' | 'no' | null
  note: string | null
  cold_stored: boolean | null
  peer_firm_scan: PeerFirmScan | null
}

interface ReconClusterRow {
  id: string
  level: 1 | 2 | 3
  parent_cluster_id: string | null
  name: string
  description: string | null
  capability_kind: string | null
  agency_dept: string | null
  match_score: number | null
  match_reasoning: string | null
  vocabulary: Array<{ phrase: string; count: number }> | null
  code_pattern: {
    naics?: Record<string, { count: number; share: number; highlight: 'green' | 'black' | 'yellow' }>
    psc?: Record<string, { count: number; share: number; highlight: 'green' | 'black' | 'yellow' }>
  } | null
  award_count: number
  total_obligated: number
  total_ceiling: number
  distinct_awardees: number
  sort_order: number
  awards_decided?: number
  awards_accepted?: number
  awards_declined?: number
}

interface PeerFirmScan {
  bluf?: string
  focus?: string
  differentiators?: string
  match_score?: number | null
  match_reasoning?: string
  scannedAt?: string
  error?: string
}

const RING_META: Record<number, { name: string; short: string; color: string }> = {
  1: { name: 'Bullseye',          short: 'Industry & Task Confirmed',  color: '#C5933A' },
  2: { name: 'Industry-Anchored', short: 'NAICS tight, PSC loose',     color: '#D2A85E' },
  3: { name: 'Task-Anchored',     short: 'NAICS loose, PSC tight',     color: '#B59456' },
  4: { name: 'Hidden Continent',  short: 'Vocabulary adjacency',       color: '#998052' },
}

// =============================================================================
// COMPONENT
// =============================================================================

export function ReconPage() {
  const tenant = useStore((s) => s.activeTenant)
  const currentUser = useStore((s) => s.currentUser)
  const tenantResolutionState = useStore((s) => s.tenantResolutionState)

  const [awards, setAwards] = useState<ReconAwardRow[]>([])
  const [clusters, setClusters] = useState<ReconClusterRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [activeRing, setActiveRing] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<'score' | 'dollars' | 'name'>('score')
  const [expandedL1, setExpandedL1] = useState<Set<string>>(new Set())
  const [expandedL2, setExpandedL2] = useState<Set<string>>(new Set())
  const [expandedAwardId, setExpandedAwardId] = useState<string | null>(null)
  const [scanningId, setScanningId] = useState<string | null>(null)
  const [savingBulk, setSavingBulk] = useState<string | null>(null)

  const noteDebouncers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const tenantColor = tenant?.client_color || '#445c56'  // WB sage green as default

  // ---------------------------------------------------------------------------
  // Load awards + clusters
  // ---------------------------------------------------------------------------
  const loadAll = useCallback(async () => {
    if (!tenant) return
    setLoading(true)
    setError(null)
    const [awardsResult, clustersResult] = await Promise.all([
      supabase.from('v_recon_awards_with_feedback').select('*').eq('tenant_id', tenant.id),
      supabase.from('v_recon_clusters_with_progress').select('*').eq('tenant_id', tenant.id).order('sort_order', { ascending: true }),
    ])
    if (awardsResult.error) {
      setError('Failed to load awards: ' + awardsResult.error.message)
      setLoading(false)
      return
    }
    if (clustersResult.error) {
      setError('Failed to load clusters: ' + clustersResult.error.message)
      setLoading(false)
      return
    }
    setAwards((awardsResult.data || []) as ReconAwardRow[])
    setClusters((clustersResult.data || []) as ReconClusterRow[])
    setLoading(false)
  }, [tenant])

  useEffect(() => { loadAll() }, [loadAll])

  // ---------------------------------------------------------------------------
  // Save feedback
  // ---------------------------------------------------------------------------
  const saveFeedback = async (award: ReconAwardRow, patch: any) => {
    if (!tenant || !currentUser) return
    setAwards((prev) => prev.map((a) => (a.award_id === award.award_id ? { ...a, ...patch } : a)))
    const { error: err } = await supabase
      .from('recon_feedback')
      .upsert({ tenant_id: tenant.id, user_id: currentUser.id, award_id: award.award_id, ...patch }, { onConflict: 'tenant_id,user_id,award_id' })
    if (err) {
      console.error('[Recon] Save feedback error:', err)
      loadAll()
    }
  }

  const debouncedSaveNote = (award: ReconAwardRow, note: string) => {
    setAwards((prev) => prev.map((a) => (a.award_id === award.award_id ? { ...a, note } : a)))
    if (noteDebouncers.current[award.award_id]) clearTimeout(noteDebouncers.current[award.award_id])
    noteDebouncers.current[award.award_id] = setTimeout(() => { saveFeedback(award, { note }) }, 800)
  }

  const bulkSetFit = async (clusterId: string, status: 'yes' | 'no' | null) => {
    if (!tenant || !currentUser) return
    setSavingBulk(clusterId)
    const descendantIds = new Set<string>([clusterId])
    const cluster = clusters.find((c) => c.id === clusterId)
    if (cluster && cluster.level === 1) {
      for (const c of clusters) {
        if (c.parent_cluster_id === clusterId) descendantIds.add(c.id)
      }
    }
    const targetIds = awards.filter((a) => a.cluster_id && descendantIds.has(a.cluster_id)).map((a) => a.award_id)
    if (targetIds.length === 0) {
      setSavingBulk(null)
      return
    }
    setAwards((prev) => prev.map((a) => (targetIds.includes(a.award_id) ? { ...a, fit_status: status } : a)))
    const rows = targetIds.map((award_id) => ({ tenant_id: tenant.id, user_id: currentUser.id, award_id, fit_status: status }))
    const { error: err } = await supabase.from('recon_feedback').upsert(rows, { onConflict: 'tenant_id,user_id,award_id' })
    if (err) {
      console.error('[Recon] Bulk save error:', err)
    }
    await loadAll()
    setSavingBulk(null)
  }

  const scanAwardee = async (award: ReconAwardRow) => {
    if (!award.awardee_name) return
    setScanningId(award.award_id)
    setAwards((prev) => prev.map((a) => (a.award_id === award.award_id ? { ...a, peer_firm_scan: { error: 'Scanning...' } as any } : a)))
    const userPrompt = `You are analyzing a federal contract awardee. Assess whether this firm is a competitive peer to ${tenant?.name || 'the prospect'}.

AWARDEE: ${award.awardee_name}
UEI: ${award.awardee_uei || 'unknown'}
SAMPLE AWARD: ${(award.description || '').slice(0, 400)}
NAICS: ${award.naics || 'unknown'}
PSC: ${award.psc || 'unknown'}
AGENCY (DEPT): ${award.agency_dept || 'unknown'}

Return STRICT JSON only:
{"bluf":"...","focus":"...","differentiators":"...","match_score":0-5,"match_reasoning":"..."}

Score: 0=no resemblance, 5=near-identical peer.`
    try {
      const result = await callClaudeBrowser(userPrompt, { maxTokens: 1500 })
      const parsed = extractJsonBlock(result.text)
      if (!parsed) throw new Error('Could not parse JSON')
      const scan: PeerFirmScan = {
        bluf: parsed.bluf, focus: parsed.focus, differentiators: parsed.differentiators,
        match_score: parsed.match_score, match_reasoning: parsed.match_reasoning,
        scannedAt: new Date().toISOString(),
      }
      await saveFeedback(award, { peer_firm_scan: scan })
    } catch (e: any) {
      console.error('[Recon] Scan error:', e)
      await saveFeedback(award, { peer_firm_scan: { error: e.message || 'Scan failed' } })
    } finally {
      setScanningId(null)
    }
  }

  // ---------------------------------------------------------------------------
  // Derived data
  // ---------------------------------------------------------------------------
  const ringStats = useMemo(() => [1, 2, 3, 4].map((r) => {
    const rows = awards.filter((a) => a.ring === r)
    return { ring: r, count: rows.length }
  }), [awards])

  const totalDecided = awards.filter((a) => a.fit_status !== null && !a.cold_stored).length
  const pctComplete = awards.length ? Math.round((totalDecided / awards.length) * 100) : 0

  const l1WithChildren = useMemo(() => {
    const l1 = clusters.filter((c) => c.level === 1)
    const l2 = clusters.filter((c) => c.level === 2)
    const byParent = new Map<string, ReconClusterRow[]>()
    for (const c of l2) {
      if (!c.parent_cluster_id) continue
      const arr = byParent.get(c.parent_cluster_id) || []
      arr.push(c)
      byParent.set(c.parent_cluster_id, arr)
    }
    return l1.map((c) => ({ ...c, children: byParent.get(c.id) || [] }))
  }, [clusters])

  const sortedL1 = useMemo(() => {
    const filt = l1WithChildren.filter((c) => {
      if (!search) return true
      const q = search.toLowerCase()
      return c.name.toLowerCase().includes(q) || (c.description || '').toLowerCase().includes(q) || (c.vocabulary || []).some((v) => v.phrase.toLowerCase().includes(q))
    })
    return [...filt].sort((a, b) => {
      if (sortKey === 'score') return (b.match_score || 0) - (a.match_score || 0)
      if (sortKey === 'dollars') return (b.total_obligated + b.total_ceiling) - (a.total_obligated + a.total_ceiling)
      if (sortKey === 'name') return a.name.localeCompare(b.name)
      return 0
    })
  }, [l1WithChildren, search, sortKey])

  // ---------------------------------------------------------------------------
  // Guards
  // ---------------------------------------------------------------------------
  if (tenantResolutionState !== 'ready' || !tenant) {
    return <FullPageMessage>Resolving your federal workspace...</FullPageMessage>
  }
  if (loading) return <FullPageMessage>Loading your federal market reconnaissance...</FullPageMessage>
  if (error) return <FullPageMessage isError>{error}</FullPageMessage>
  if (awards.length === 0) {
    return <FullPageMessage>No reconnaissance awards loaded yet. Sunstone is building your federal map. Check back shortly.</FullPageMessage>
  }

  // ---------------------------------------------------------------------------
  // RENDER
  // ---------------------------------------------------------------------------
  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg-primary)', padding: '24px 32px 64px' }}>

      {/* HEADER STRIP */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px', paddingBottom: '20px', borderBottom: '1px solid var(--color-hairline)' }}>
        <div>
          <a href="/stages" style={{ fontSize: '12px', color: tenantColor, textDecoration: 'none', fontWeight: 500, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            ← Back to Stages
          </a>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '32px', fontWeight: 600, margin: '8px 0 4px', letterSpacing: '-0.02em' }}>
            {tenant.name} <span style={{ color: tenantColor }}>·</span> Federal Market Reconnaissance
          </h1>
          <div style={{ fontSize: '13px', color: 'var(--color-text-tertiary)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            Phase 1 · Concentric Reconnaissance Algorithm
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '4px' }}>Reviewed</div>
          <div style={{ fontSize: '28px', fontWeight: 600, color: tenantColor, lineHeight: 1, fontFamily: 'var(--font-display)' }}>
            {totalDecided} / {awards.length}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', marginTop: '2px' }}>{pctComplete}%</div>
        </div>
      </div>

      {/* DARTBOARD + DESCRIPTION */}
      <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: '32px', marginBottom: '32px' }}>
        <Dartboard stats={ringStats} activeRing={activeRing} onRingClick={(r) => setActiveRing(activeRing === r ? null : r)} tenantColor={tenantColor} />
        <div style={{ background: 'var(--color-bg-elevated)', borderRadius: 'var(--radius-card)', padding: '24px', boxShadow: 'var(--shadow-card)' }}>
          <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '6px' }}>
            {tenant.name} federal demand profile
          </div>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '24px', fontWeight: 600, marginBottom: '8px', letterSpacing: '-0.015em' }}>
            {awards.length} awards · {l1WithChildren.length} capability clusters
          </h3>
          <p style={{ fontSize: '14px', color: 'var(--color-text-secondary)', lineHeight: 1.5, marginBottom: '16px' }}>
            <strong>Bullseye = your core capability.</strong> Outer rings = adjacent and broader capabilities. Below, the same awards are grouped by capability so you can accept or decline whole lanes at once.
          </p>
          <MethodologyExplainer tenantColor={tenantColor} />
        </div>
      </div>

      {/* TOOLBAR */}
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '20px' }}>
        <input
          type="text"
          placeholder="Search capability, vocabulary..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: '320px', padding: '10px 14px', border: '1px solid var(--color-hairline)', borderRadius: '6px', fontSize: '14px', fontFamily: 'inherit', background: 'var(--color-bg-elevated)' }}
        />
        <select value={sortKey} onChange={(e) => setSortKey(e.target.value as any)} style={{ padding: '10px 14px', border: '1px solid var(--color-hairline)', borderRadius: '6px', fontSize: '14px', fontFamily: 'inherit', background: 'var(--color-bg-elevated)' }}>
          <option value="score">Sort: Match score desc</option>
          <option value="dollars">Sort: $ desc</option>
          <option value="name">Sort: Name</option>
        </select>
        <div style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
          <strong style={{ color: 'var(--color-text-secondary)' }}>{l1WithChildren.length}</strong> capability clusters · <strong style={{ color: 'var(--color-text-secondary)' }}>{awards.length}</strong> awards
        </div>
      </div>

      {/* CLUSTER CARDS */}
      {sortedL1.map((cluster) => (
        <L1ClusterCard
          key={cluster.id}
          cluster={cluster}
          tenantColor={tenantColor}
          expanded={expandedL1.has(cluster.id)}
          onToggleExpand={() => {
            setExpandedL1((prev) => {
              const next = new Set(prev)
              if (next.has(cluster.id)) next.delete(cluster.id); else next.add(cluster.id)
              return next
            })
          }}
          expandedL2={expandedL2}
          onToggleL2={(id) => {
            setExpandedL2((prev) => {
              const next = new Set(prev)
              if (next.has(id)) next.delete(id); else next.add(id)
              return next
            })
          }}
          awards={awards}
          expandedAwardId={expandedAwardId}
          onToggleAward={(id) => setExpandedAwardId(expandedAwardId === id ? null : id)}
          onAcceptAll={(cid) => bulkSetFit(cid, 'yes')}
          onDeclineAll={(cid) => bulkSetFit(cid, 'no')}
          onClearAll={(cid) => bulkSetFit(cid, null)}
          onSaveFeedback={saveFeedback}
          onSaveNote={debouncedSaveNote}
          onScan={scanAwardee}
          scanningId={scanningId}
          savingBulk={savingBulk}
        />
      ))}

      {sortedL1.length === 0 && (
        <div style={{ background: 'var(--color-bg-elevated)', borderRadius: 'var(--radius-card)', padding: '32px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
          No capability clusters match this search.
        </div>
      )}
    </div>
  )
}

// =============================================================================
// FULL PAGE MESSAGE
// =============================================================================

function FullPageMessage({ children, isError }: { children: React.ReactNode; isError?: boolean }) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div style={{ maxWidth: '480px', textAlign: 'center', color: isError ? '#B00020' : 'var(--color-text-secondary)', fontSize: '15px', lineHeight: 1.5 }}>
        {children}
      </div>
    </div>
  )
}

// =============================================================================
// DARTBOARD
// =============================================================================

function Dartboard({ stats, activeRing, onRingClick, tenantColor }: { stats: { ring: number; count: number }[]; activeRing: number | null; onRingClick: (r: number) => void; tenantColor: string }) {
  const radii = [40, 80, 120, 160]
  const ringOrder = [4, 3, 2, 1]
  return (
    <div style={{ background: 'var(--color-bg-elevated)', borderRadius: 'var(--radius-card)', padding: '24px', boxShadow: 'var(--shadow-card)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <svg viewBox="-180 -180 360 360" width="340" height="340">
          {ringOrder.map((r) => {
            const outerR = radii[4 - r]
            const isActive = activeRing === r
            return <circle key={r} cx={0} cy={0} r={outerR} fill={isActive ? tenantColor : RING_META[r].color} stroke="white" strokeWidth={2} opacity={activeRing === null ? 1 : isActive ? 1 : 0.35} style={{ cursor: 'pointer', transition: 'opacity 0.2s, fill 0.2s' }} onClick={() => onRingClick(r)} />
          })}
          {[1, 2, 3, 4].map((r) => {
            const idx = 4 - r
            const labelR = idx === 0 ? 0 : (radii[idx] + (radii[idx - 1] || 0)) / 2
            const s = stats.find((s) => s.ring === r)
            return (
              <g key={r} style={{ pointerEvents: 'none' }}>
                <text x={0} y={-labelR + 14} textAnchor="middle" fill="white" fontSize="11" fontWeight="700" fontFamily="var(--font-display)">Ring {r}</text>
                <text x={0} y={-labelR + 28} textAnchor="middle" fill="white" fontSize="13" fontWeight="600">{s?.count || 0}</text>
              </g>
            )
          })}
        </svg>
        {activeRing !== null && (
          <div style={{ marginTop: '12px', textAlign: 'center', fontSize: '13px' }}>
            <div style={{ fontWeight: 600 }}>Ring {activeRing}: {RING_META[activeRing].name}</div>
            <div style={{ color: 'var(--color-text-tertiary)', fontSize: '11px', marginTop: '2px' }}>{RING_META[activeRing].short}</div>
          </div>
        )}
      </div>
    </div>
  )
}

// =============================================================================
// METHODOLOGY EXPLAINER
// =============================================================================

function MethodologyExplainer({ tenantColor }: { tenantColor: string }) {
  const defs = [
    { num: 1, color: tenantColor, title: 'Bullseye — Industry & Task Confirmed', body: 'High-correlation NAICS AND PSC. Both codes agree.' },
    { num: 2, color: '#D2A85E', title: 'Industry-Anchored Adjacency', body: 'High-correlation NAICS, loose PSC.' },
    { num: 3, color: '#B59456', title: 'Task-Anchored Adjacency', body: 'Loose NAICS, high-correlation PSC.' },
    { num: 4, color: '#998052', title: 'Vocabulary Adjacency — Hidden Continent', body: 'No code anchors — descriptive language only.' },
  ]
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px' }}>
      {defs.map((d) => (
        <div key={d.num} style={{ display: 'flex', gap: '10px', padding: '10px', background: 'var(--color-bg-primary)', borderRadius: '4px', fontSize: '12px', lineHeight: 1.5 }}>
          <div style={{ flexShrink: 0, width: '22px', height: '22px', borderRadius: '50%', background: d.color, color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '11px', fontFamily: 'var(--font-display)' }}>{d.num}</div>
          <div style={{ color: 'var(--color-text-secondary)' }}>
            <strong style={{ display: 'block', color: 'var(--color-text-primary)', fontSize: '12px', marginBottom: '2px' }}>{d.title}</strong>
            {d.body}
          </div>
        </div>
      ))}
    </div>
  )
}

// =============================================================================
// L1 CLUSTER CARD
// =============================================================================

interface L1ClusterCardProps {
  cluster: ReconClusterRow & { children: ReconClusterRow[] }
  tenantColor: string
  expanded: boolean
  onToggleExpand: () => void
  expandedL2: Set<string>
  onToggleL2: (id: string) => void
  awards: ReconAwardRow[]
  expandedAwardId: string | null
  onToggleAward: (id: string) => void
  onAcceptAll: (cid: string) => void
  onDeclineAll: (cid: string) => void
  onClearAll: (cid: string) => void
  onSaveFeedback: (a: ReconAwardRow, patch: any) => Promise<void>
  onSaveNote: (a: ReconAwardRow, note: string) => void
  onScan: (a: ReconAwardRow) => Promise<void>
  scanningId: string | null
  savingBulk: string | null
}

function L1ClusterCard(props: L1ClusterCardProps) {
  const { cluster, tenantColor, expanded, onToggleExpand, expandedL2, onToggleL2, awards,
          expandedAwardId, onToggleAward, onAcceptAll, onDeclineAll, onClearAll,
          onSaveFeedback, onSaveNote, onScan, scanningId, savingBulk } = props

  const decided = cluster.awards_decided || 0
  const accepted = cluster.awards_accepted || 0
  const declined = cluster.awards_declined || 0
  const total = cluster.award_count
  const l1OnlyAwards = awards.filter((a) => a.cluster_id === cluster.id)

  return (
    <div style={{ background: 'var(--color-bg-elevated)', borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-card)', marginBottom: '16px', overflow: 'hidden' }}>
      <div style={{ padding: '18px 20px', display: 'grid', gridTemplateColumns: '76px 1fr 240px', gap: '16px', alignItems: 'center' }}>
        <MatchScoreBadge score={cluster.match_score} tenantColor={tenantColor} />
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', marginBottom: '4px', flexWrap: 'wrap' }}>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '18px', fontWeight: 600, margin: 0, letterSpacing: '-0.015em' }}>{cluster.name}</h3>
            <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
              {total} awards · ${(((cluster.total_obligated || 0) + (cluster.total_ceiling || 0)) / 1e6).toFixed(0)}M · {cluster.distinct_awardees} firms
            </span>
          </div>
          {cluster.description && <p style={{ fontSize: '12px', color: 'var(--color-text-secondary)', margin: '0 0 8px 0', lineHeight: 1.5 }}>{cluster.description}</p>}
          <CodeChips codePattern={cluster.code_pattern} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-end' }}>
          <ActionButtonRow cid={cluster.id} accepted={accepted} declined={declined} total={total} onAcceptAll={onAcceptAll} onDeclineAll={onDeclineAll} onClearAll={onClearAll} saving={savingBulk === cluster.id} />
          <button onClick={onToggleExpand} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '11px', color: tenantColor, fontWeight: 500, fontFamily: 'inherit' }}>
            {expanded ? 'Collapse ▴' : `Review individually  ${decided}/${total} ▾`}
          </button>
        </div>
      </div>

      {cluster.vocabulary && cluster.vocabulary.length > 0 && (
        <div style={{ padding: '0 20px 14px', borderBottom: expanded ? '1px solid var(--color-hairline)' : 'none' }}>
          <div style={{ fontSize: '9px', color: 'var(--color-text-tertiary)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '5px', fontWeight: 700 }}>Bound by</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
            {cluster.vocabulary.slice(0, 10).map((v, i) => (
              <span key={i} style={{ fontSize: '10px', padding: '2px 8px', background: 'var(--color-bg-primary)', border: '1px solid var(--color-hairline)', borderRadius: '12px', color: 'var(--color-text-secondary)' }}>
                {v.phrase} <span style={{ color: 'var(--color-text-tertiary)', marginLeft: '3px' }}>{v.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {expanded && (
        <div style={{ background: 'var(--color-bg-primary)', padding: '14px 20px 20px' }}>
          {cluster.children.length > 0 && (
            <>
              <h4 style={{ fontSize: '10px', color: 'var(--color-text-tertiary)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '10px', fontWeight: 700 }}>Broken down by buying agency</h4>
              {cluster.children.map((child) => (
                <L2ClusterCard key={child.id} cluster={child} tenantColor={tenantColor} expanded={expandedL2.has(child.id)} onToggle={() => onToggleL2(child.id)} awards={awards.filter((a) => a.cluster_id === child.id)} expandedAwardId={expandedAwardId} onToggleAward={onToggleAward} onAcceptAll={onAcceptAll} onDeclineAll={onDeclineAll} onClearAll={onClearAll} onSaveFeedback={onSaveFeedback} onSaveNote={onSaveNote} onScan={onScan} scanningId={scanningId} savingBulk={savingBulk} />
              ))}
            </>
          )}
          {l1OnlyAwards.length > 0 && (
            <>
              <h4 style={{ fontSize: '10px', color: 'var(--color-text-tertiary)', letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: cluster.children.length > 0 ? '20px' : '0', marginBottom: '10px', fontWeight: 700 }}>Other awards in this capability</h4>
              {l1OnlyAwards.map((a) => (
                <AwardRow key={a.award_id} award={a} tenantColor={tenantColor} expanded={expandedAwardId === a.award_id} onToggle={() => onToggleAward(a.award_id)} onSaveFeedback={onSaveFeedback} onSaveNote={onSaveNote} onScan={onScan} scanningId={scanningId} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// =============================================================================
// L2 CLUSTER CARD
// =============================================================================

function L2ClusterCard({ cluster, tenantColor, expanded, onToggle, awards, expandedAwardId, onToggleAward, onAcceptAll, onDeclineAll, onClearAll, onSaveFeedback, onSaveNote, onScan, scanningId, savingBulk }: {
  cluster: ReconClusterRow
  tenantColor: string
  expanded: boolean
  onToggle: () => void
  awards: ReconAwardRow[]
  expandedAwardId: string | null
  onToggleAward: (id: string) => void
  onAcceptAll: (cid: string) => void
  onDeclineAll: (cid: string) => void
  onClearAll: (cid: string) => void
  onSaveFeedback: (a: ReconAwardRow, patch: any) => Promise<void>
  onSaveNote: (a: ReconAwardRow, note: string) => void
  onScan: (a: ReconAwardRow) => Promise<void>
  scanningId: string | null
  savingBulk: string | null
}) {
  const accepted = cluster.awards_accepted || 0
  const declined = cluster.awards_declined || 0
  return (
    <div style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-hairline)', borderRadius: '8px', marginBottom: '8px', overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', display: 'grid', gridTemplateColumns: '52px 1fr 220px', gap: '12px', alignItems: 'center' }}>
        <MatchScoreBadge score={cluster.match_score} tenantColor={tenantColor} size="small" />
        <div>
          <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '2px' }}>{cluster.agency_dept}</div>
          <div style={{ fontSize: '10px', color: 'var(--color-text-tertiary)' }}>
            {cluster.award_count} awards · ${(((cluster.total_obligated || 0) + (cluster.total_ceiling || 0)) / 1e6).toFixed(0)}M · {cluster.distinct_awardees} firms
          </div>
          <div style={{ marginTop: '5px' }}><CodeChips codePattern={cluster.code_pattern} compact /></div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
          <ActionButtonRow cid={cluster.id} accepted={accepted} declined={declined} total={cluster.award_count} onAcceptAll={onAcceptAll} onDeclineAll={onDeclineAll} onClearAll={onClearAll} saving={savingBulk === cluster.id} compact />
          <button onClick={onToggle} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '10px', color: tenantColor, fontFamily: 'inherit' }}>
            {expanded ? 'Hide awards ▴' : 'View awards ▾'}
          </button>
        </div>
      </div>
      {expanded && (
        <div style={{ padding: '10px 14px', borderTop: '1px solid var(--color-hairline)', background: 'var(--color-bg-primary)' }}>
          {awards.map((a) => (
            <AwardRow key={a.award_id} award={a} tenantColor={tenantColor} expanded={expandedAwardId === a.award_id} onToggle={() => onToggleAward(a.award_id)} onSaveFeedback={onSaveFeedback} onSaveNote={onSaveNote} onScan={onScan} scanningId={scanningId} />
          ))}
        </div>
      )}
    </div>
  )
}

// =============================================================================
// ACTION BUTTONS
// =============================================================================

function ActionButtonRow({ cid, accepted, declined, total, onAcceptAll, onDeclineAll, onClearAll, saving, compact }: { cid: string; accepted: number; declined: number; total: number; onAcceptAll: (cid: string) => void; onDeclineAll: (cid: string) => void; onClearAll: (cid: string) => void; saving: boolean; compact?: boolean }) {
  const allAccepted = accepted === total && total > 0
  const allDeclined = declined === total && total > 0
  const baseBtn: React.CSSProperties = { padding: compact ? '4px 9px' : '5px 12px', fontSize: compact ? '10px' : '11px', fontWeight: 600, border: 'none', cursor: saving ? 'wait' : 'pointer', borderRadius: '4px', fontFamily: 'inherit' }
  return (
    <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
      <button onClick={() => onAcceptAll(cid)} disabled={saving} style={{ ...baseBtn, background: allAccepted ? '#1B8F4E' : 'var(--color-bg-elevated)', color: allAccepted ? 'white' : '#1B8F4E', border: '1px solid #1B8F4E' }}>
        {saving ? '...' : (allAccepted ? '✓ All accepted' : 'Accept all')}
      </button>
      <button onClick={() => onDeclineAll(cid)} disabled={saving} style={{ ...baseBtn, background: allDeclined ? '#B00020' : 'var(--color-bg-elevated)', color: allDeclined ? 'white' : '#B00020', border: '1px solid #B00020' }}>
        {allDeclined ? '✗ All declined' : 'Decline all'}
      </button>
      {(accepted > 0 || declined > 0) && (
        <button onClick={() => onClearAll(cid)} disabled={saving} style={{ ...baseBtn, background: 'transparent', color: 'var(--color-text-tertiary)', border: '1px solid var(--color-hairline)' }}>Reset</button>
      )}
    </div>
  )
}

// =============================================================================
// MATCH SCORE BADGE
// =============================================================================

function MatchScoreBadge({ score, tenantColor, size = 'normal' }: { score: number | null; tenantColor: string; size?: 'normal' | 'small' }) {
  const s = score || 0
  const big = size === 'normal'
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ width: big ? '60px' : '40px', height: big ? '60px' : '40px', borderRadius: '50%', background: `conic-gradient(${tenantColor} 0deg, ${tenantColor} ${(s / 5) * 360}deg, var(--color-hairline) ${(s / 5) * 360}deg)`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 4px' }}>
        <div style={{ width: big ? '46px' : '30px', height: big ? '46px' : '30px', borderRadius: '50%', background: 'var(--color-bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: big ? '18px' : '12px', color: tenantColor }}>
          {s.toFixed(1)}
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// CODE CHIPS
// =============================================================================

function CodeChips({ codePattern, compact }: { codePattern: ReconClusterRow['code_pattern']; compact?: boolean }) {
  if (!codePattern) return null
  const naicsEntries = Object.entries(codePattern.naics || {}).sort((a, b) => b[1].count - a[1].count).slice(0, compact ? 4 : 7)
  const pscEntries = Object.entries(codePattern.psc || {}).sort((a, b) => b[1].count - a[1].count).slice(0, compact ? 4 : 6)

  const chipStyle = (highlight: 'green' | 'black' | 'yellow'): React.CSSProperties => {
    if (highlight === 'green') return { background: '#E6F4EA', color: '#1B5E20', border: '1px solid #B4DBBE' }
    if (highlight === 'yellow') return { background: '#FFF8E1', color: '#856404', border: '1px solid #F0D17C' }
    return { background: 'var(--color-bg-primary)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-hairline)' }
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', alignItems: 'center' }}>
      <span style={{ fontSize: '8px', color: 'var(--color-text-tertiary)', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 700, marginRight: '4px' }}>NAICS</span>
      {naicsEntries.map(([code, info]) => (
        <span key={code} title={`${code}: ${info.count} awards (${Math.round(info.share * 100)}%)`} style={{ ...chipStyle(info.highlight), fontSize: compact ? '9px' : '10px', padding: compact ? '2px 5px' : '2px 7px', borderRadius: '3px', fontFamily: 'var(--font-mono, monospace)', fontWeight: 600 }}>{code}</span>
      ))}
      <span style={{ fontSize: '8px', color: 'var(--color-text-tertiary)', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 700, margin: '0 4px 0 6px' }}>PSC</span>
      {pscEntries.map(([code, info]) => (
        <span key={code} title={`${code}: ${info.count} awards (${Math.round(info.share * 100)}%)`} style={{ ...chipStyle(info.highlight), fontSize: compact ? '9px' : '10px', padding: compact ? '2px 5px' : '2px 7px', borderRadius: '3px', fontFamily: 'var(--font-mono, monospace)', fontWeight: 600 }}>{code}</span>
      ))}
    </div>
  )
}

// =============================================================================
// AWARD ROW + DETAIL
// =============================================================================

function AwardRow({ award, tenantColor, expanded, onToggle, onSaveFeedback, onSaveNote, onScan, scanningId }: { award: ReconAwardRow; tenantColor: string; expanded: boolean; onToggle: () => void; onSaveFeedback: (a: ReconAwardRow, patch: any) => Promise<void>; onSaveNote: (a: ReconAwardRow, note: string) => void; onScan: (a: ReconAwardRow) => Promise<void>; scanningId: string | null }) {
  const isIdv = award.award_kind === 'idv'
  const dollarVal = isIdv ? (award.vehicle_ceiling || 0) : (award.dollars_obligated || 0)
  return (
    <div style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-hairline)', borderLeft: isIdv ? `3px solid ${tenantColor}` : '1px solid var(--color-hairline)', borderRadius: '6px', marginBottom: '5px', overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 100px 180px', gap: '8px', padding: '8px 12px', alignItems: 'center', cursor: 'pointer' }} onClick={onToggle}>
        <div style={{ fontSize: '11px', lineHeight: 1.4 }}>
          <span style={{ display: 'inline-block', fontSize: '8px', fontWeight: 700, color: 'white', background: RING_META[award.ring].color, padding: '2px 5px', borderRadius: '3px', marginRight: '5px', letterSpacing: '0.06em' }}>R{award.ring}</span>
          {isIdv && award.idv_type && (
            <span style={{ display: 'inline-block', fontSize: '8px', fontWeight: 700, color: 'white', background: tenantColor, padding: '2px 5px', borderRadius: '3px', marginRight: '5px', letterSpacing: '0.06em', textTransform: 'uppercase' }}>{award.idv_type}</span>
          )}
          {(award.description || '').slice(0, 180)}
        </div>
        <div style={{ fontSize: '10px' }}><strong>{award.naics || '-'}</strong></div>
        <div style={{ fontSize: '10px' }}><strong>{award.psc || '-'}</strong></div>
        <div style={{ fontSize: '10px' }}><strong>{formatMoney(dollarVal)}</strong></div>
        <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
          <span style={{ fontSize: '9px', color: 'var(--color-text-tertiary)', letterSpacing: '0.1em', textTransform: 'uppercase', marginRight: '3px' }}>Fit:</span>
          <FbBtn label="✓" active={award.fit_status === 'yes'} variant="yes" onClick={() => onSaveFeedback(award, { fit_status: award.fit_status === 'yes' ? null : 'yes' })} />
          <FbBtn label="?" active={award.fit_status === 'unsure'} variant="unsure" onClick={() => onSaveFeedback(award, { fit_status: award.fit_status === 'unsure' ? null : 'unsure' })} />
          <FbBtn label="✗" active={award.fit_status === 'no'} variant="no" onClick={() => onSaveFeedback(award, { fit_status: award.fit_status === 'no' ? null : 'no' })} />
        </div>
      </div>
      {expanded && <AwardDetail award={award} tenantColor={tenantColor} onSaveFeedback={onSaveFeedback} onSaveNote={onSaveNote} onScan={onScan} scanningId={scanningId} />}
    </div>
  )
}

function FbBtn({ label, active, variant, onClick }: { label: string; active: boolean; variant: 'yes' | 'unsure' | 'no'; onClick: () => void }) {
  const variantColor = variant === 'yes' ? '#1B8F4E' : variant === 'unsure' ? '#8B6E1B' : '#B00020'
  return (
    <button onClick={onClick} style={{ width: '24px', height: '24px', border: `1px solid ${active ? variantColor : 'var(--color-hairline)'}`, background: active ? variantColor : 'var(--color-bg-elevated)', color: active ? 'white' : 'var(--color-text-secondary)', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', fontWeight: 700, fontFamily: 'inherit' }}>{label}</button>
  )
}

function AwardDetail({ award, tenantColor, onSaveFeedback, onSaveNote, onScan, scanningId }: { award: ReconAwardRow; tenantColor: string; onSaveFeedback: (a: ReconAwardRow, patch: any) => Promise<void>; onSaveNote: (a: ReconAwardRow, note: string) => void; onScan: (a: ReconAwardRow) => Promise<void>; scanningId: string | null }) {
  const isScanning = scanningId === award.award_id
  const scan = award.peer_firm_scan
  return (
    <div style={{ borderTop: '1px solid var(--color-hairline)', padding: '12px 14px', background: 'var(--color-bg-primary)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '18px' }}>
        <div>
          <h4 style={{ fontSize: '9px', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', marginBottom: '6px', fontWeight: 700 }}>Contract detail</h4>
          <KV k="Description" v={award.description || '-'} />
          <KV k="NAICS / PSC" v={`${award.naics || '-'} / ${award.psc || '-'}`} />
          <KV k="Capability" v={award.capability || '-'} />
          <KV k="Agency" v={award.agency_dept || '-'} />
          <KV k="PoP" v={`${award.pop_start || '-'} → ${award.pop_end || '-'}`} />
        </div>
        <div>
          <h4 style={{ fontSize: '9px', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', marginBottom: '6px', fontWeight: 700 }}>Awardee</h4>
          <div style={{ background: 'var(--color-bg-elevated)', padding: '10px', borderRadius: '6px', border: '1px solid var(--color-hairline)' }}>
            <div style={{ fontWeight: 600, fontSize: '12px', marginBottom: '3px' }}>{award.awardee_name || 'Unknown'}</div>
            <div style={{ fontSize: '10px', color: 'var(--color-text-tertiary)', marginBottom: '8px' }}>UEI: {award.awardee_uei || '-'}  CAGE: {award.awardee_cage || '-'}</div>
            {scan && scan.bluf && (
              <>
                <div style={{ background: tenantColor, color: 'white', padding: '6px 9px', borderRadius: '4px', marginBottom: '6px' }}>
                  <div style={{ fontSize: '8px', fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', opacity: 0.85, marginBottom: '2px' }}>Bottom Line</div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: '12px', fontWeight: 600, lineHeight: 1.4 }}>{scan.bluf}</div>
                </div>
                {scan.focus && <div style={{ marginBottom: '5px', fontSize: '10px', lineHeight: 1.5 }}><strong style={{ fontSize: '8px', letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)' }}>Focus </strong>{scan.focus}</div>}
                {scan.differentiators && <div style={{ marginBottom: '5px', fontSize: '10px', lineHeight: 1.5 }}><strong style={{ fontSize: '8px', letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)' }}>Differentiators </strong>{scan.differentiators}</div>}
                {scan.match_score !== null && scan.match_score !== undefined && (
                  <div style={{ marginTop: '6px', paddingTop: '6px', borderTop: '1px dashed var(--color-hairline)', fontSize: '10px' }}>
                    <strong>Peer Match: {scan.match_score}/5</strong> — {scan.match_reasoning}
                  </div>
                )}
              </>
            )}
            {scan && scan.error && !isScanning && (
              <div style={{ fontSize: '10px', color: '#B00020' }}>{scan.error} <button onClick={() => onScan(award)} style={{ marginLeft: '6px', padding: '3px 7px', fontSize: '9px', background: tenantColor, color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer' }}>Retry</button></div>
            )}
            {isScanning && <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>Scanning peer firm...</div>}
            {!scan && !isScanning && <button onClick={() => onScan(award)} style={{ marginTop: '4px', padding: '5px 10px', background: tenantColor, color: 'white', border: 'none', borderRadius: '4px', fontSize: '10px', fontWeight: 600, cursor: 'pointer' }}>Scan peer firm</button>}
          </div>
          <div style={{ marginTop: '10px' }}>
            <div style={{ fontSize: '10px', marginBottom: '4px' }}><strong>Similar work?</strong></div>
            <div style={{ display: 'flex', gap: '4px' }}>
              <FbBtn label="Yes" active={award.similar_status === 'yes'} variant="yes" onClick={() => onSaveFeedback(award, { similar_status: award.similar_status === 'yes' ? null : 'yes' })} />
              <FbBtn label="?" active={award.similar_status === 'unsure'} variant="unsure" onClick={() => onSaveFeedback(award, { similar_status: award.similar_status === 'unsure' ? null : 'unsure' })} />
              <FbBtn label="No" active={award.similar_status === 'no'} variant="no" onClick={() => onSaveFeedback(award, { similar_status: award.similar_status === 'no' ? null : 'no' })} />
            </div>
          </div>
          <div style={{ marginTop: '10px' }}>
            <div style={{ fontSize: '9px', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', marginBottom: '3px', fontWeight: 700 }}>Note</div>
            <textarea defaultValue={award.note || ''} onChange={(e) => onSaveNote(award, e.target.value)} placeholder="Optional note" rows={2} style={{ width: '100%', padding: '5px 7px', border: '1px solid var(--color-hairline)', borderRadius: '4px', fontSize: '10px', fontFamily: 'inherit', resize: 'vertical', background: 'var(--color-bg-elevated)' }} />
          </div>
          <div style={{ marginTop: '8px' }}>
            <label style={{ fontSize: '10px', display: 'flex', alignItems: 'center', gap: '5px', color: 'var(--color-text-secondary)' }}>
              <input type="checkbox" checked={!!award.cold_stored} onChange={(e) => onSaveFeedback(award, { cold_stored: e.target.checked })} />
              Send to cold storage
            </label>
          </div>
        </div>
      </div>
    </div>
  )
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: '6px', padding: '3px 0', fontSize: '10px', borderBottom: '1px solid var(--color-hairline)' }}>
      <div style={{ color: 'var(--color-text-tertiary)' }}>{k}</div>
      <div>{v}</div>
    </div>
  )
}

function formatMoney(n: number): string {
  if (!n) return '$0'
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}
