/**
 * Market Research workspace - Recon Engine
 *
 * Sister module to Surface Research. Where Surface Research captures
 * client/prospect data (Tiers 1-4 of the truth pyramid), Market Research
 * captures the MARKET environment the prospect is selling into.
 *
 * Each artifact is classified by analytical POSTURE at upload:
 *
 *   general    - "Tell me what this market looks like."
 *   evidence   - "I need proof that X is true."
 *   thesis     - "I believe Y about this market - show me what supports it."
 *   myth_bust  - "Z is conventional wisdom - is it actually true?"
 *
 * Each posture produces a different output shape that feeds the brief
 * generator differently.
 *
 * Pattern matches FramingTheFrame: modal with size="full", autosave,
 * status badges, review flow.
 */
import { useEffect, useState, useMemo, CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { Modal } from '@/components/Modal'
import { Button } from '@/components/Button'
import { Badge } from '@/components/Badge'

// =============================================================================
// TYPES
// =============================================================================

export type MarketPosture = 'general' | 'evidence' | 'thesis' | 'myth_bust'

export type AnalysisStatus =
  | 'pending'
  | 'analyzing'
  | 'awaiting_review'
  | 'reviewed'
  | 'error'

export interface MarketResearchEntry {
  id: string
  tenant_id: string
  strategic_profile_id: string
  title: string
  entry_kind: string
  source_label: string | null
  source_url: string | null
  raw_payload: Record<string, unknown>
  extracted_text: string | null
  user_context: string | null
  market_posture: MarketPosture
  posture_context: string | null
  analysis: Record<string, unknown> | null
  analysis_status: AnalysisStatus
  analysis_error: string | null
  reviewed_at: string | null
  reviewer_notes: string | null
  created_at: string
  updated_at: string
}

interface Props {
  strategicProfileId: string
  tenantId: string
  profileName: string
  onClose: () => void
  onCompleted?: () => void
}

// =============================================================================
// POSTURE METADATA
// =============================================================================

const POSTURE_META: Record<MarketPosture, {
  label: string
  short: string
  description: string
  contextPrompt: string
  contextPlaceholder: string
  color: string
}> = {
  general: {
    label: 'General Analysis',
    short: 'General',
    description: 'No prior thesis. Tell me what this market looks like - patterns, players, anomalies, gaps.',
    contextPrompt: 'Optional context (what should the analysis emphasize?)',
    contextPlaceholder: 'e.g. "Focus on FY24-25 spend patterns" or "Pay attention to small-business set-asides"',
    color: '#007AFF',
  },
  evidence: {
    label: 'Evidence Hunting',
    short: 'Evidence',
    description: 'You have a specific claim to verify. The system searches for confirming or disconfirming data.',
    contextPrompt: 'What claim am I testing?',
    contextPlaceholder: 'e.g. "DLA has $200M+ obligated for nitrile gloves in FY25"',
    color: '#34C759',
  },
  thesis: {
    label: 'Thesis Support',
    short: 'Thesis',
    description: 'You have a position. The system finds what backs it up - and surfaces honest counterevidence.',
    contextPrompt: 'What thesis am I supporting?',
    contextPlaceholder: 'e.g. "DOD prefers domestic suppliers for medical PPE under Trump II"',
    color: '#AF52DE',
  },
  myth_bust: {
    label: 'Myth-Busting',
    short: 'Myth-bust',
    description: 'You suspect conventional wisdom is wrong. The system shows the belief vs the contradicting evidence side-by-side.',
    contextPrompt: 'What conventional wisdom am I testing?',
    contextPlaceholder: 'e.g. "Foreign suppliers dominate the federal medical glove market"',
    color: '#FF9500',
  },
}

// =============================================================================
// COMPONENT
// =============================================================================

export function MarketResearch({
  strategicProfileId,
  tenantId,
  profileName,
  onClose,
  onCompleted,
}: Props) {
  const [entries, setEntries] = useState<MarketResearchEntry[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [reviewing, setReviewing] = useState<MarketResearchEntry | null>(null)

  // Group by posture for the convergent panel
  const byPosture = useMemo(() => {
    const groups: Record<MarketPosture, MarketResearchEntry[]> = {
      general: [],
      evidence: [],
      thesis: [],
      myth_bust: [],
    }
    for (const e of entries) {
      groups[e.market_posture].push(e)
    }
    return groups
  }, [entries])

  const reviewedCount = entries.filter((e) => e.analysis_status === 'reviewed').length
  const totalCount = entries.length

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strategicProfileId])

  async function load() {
    setError(null)
    const { data, error: err } = await supabase
      .from('market_research')
      .select('*')
      .eq('strategic_profile_id', strategicProfileId)
      .order('created_at', { ascending: false })
    if (err) {
      setError(err.message)
      setLoaded(true)
      return
    }
    setEntries((data || []) as MarketResearchEntry[])
    setLoaded(true)
  }

  async function deleteEntry(id: string) {
    if (!confirm('Delete this entry? This cannot be undone.')) return
    const { error: err } = await supabase.from('market_research').delete().eq('id', id)
    if (err) {
      alert('Delete failed: ' + err.message)
      return
    }
    await load()
    onCompleted?.()
  }

  async function retryAnalysis(id: string) {
    try {
      await supabase
        .from('market_research')
        .update({ analysis_status: 'pending', analysis_error: null })
        .eq('id', id)
      await load()
      void triggerAnalysis(id)
    } catch (e) {
      alert('Retry failed: ' + (e as Error).message)
    }
  }

  async function triggerAnalysis(entryId: string) {
    try {
      await fetch('/.netlify/functions/analyze-market-entry', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entry_id: entryId }),
      })
      // Polling: refresh after 3s, then 8s, then stop. analyze function takes
      // 5-15s typical. Final state will be either awaiting_review or error.
      setTimeout(() => void load(), 3000)
      setTimeout(() => void load(), 8000)
      setTimeout(() => void load(), 15000)
    } catch (e) {
      console.error('triggerAnalysis failed:', e)
    }
  }

  return (
    <Modal open={true} onClose={onClose} title={`Market Research - ${profileName}`} size="full">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Intro */}
        <div
          style={{
            padding: '12px 14px',
            background: 'rgba(175, 82, 222, 0.06)',
            border: '1px solid rgba(175, 82, 222, 0.2)',
            borderRadius: 'var(--radius-input)',
            fontSize: '13px',
            color: 'var(--color-text-secondary)',
            lineHeight: 1.5,
          }}
        >
          <strong style={{ color: 'var(--color-text-primary)' }}>Market intelligence.</strong>{' '}
          Distinct from Surface Research (which tracks the prospect). Each artifact is classified
          by analytical posture: General / Evidence / Thesis / Myth-bust. Each posture feeds the
          brief differently.
        </div>

        {error && (
          <div
            style={{
              padding: '10px 12px',
              background: 'rgba(255, 59, 48, 0.08)',
              border: '1px solid rgba(255, 59, 48, 0.25)',
              borderRadius: 'var(--radius-input)',
              color: 'var(--color-danger)',
              fontSize: '13px',
            }}
          >
            {error}
          </div>
        )}

        {/* Convergent panel - posture breakdown */}
        <div
          style={{
            padding: '14px 16px',
            border: '1px solid var(--color-hairline)',
            borderRadius: 'var(--radius-input)',
            background: 'var(--color-bg-subtle)',
          }}
        >
          <div
            style={{
              fontSize: '10px',
              fontWeight: 700,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--color-text-tertiary)',
              marginBottom: '10px',
            }}
          >
            Convergent Market Understanding
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
            {(Object.keys(POSTURE_META) as MarketPosture[]).map((p) => {
              const meta = POSTURE_META[p]
              const count = byPosture[p].length
              const reviewed = byPosture[p].filter((e) => e.analysis_status === 'reviewed').length
              return (
                <div
                  key={p}
                  style={{
                    padding: '10px 12px',
                    background: 'white',
                    border: `1px solid ${meta.color}40`,
                    borderRadius: 'var(--radius-input)',
                  }}
                >
                  <div style={{ fontSize: '11px', fontWeight: 600, color: meta.color, marginBottom: '4px' }}>
                    {meta.short}
                  </div>
                  <div style={{ fontSize: '20px', fontWeight: 600, color: 'var(--color-text-primary)', lineHeight: 1 }}>
                    {reviewed}
                    <span style={{ fontSize: '13px', color: 'var(--color-text-tertiary)', fontWeight: 400 }}>
                      {' / '}{count}
                    </span>
                  </div>
                  <div style={{ fontSize: '10px', color: 'var(--color-text-tertiary)', marginTop: '4px' }}>
                    reviewed
                  </div>
                </div>
              )
            })}
          </div>
          {totalCount > 0 && (
            <div
              style={{
                marginTop: '10px',
                fontSize: '11px',
                color: 'var(--color-text-tertiary)',
              }}
            >
              {reviewedCount} of {totalCount} entries fully reviewed.
              {reviewedCount === totalCount && totalCount > 0 ? ' All clear.' : ''}
            </div>
          )}
        </div>

        {/* Add artifact button */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
            {totalCount === 0
              ? 'No market data yet. Add the first artifact to begin.'
              : `${totalCount} entr${totalCount === 1 ? 'y' : 'ies'} in the market corpus.`}
          </div>
          <Button onClick={() => setAddOpen(true)}>+ Add market artifact</Button>
        </div>

        {/* Entries list */}
        {loaded && entries.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {entries.map((entry) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                onReview={() => setReviewing(entry)}
                onDelete={() => deleteEntry(entry.id)}
                onRetry={() => retryAnalysis(entry.id)}
              />
            ))}
          </div>
        )}

        {!loaded && (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: '13px' }}>
            Loading...
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '8px' }}>
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>

      {/* Add artifact dialog */}
      {addOpen && (
        <AddMarketArtifact
          tenantId={tenantId}
          strategicProfileId={strategicProfileId}
          onClose={() => setAddOpen(false)}
          onAdded={async (newId) => {
            setAddOpen(false)
            await load()
            void triggerAnalysis(newId)
            onCompleted?.()
          }}
        />
      )}

      {/* Review dialog */}
      {reviewing && (
        <ReviewMarketEntry
          entry={reviewing}
          onClose={() => setReviewing(null)}
          onSaved={async () => {
            setReviewing(null)
            await load()
            onCompleted?.()
          }}
        />
      )}
    </Modal>
  )
}

// =============================================================================
// ENTRY ROW
// =============================================================================

function EntryRow({
  entry,
  onReview,
  onDelete,
  onRetry,
}: {
  entry: MarketResearchEntry
  onReview: () => void
  onDelete: () => void
  onRetry: () => void
}) {
  const meta = POSTURE_META[entry.market_posture]
  const status = entry.analysis_status

  const statusBadge: Record<AnalysisStatus, { tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info'; label: string }> = {
    pending: { tone: 'warning', label: 'Queued' },
    analyzing: { tone: 'info', label: 'Analyzing' },
    awaiting_review: { tone: 'warning', label: 'Review' },
    reviewed: { tone: 'success', label: 'Reviewed' },
    error: { tone: 'danger', label: 'Error' },
  }
  const sb = statusBadge[status]

  return (
    <div
      style={{
        padding: '12px 14px',
        border: '1px solid var(--color-hairline)',
        borderRadius: 'var(--radius-input)',
        background: 'white',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
            <span
              style={{
                fontSize: '10px',
                fontWeight: 600,
                color: meta.color,
                background: `${meta.color}15`,
                padding: '2px 8px',
                borderRadius: '4px',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              {meta.short}
            </span>
            <Badge tone={sb.tone}>{sb.label}</Badge>
            <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-primary)' }}>
              {entry.title}
            </span>
          </div>
          {entry.posture_context && (
            <div
              style={{
                fontSize: '12px',
                color: 'var(--color-text-secondary)',
                fontStyle: 'italic',
                marginTop: '4px',
              }}
            >
              "{entry.posture_context}"
            </div>
          )}
          {entry.source_label && (
            <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', marginTop: '4px' }}>
              Source: {entry.source_label}
            </div>
          )}
          {status === 'error' && entry.analysis_error && (
            <div style={{ fontSize: '11px', color: 'var(--color-danger)', marginTop: '6px' }}>
              {entry.analysis_error}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
          {status === 'awaiting_review' && (
            <Button size="small" onClick={onReview}>Review</Button>
          )}
          {status === 'reviewed' && (
            <Button size="small" variant="secondary" onClick={onReview}>View</Button>
          )}
          {status === 'error' && (
            <Button size="small" variant="secondary" onClick={onRetry}>Retry</Button>
          )}
          <button
            onClick={onDelete}
            aria-label="Delete"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--color-text-tertiary)',
              cursor: 'pointer',
              padding: '4px 8px',
              fontSize: '14px',
              lineHeight: 1,
            }}
          >
            x
          </button>
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// ADD MARKET ARTIFACT
// =============================================================================

function AddMarketArtifact({
  tenantId,
  strategicProfileId,
  onClose,
  onAdded,
}: {
  tenantId: string
  strategicProfileId: string
  onClose: () => void
  onAdded: (newId: string) => void
}) {
  const [posture, setPosture] = useState<MarketPosture | null>(null)
  const [title, setTitle] = useState('')
  const [sourceLabel, setSourceLabel] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [content, setContent] = useState('')
  const [userContext, setUserContext] = useState('')
  const [postureContext, setPostureContext] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const meta = posture ? POSTURE_META[posture] : null
  const requiresPostureContext = posture === 'evidence' || posture === 'thesis' || posture === 'myth_bust'

  async function save() {
    if (!posture) return
    if (!title.trim()) { setErr('Title required'); return }
    if (!content.trim()) { setErr('Content required'); return }
    if (requiresPostureContext && !postureContext.trim()) {
      setErr(`${meta!.contextPrompt} - this is required for ${meta!.label} posture.`)
      return
    }

    setSaving(true)
    setErr(null)
    try {
      const { data, error } = await supabase
        .from('market_research')
        .insert({
          tenant_id: tenantId,
          strategic_profile_id: strategicProfileId,
          title: title.trim(),
          entry_kind: 'paste_in',
          source_label: sourceLabel.trim() || null,
          source_url: sourceUrl.trim() || null,
          extracted_text: content,
          user_context: userContext.trim() || null,
          market_posture: posture,
          posture_context: postureContext.trim() || null,
          analysis_status: 'pending',
        })
        .select()
        .single()
      if (error) throw error
      onAdded(data.id)
    } catch (e) {
      setErr((e as Error).message)
      setSaving(false)
    }
  }

  return (
    <Modal open={true} onClose={onClose} title="Add market artifact" size="large">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Posture picker - always first */}
        {!posture ? (
          <div>
            <div
              style={{
                fontSize: '11px',
                fontWeight: 600,
                color: 'var(--color-text-tertiary)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                marginBottom: '10px',
              }}
            >
              Step 1: Pick analytical posture
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
              {(Object.keys(POSTURE_META) as MarketPosture[]).map((p) => {
                const m = POSTURE_META[p]
                return (
                  <button
                    key={p}
                    onClick={() => setPosture(p)}
                    style={{
                      padding: '14px 16px',
                      border: `1px solid ${m.color}40`,
                      borderRadius: 'var(--radius-input)',
                      background: 'white',
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontFamily: 'inherit',
                      transition: 'var(--transition-default)',
                    }}
                    onMouseEnter={(e) => {
                      ;(e.currentTarget as HTMLButtonElement).style.background = `${m.color}08`
                      ;(e.currentTarget as HTMLButtonElement).style.borderColor = m.color
                    }}
                    onMouseLeave={(e) => {
                      ;(e.currentTarget as HTMLButtonElement).style.background = 'white'
                      ;(e.currentTarget as HTMLButtonElement).style.borderColor = `${m.color}40`
                    }}
                  >
                    <div style={{ fontWeight: 600, color: m.color, fontSize: '14px', marginBottom: '4px' }}>
                      {m.label}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>
                      {m.description}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        ) : (
          <>
            {/* Selected posture banner */}
            <div
              style={{
                padding: '10px 12px',
                background: `${meta!.color}10`,
                border: `1px solid ${meta!.color}30`,
                borderRadius: 'var(--radius-input)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: meta!.color }}>{meta!.label}</div>
                <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', marginTop: '2px' }}>
                  {meta!.description}
                </div>
              </div>
              <button
                onClick={() => setPosture(null)}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--color-hairline)',
                  borderRadius: 'var(--radius-input)',
                  padding: '4px 10px',
                  fontSize: '11px',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  color: 'var(--color-text-secondary)',
                }}
              >
                Change
              </button>
            </div>

            {/* Posture-specific framing input */}
            <div>
              <Label>{meta!.contextPrompt}{requiresPostureContext ? ' *' : ''}</Label>
              <textarea
                value={postureContext}
                onChange={(e) => setPostureContext(e.target.value)}
                placeholder={meta!.contextPlaceholder}
                rows={2}
                style={textareaStyle}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <Label>Title *</Label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. DLA Med PPE FY24-25 obligations"
                  style={inputStyle}
                />
              </div>
              <div>
                <Label>Source label</Label>
                <input
                  value={sourceLabel}
                  onChange={(e) => setSourceLabel(e.target.value)}
                  placeholder="e.g. USASpending CSV pull"
                  style={inputStyle}
                />
              </div>
            </div>

            <div>
              <Label>Source URL (optional)</Label>
              <input
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                placeholder="https://..."
                style={inputStyle}
              />
            </div>

            <div>
              <Label>Content (paste data, transcript, summary, raw text)</Label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Paste the artifact content here..."
                rows={10}
                style={textareaStyle}
              />
            </div>

            <div>
              <Label>Your context for this artifact (optional)</Label>
              <textarea
                value={userContext}
                onChange={(e) => setUserContext(e.target.value)}
                placeholder="Why this artifact matters, where it came from, what to look for..."
                rows={3}
                style={textareaStyle}
              />
            </div>
          </>
        )}

        {err && (
          <div
            style={{
              padding: '8px 12px',
              background: 'rgba(255, 59, 48, 0.08)',
              border: '1px solid rgba(255, 59, 48, 0.25)',
              borderRadius: 'var(--radius-input)',
              color: 'var(--color-danger)',
              fontSize: '13px',
            }}
          >
            {err}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', paddingTop: '8px' }}>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          {posture && (
            <Button onClick={save} disabled={saving}>
              {saving ? 'Saving...' : 'Add and analyze'}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}

// =============================================================================
// REVIEW MARKET ENTRY
// =============================================================================

function ReviewMarketEntry({
  entry,
  onClose,
  onSaved,
}: {
  entry: MarketResearchEntry
  onClose: () => void
  onSaved: () => void
}) {
  const meta = POSTURE_META[entry.market_posture]
  const [reviewerNotes, setReviewerNotes] = useState(entry.reviewer_notes || '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function markReviewed() {
    setSaving(true)
    setErr(null)
    try {
      const { error } = await supabase
        .from('market_research')
        .update({
          analysis_status: 'reviewed',
          reviewed_at: new Date().toISOString(),
          reviewer_notes: reviewerNotes.trim() || null,
        })
        .eq('id', entry.id)
      if (error) throw error
      onSaved()
    } catch (e) {
      setErr((e as Error).message)
      setSaving(false)
    }
  }

  return (
    <Modal open={true} onClose={onClose} title={`Review: ${entry.title}`} size="full">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Header strip */}
        <div
          style={{
            padding: '10px 12px',
            background: `${meta.color}10`,
            border: `1px solid ${meta.color}30`,
            borderRadius: 'var(--radius-input)',
          }}
        >
          <div style={{ fontSize: '12px', fontWeight: 600, color: meta.color }}>
            {meta.label}
          </div>
          {entry.posture_context && (
            <div style={{ fontSize: '13px', color: 'var(--color-text-primary)', marginTop: '4px', fontStyle: 'italic' }}>
              "{entry.posture_context}"
            </div>
          )}
        </div>

        {/* Analysis output */}
        <div>
          <div
            style={{
              fontSize: '11px',
              fontWeight: 600,
              color: 'var(--color-text-tertiary)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: '8px',
            }}
          >
            Analysis
          </div>
          {entry.analysis ? (
            <PostureAnalysisRender analysis={entry.analysis} posture={entry.market_posture} />
          ) : (
            <div style={{ fontSize: '13px', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
              No analysis yet.
            </div>
          )}
        </div>

        {/* Reviewer notes */}
        <div>
          <Label>Your notes (optional)</Label>
          <textarea
            value={reviewerNotes}
            onChange={(e) => setReviewerNotes(e.target.value)}
            placeholder="Add caveats, corrections, additional context..."
            rows={3}
            style={textareaStyle}
          />
        </div>

        {err && (
          <div
            style={{
              padding: '8px 12px',
              background: 'rgba(255, 59, 48, 0.08)',
              border: '1px solid rgba(255, 59, 48, 0.25)',
              borderRadius: 'var(--radius-input)',
              color: 'var(--color-danger)',
              fontSize: '13px',
            }}
          >
            {err}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          {entry.analysis_status !== 'reviewed' && (
            <Button onClick={markReviewed} disabled={saving}>
              {saving ? 'Saving...' : 'Mark reviewed'}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}

// =============================================================================
// POSTURE ANALYSIS RENDERER
// =============================================================================

function PostureAnalysisRender({
  analysis,
  posture,
}: {
  analysis: Record<string, unknown>
  posture: MarketPosture
}) {
  // Generic key/value display - shows whatever Claude returned for this posture
  const entries = Object.entries(analysis).filter(([k]) => k !== 'posture')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {entries.map(([key, value]) => (
        <AnalysisField key={key} label={key} value={value} posture={posture} />
      ))}
    </div>
  )
}

function AnalysisField({
  label,
  value,
  posture,
}: {
  label: string
  value: unknown
  posture: MarketPosture
}) {
  const meta = POSTURE_META[posture]
  const prettyLabel = label.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

  // Highlight verdict / strength fields with posture color
  const isHighlight = ['verdict', 'strength_of_support', 'dissonance_strength', 'best_reveal'].includes(label)

  return (
    <div>
      <div
        style={{
          fontSize: '10px',
          fontWeight: 600,
          color: isHighlight ? meta.color : 'var(--color-text-tertiary)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          marginBottom: '4px',
        }}
      >
        {prettyLabel}
      </div>
      <FieldValue value={value} highlight={isHighlight} highlightColor={meta.color} />
    </div>
  )
}

function FieldValue({
  value,
  highlight,
  highlightColor,
}: {
  value: unknown
  highlight: boolean
  highlightColor: string
}) {
  if (value === null || value === undefined || value === '') {
    return <div style={{ fontSize: '13px', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>-</div>
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <div style={{ fontSize: '13px', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>(none)</div>
    }
    return (
      <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '13px', color: 'var(--color-text-primary)', lineHeight: 1.5 }}>
        {value.map((v, i) => (
          <li key={i} style={{ marginBottom: '4px' }}>
            {typeof v === 'object' ? JSON.stringify(v) : String(v)}
          </li>
        ))}
      </ul>
    )
  }

  if (typeof value === 'object') {
    return (
      <pre
        style={{
          fontSize: '12px',
          fontFamily: 'var(--font-mono)',
          background: 'var(--color-bg-subtle)',
          padding: '8px',
          borderRadius: 'var(--radius-input)',
          overflowX: 'auto',
          margin: 0,
        }}
      >
        {JSON.stringify(value, null, 2)}
      </pre>
    )
  }

  const str = String(value)
  if (highlight) {
    return (
      <div
        style={{
          fontSize: '14px',
          fontWeight: 600,
          color: highlightColor,
          padding: '6px 10px',
          background: `${highlightColor}10`,
          border: `1px solid ${highlightColor}30`,
          borderRadius: 'var(--radius-input)',
          display: 'inline-block',
        }}
      >
        {str}
      </div>
    )
  }

  return (
    <div style={{ fontSize: '13px', color: 'var(--color-text-primary)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
      {str}
    </div>
  )
}

// =============================================================================
// SHARED LABEL + INPUT STYLES
// =============================================================================

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: '11px',
        fontWeight: 600,
        color: 'var(--color-text-tertiary)',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        marginBottom: '6px',
      }}
    >
      {children}
    </div>
  )
}

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  fontSize: '13px',
  fontFamily: 'inherit',
  border: '1px solid var(--color-hairline)',
  borderRadius: 'var(--radius-input)',
  background: 'white',
  color: 'var(--color-text-primary)',
}

const textareaStyle: CSSProperties = {
  ...inputStyle,
  resize: 'vertical',
  fontFamily: 'inherit',
}
