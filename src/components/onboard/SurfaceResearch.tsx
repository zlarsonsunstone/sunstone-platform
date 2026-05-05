import { useEffect, useMemo, useState } from 'react'
import { Modal } from '@/components/Modal'
import { Button } from '@/components/Button'
import { supabase } from '@/lib/supabase'
import {
  SurfaceEntry,
  SurfaceEntryKind,
  ReconFrame,
  loadSurfaceEntries,
  addSurfaceEntry,
  deleteSurfaceEntry,
  loadFrame,
} from '@/lib/recon'
import { FileUploadInput } from '@/components/onboard/FileUploadInput'
import { FileUploadResult } from '@/lib/fileUpload'

interface Props {
  strategicProfileId: string
  tenantId: string
  profileName: string
  onClose: () => void
}

// =============================================================================
// TIER METADATA
// =============================================================================

const TIER_META = {
  1: {
    label: 'Tier 1 - Identity',
    short: 'Identity',
    color: '#5B7DB8',
    description: 'What they say to the world',
    detail: 'Website, LinkedIn, marketing materials, public press. The identity claim.',
    examples: 'Company website, capability deck, brand materials',
  },
  2: {
    label: 'Tier 2 - Ground Truth',
    short: 'Ground Truth',
    color: '#2E6B3E',
    description: 'Federal record - unmediated truth',
    detail: 'USASpending direct awards, USASpending subcontracts, HigherGov. What actually happened, regardless of any claim.',
    examples: 'USASpending CSV, HigherGov export, award history',
  },
  3: {
    label: 'Tier 3 - Federal Positioning',
    short: 'Positioning',
    color: '#C77A0F',
    description: 'How they describe themselves to the procurement system',
    detail: 'SAM.gov profile, SBA profile, Capability Statement, GSA Schedule. Federal-facing claims.',
    examples: 'SAM PDF, SBA profile, capability statement, GSA contract',
  },
  4: {
    label: 'Tier 4 - Context',
    short: 'Context',
    color: '#7C5295',
    description: 'Color and nuance, secondary identity claims',
    detail: 'Interview transcripts, pitch decks, emails, org charts. Useful for nuance.',
    examples: 'Discovery call transcript, pitch deck, internal memo',
  },
} as const

type TierNum = 1 | 2 | 3 | 4

// =============================================================================
// TYPES FOR ANALYSIS RESULTS
// =============================================================================

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

interface AnalysisResult {
  summary: string
  detected_tier: 1 | 2 | 3 | 4
  detected_tier_reasoning: string
  proposed_claims: ClaimProposal[]
  proposed_evidence: EvidenceProposal[]
  market_state_read: {
    read: string
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

interface ProfileUnderstanding {
  market_state?: {
    current_read?: string
    confidence?: string
    reasoning?: string
    last_updated_at?: string
  } | null
  persona?: {
    current_read?: string
    confidence?: string
    reasoning?: string
    last_updated_at?: string
  } | null
  dynamic_findings?: Array<{
    topic: string
    finding: string
    confidence: string
    at: string
  }>
  open_questions?: Array<{
    question: string
    raised_at: string
    answered: boolean
    answer_text?: string | null
  }>
}

// =============================================================================
// COMPONENT
// =============================================================================

export function SurfaceResearch({ strategicProfileId, tenantId, profileName, onClose }: Props) {
  const [entries, setEntries] = useState<SurfaceEntry[]>([])
  const [understanding, setUnderstanding] = useState<ProfileUnderstanding>({})
  const [frame, setFrame] = useState<ReconFrame | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [showAddEntry, setShowAddEntry] = useState(false)
  const [reviewingEntryId, setReviewingEntryId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [e, f, profileRow] = await Promise.all([
        loadSurfaceEntries(strategicProfileId),
        loadFrame(strategicProfileId),
        supabase.from('strategic_profiles').select('profile_understanding').eq('id', strategicProfileId).single(),
      ])
      if (cancelled) return
      setEntries(e)
      setFrame(f)
      if (profileRow.data) {
        setUnderstanding(profileRow.data.profile_understanding || {})
      }
      setLoaded(true)
    })()
    return () => { cancelled = true }
  }, [strategicProfileId])

  async function reloadEverything() {
    const [e, profileRow] = await Promise.all([
      loadSurfaceEntries(strategicProfileId),
      supabase.from('strategic_profiles').select('profile_understanding').eq('id', strategicProfileId).single(),
    ])
    setEntries(e)
    if (profileRow.data) {
      setUnderstanding(profileRow.data.profile_understanding || {})
    }
  }

  async function handleAddEntry(payload: {
    kind: SurfaceEntryKind
    title: string
    sourceLabel?: string
    sourceUrl?: string
    userNote?: string
    extractedText?: string
    fileMetadata?: FileUploadResult['fileMetadata']
    storagePath?: string
    tier: TierNum
  }) {
    const rawPayload: Record<string, unknown> = {}
    if (payload.userNote) rawPayload.user_note = payload.userNote
    if (payload.extractedText) rawPayload.text = payload.extractedText
    if (payload.fileMetadata) rawPayload.file_metadata = payload.fileMetadata
    if (payload.storagePath) rawPayload.storage_path = payload.storagePath

    // Insert with tier set
    const { data: created, error: insertError } = await supabase
      .from('surface_research')
      .insert({
        tenant_id: tenantId,
        strategic_profile_id: strategicProfileId,
        title: payload.title,
        entry_kind: payload.kind,
        source_label: payload.sourceLabel,
        source_url: payload.sourceUrl,
        raw_payload: rawPayload,
        signal_dimensions: [],
        extracted_facts: [],
        tier: payload.tier,
        tier_label: ['identity', 'ground_truth', 'positioning', 'context'][payload.tier - 1],
        analysis_status: 'pending',
      })
      .select()
      .single()

    if (insertError || !created) {
      console.error('Insert failed:', insertError?.message)
      alert('Failed to save entry: ' + (insertError?.message || 'unknown'))
      return
    }

    setShowAddEntry(false)
    await reloadEverything()

    // Trigger Claude analysis
    triggerAnalysis(created.id)
  }

  async function triggerAnalysis(entryId: string) {
    try {
      const response = await fetch('/.netlify/functions/analyze-corpus-entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entry_id: entryId }),
      })
      if (!response.ok) {
        const errorBody = await response.text()
        console.error('Analysis function failed:', response.status, errorBody)
      }
    } catch (err: any) {
      console.error('Analysis call error:', err.message)
    }
    // Reload regardless - the function may have updated the row before failing
    await reloadEverything()
  }

  async function handleDeleteEntry(id: string) {
    if (!window.confirm('Delete this entry? Any claims and evidence proposed by analysis will also be removed.')) return
    // Delete derived claims/evidence first
    await supabase.from('profile_claims').delete().eq('source_entry_id', id)
    await supabase.from('profile_evidence').delete().eq('source_entry_id', id)
    const ok = await deleteSurfaceEntry(id)
    if (!ok) return
    await reloadEverything()
  }

  function getEntryStatusBadge(entry: any): { text: string; className: string } {
    const status = entry.analysis_status || 'pending'
    switch (status) {
      case 'pending':         return { text: 'Queued', className: 'sr-status-pending' }
      case 'analyzing':       return { text: 'Analyzing', className: 'sr-status-analyzing' }
      case 'awaiting_review': return { text: 'Review', className: 'sr-status-review' }
      case 'reviewed':        return { text: 'Reviewed', className: 'sr-status-reviewed' }
      case 'error':           return { text: 'Error', className: 'sr-status-error' }
      default:                return { text: status, className: 'sr-status-pending' }
    }
  }

  if (!loaded) {
    return (
      <Modal open={true} onClose={onClose} title={'Surface Research . ' + profileName} size="full">
        <div style={{ padding: 64, textAlign: 'center', color: 'var(--color-text-secondary)' }}>
          Loading corpus...
        </div>
      </Modal>
    )
  }

  const tieredEntries = useMemo(() => {
    const groups: Record<number, any[]> = { 1: [], 2: [], 3: [], 4: [], 0: [] }
    for (const e of entries) {
      const t = (e as any).tier || 0
      if (groups[t]) groups[t].push(e)
      else groups[0].push(e)
    }
    return groups
  }, [entries])

  return (
    <>
      <Modal
        open={true}
        onClose={onClose}
        title={'Surface Research . ' + profileName}
        size="full"
        footer={
          <>
            <div style={{ flex: 1, fontSize: 12, color: 'var(--color-text-tertiary)' }}>
              {entries.length} {entries.length === 1 ? 'artifact' : 'artifacts'} in corpus
            </div>
            <Button variant="secondary" onClick={onClose}>Close</Button>
          </>
        }
      >
        <style>{STYLES}</style>

        <div className="sr-shell">
          <div className="sr-intro">
            <strong>The contradiction pipeline.</strong> Upload artifacts and Claude analyzes each one against the truth pyramid.
            Tier 1 (identity) and Tier 4 (context) yield <em>claims</em> the prospect makes. Tier 2 (ground truth) yields <em>evidence</em> from the federal record.
            The brief is built from the gap between the two.
          </div>

          <UnderstandingPanel understanding={understanding} frame={frame} />

          <div className="sr-corpus">
            <div className="sr-corpus-head">
              <h3>Corpus</h3>
              <button type="button" className="sr-add-btn" onClick={() => setShowAddEntry(true)}>
                + Add artifact
              </button>
            </div>

            {entries.length === 0 ? (
              <div className="sr-empty">
                <div className="sr-empty-title">No artifacts yet.</div>
                <div className="sr-empty-sub">
                  Click <strong>+ Add artifact</strong> to upload a file or paste content.
                  Choose its tier; Claude will analyze it and propose claims or evidence.
                </div>
              </div>
            ) : (
              <div className="sr-tier-groups">
                {[1, 2, 3, 4, 0].map(tier => {
                  const items = tieredEntries[tier] || []
                  if (items.length === 0) return null
                  const meta = tier === 0 ? null : TIER_META[tier as TierNum]
                  return (
                    <div key={tier} className="sr-tier-group">
                      <div className="sr-tier-header" style={{ borderLeftColor: meta?.color || '#999' }}>
                        <span className="sr-tier-label">{meta?.label || 'Untiered'}</span>
                        {meta && <span className="sr-tier-desc">{meta.description}</span>}
                      </div>
                      <ul className="sr-entries">
                        {items.map((e: any) => {
                          const badge = getEntryStatusBadge(e)
                          return (
                            <li key={e.id} className="sr-entry">
                              <div className="sr-entry-body">
                                <div className="sr-entry-title">
                                  {e.title}
                                  <span className={'sr-status-badge ' + badge.className}>{badge.text}</span>
                                </div>
                                <div className="sr-entry-meta">
                                  {e.source_label && <span>{e.source_label}</span>}
                                  <span>{new Date(e.created_at).toLocaleDateString()}</span>
                                </div>
                                {e.analysis?.summary && (
                                  <div className="sr-entry-summary">{e.analysis.summary}</div>
                                )}
                              </div>
                              <div className="sr-entry-actions">
                                {e.analysis_status === 'awaiting_review' && (
                                  <button
                                    type="button"
                                    className="sr-entry-review"
                                    onClick={() => setReviewingEntryId(e.id)}
                                  >
                                    Review
                                  </button>
                                )}
                                {e.analysis_status === 'error' && (
                                  <button
                                    type="button"
                                    className="sr-entry-retry"
                                    onClick={() => triggerAnalysis(e.id)}
                                  >
                                    Retry
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="sr-entry-delete"
                                  onClick={() => handleDeleteEntry(e.id)}
                                  aria-label="Delete entry"
                                >
                                  x
                                </button>
                              </div>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </Modal>

      {showAddEntry && (
        <AddEntryDialog
          tenantId={tenantId}
          strategicProfileId={strategicProfileId}
          onCancel={() => setShowAddEntry(false)}
          onSubmit={handleAddEntry}
        />
      )}

      {reviewingEntryId && (
        <ReviewEntryDialog
          entryId={reviewingEntryId}
          tenantId={tenantId}
          strategicProfileId={strategicProfileId}
          onClose={() => {
            setReviewingEntryId(null)
            reloadEverything()
          }}
        />
      )}
    </>
  )
}

// =============================================================================
// UNDERSTANDING PANEL - shows convergent state
// =============================================================================

function UnderstandingPanel({ understanding, frame }: { understanding: ProfileUnderstanding; frame: ReconFrame | null }) {
  const ms = understanding.market_state
  const persona = understanding.persona
  const findings = understanding.dynamic_findings || []
  const open = (understanding.open_questions || []).filter(q => !q.answered)

  return (
    <div className="sr-understanding">
      <div className="sr-understanding-head">
        <span className="sr-understanding-eyebrow">CONVERGENT UNDERSTANDING</span>
        <span className="sr-understanding-sub">Updates after each artifact analysis</span>
      </div>

      <div className="sr-understanding-grid">
        <div className="sr-uc-card">
          <div className="sr-uc-label">Market state</div>
          {ms?.current_read ? (
            <>
              <div className="sr-uc-value">{ms.current_read}</div>
              <div className={'sr-uc-confidence sr-conf-' + (ms.confidence || 'low')}>
                {ms.confidence} confidence
              </div>
              {ms.reasoning && <div className="sr-uc-reasoning">{ms.reasoning}</div>}
            </>
          ) : (
            <div className="sr-uc-empty">
              {frame?.market_state ? `Frame initial: ${frame.market_state}` : 'Awaiting first artifact'}
            </div>
          )}
        </div>

        <div className="sr-uc-card">
          <div className="sr-uc-label">Persona</div>
          {persona?.current_read ? (
            <>
              <div className="sr-uc-value">{persona.current_read}</div>
              <div className={'sr-uc-confidence sr-conf-' + (persona.confidence || 'low')}>
                {persona.confidence} confidence
              </div>
              {persona.reasoning && <div className="sr-uc-reasoning">{persona.reasoning}</div>}
            </>
          ) : (
            <div className="sr-uc-empty">Awaiting first artifact</div>
          )}
        </div>
      </div>

      {findings.length > 0 && (
        <div className="sr-uc-findings">
          <div className="sr-uc-findings-label">Dynamic findings ({findings.length})</div>
          <ul className="sr-uc-findings-list">
            {findings.slice(0, 5).map((f, i) => (
              <li key={i}>
                <strong>{f.topic}:</strong> {f.finding}
                <span className={'sr-uc-conf-tag sr-conf-' + f.confidence}>{f.confidence}</span>
              </li>
            ))}
            {findings.length > 5 && (
              <li className="sr-uc-more">+ {findings.length - 5} more</li>
            )}
          </ul>
        </div>
      )}

      {open.length > 0 && (
        <div className="sr-uc-open-questions">
          <div className="sr-uc-findings-label">Open questions ({open.length})</div>
          <ul className="sr-uc-findings-list">
            {open.slice(0, 3).map((q, i) => (
              <li key={i}>{q.question}</li>
            ))}
            {open.length > 3 && (
              <li className="sr-uc-more">+ {open.length - 3} more</li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}

// =============================================================================
// ADD ENTRY DIALOG - includes tier selector
// =============================================================================

function AddEntryDialog({
  tenantId,
  strategicProfileId,
  onCancel,
  onSubmit,
}: {
  tenantId: string
  strategicProfileId: string
  onCancel: () => void
  onSubmit: (payload: any) => void
}) {
  const [tier, setTier] = useState<TierNum | null>(null)
  const [kind, setKind] = useState<SurfaceEntryKind>('paste_in')
  const [title, setTitle] = useState('')
  const [sourceLabel, setSourceLabel] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [userNote, setUserNote] = useState('')
  const [extractedText, setExtractedText] = useState<string>('')
  const [uploadedFile, setUploadedFile] = useState<FileUploadResult | null>(null)

  function handleFileUploaded(result: FileUploadResult) {
    setUploadedFile(result)
    setExtractedText(result.extractedText)
    if (kind !== 'file_upload') setKind('file_upload')
    if (!title.trim()) setTitle(result.fileMetadata.filename)
    if (!sourceLabel.trim()) setSourceLabel(result.fileMetadata.filename)
  }

  function handleSubmit() {
    if (!tier) return
    if (!title.trim()) return
    onSubmit({
      tier,
      kind,
      title: title.trim(),
      sourceLabel: sourceLabel.trim() || undefined,
      sourceUrl: sourceUrl.trim() || undefined,
      userNote: userNote.trim() || undefined,
      extractedText: extractedText || undefined,
      fileMetadata: uploadedFile?.fileMetadata,
      storagePath: uploadedFile?.storagePath,
    })
  }

  return (
    <Modal
      open={true}
      onClose={onCancel}
      title="Add artifact"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!tier || !title.trim()}>
            Add and analyze
          </Button>
        </>
      }
    >
      <style>{DIALOG_STYLES}</style>

      <div className="sr-dlg-body">
        {!tier ? (
          <div className="sr-tier-picker">
            <div className="sr-tier-picker-label">What kind of artifact is this?</div>
            <div className="sr-tier-picker-sub">
              The truth pyramid sorts evidence by reliability. Pick the tier this artifact belongs to.
            </div>
            <div className="sr-tier-options">
              {([1, 2, 3, 4] as TierNum[]).map(t => {
                const meta = TIER_META[t]
                return (
                  <button
                    key={t}
                    type="button"
                    className="sr-tier-option"
                    style={{ borderLeftColor: meta.color }}
                    onClick={() => setTier(t)}
                  >
                    <div className="sr-tier-option-label">{meta.label}</div>
                    <div className="sr-tier-option-desc">{meta.description}</div>
                    <div className="sr-tier-option-detail">{meta.detail}</div>
                    <div className="sr-tier-option-examples">Examples: {meta.examples}</div>
                  </button>
                )
              })}
            </div>
          </div>
        ) : (
          <>
            <div className="sr-dlg-row">
              <label>Tier (selected)</label>
              <div className="sr-selected-tier" style={{ borderLeftColor: TIER_META[tier].color }}>
                <strong>{TIER_META[tier].label}</strong>
                <button type="button" className="sr-tier-change" onClick={() => setTier(null)}>change</button>
                <div className="sr-selected-tier-detail">{TIER_META[tier].detail}</div>
              </div>
            </div>

            <div className="sr-dlg-row">
              <label>Entry kind</label>
              <select value={kind} onChange={e => setKind(e.target.value as SurfaceEntryKind)}>
                <option value="paste_in">Paste-in (text)</option>
                <option value="file_upload">File upload (CSV, XLSX, PDF, DOC)</option>
                <option value="note">Note (your observation or synthesis)</option>
                <option value="fact">Extracted fact</option>
              </select>
            </div>

            <div className="sr-dlg-row">
              <label>Attach file (optional)</label>
              <FileUploadInput
                tenantId={tenantId}
                strategicProfileId={strategicProfileId}
                onUploaded={handleFileUploaded}
                attachedFilename={uploadedFile?.fileMetadata.filename || null}
              />
              {uploadedFile && (
                <div className="sr-file-preview">
                  <strong>{uploadedFile.fileMetadata.filename}</strong>
                  <span> ({(uploadedFile.fileMetadata.size_bytes / 1024).toFixed(0)} KB
                    {uploadedFile.fileMetadata.row_count ? ', ' + uploadedFile.fileMetadata.row_count.toLocaleString() + ' rows' : ''}
                    , {extractedText.length.toLocaleString()} chars extracted)</span>
                </div>
              )}
            </div>

            <div className="sr-dlg-row">
              <label>Title</label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Short summary of what this artifact is"
              />
            </div>

            <div className="sr-dlg-row">
              <label>Source label (optional)</label>
              <input
                type="text"
                value={sourceLabel}
                onChange={e => setSourceLabel(e.target.value)}
                placeholder='e.g. "USASpending FY24-26 NAICS 541512" or "company.com about page"'
              />
            </div>

            <div className="sr-dlg-row">
              <label>Source URL (optional)</label>
              <input
                type="url"
                value={sourceUrl}
                onChange={e => setSourceUrl(e.target.value)}
                placeholder="https://..."
              />
            </div>

            <div className="sr-dlg-row">
              <label>Your context for this artifact (optional)</label>
              <textarea
                value={userNote}
                onChange={e => setUserNote(e.target.value)}
                placeholder="What does this evidence show? Why does it matter? How should it be framed in the brief? Claude reads this when analyzing."
                rows={4}
              />
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

// =============================================================================
// REVIEW ENTRY DIALOG - shows Claude's analysis, lets user accept/edit/reject
// =============================================================================

function ReviewEntryDialog({
  entryId,
  tenantId,
  strategicProfileId,
  onClose,
}: {
  entryId: string
  tenantId: string
  strategicProfileId: string
  onClose: () => void
}) {
  const [entry, setEntry] = useState<any>(null)
  const [claims, setClaims] = useState<any[]>([])
  const [evidence, setEvidence] = useState<any[]>([])
  const [framingAnswers, setFramingAnswers] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [entryRow, claimRows, evidenceRows] = await Promise.all([
        supabase.from('surface_research').select('*').eq('id', entryId).single(),
        supabase.from('profile_claims').select('*').eq('source_entry_id', entryId),
        supabase.from('profile_evidence').select('*').eq('source_entry_id', entryId),
      ])
      if (cancelled) return
      setEntry(entryRow.data)
      setClaims(claimRows.data || [])
      setEvidence(evidenceRows.data || [])
      const existingAnswers = entryRow.data?.framing_answers || {}
      setFramingAnswers(existingAnswers)
    })()
    return () => { cancelled = true }
  }, [entryId])

  async function deleteClaim(claimId: string) {
    if (!confirm('Reject this claim?')) return
    await supabase.from('profile_claims').delete().eq('id', claimId)
    setClaims(claims.filter(c => c.id !== claimId))
  }

  async function deleteEvidence(evidenceId: string) {
    if (!confirm('Reject this evidence?')) return
    await supabase.from('profile_evidence').delete().eq('id', evidenceId)
    setEvidence(evidence.filter(e => e.id !== evidenceId))
  }

  async function markReviewed() {
    setSaving(true)
    await supabase.from('surface_research').update({
      analysis_status: 'reviewed',
      framing_answers: framingAnswers,
      reviewed_at: new Date().toISOString(),
    }).eq('id', entryId)
    setSaving(false)
    onClose()
  }

  if (!entry) {
    return (
      <Modal open={true} onClose={onClose} title="Loading review..." size="md">
        <div style={{ padding: 32, textAlign: 'center' }}>Loading analysis...</div>
      </Modal>
    )
  }

  const analysis = entry.analysis as AnalysisResult | null

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={'Review analysis: ' + entry.title}
      size="full"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Close without marking reviewed</Button>
          <Button onClick={markReviewed} disabled={saving}>
            {saving ? 'Saving...' : 'Mark reviewed'}
          </Button>
        </>
      }
    >
      <style>{REVIEW_STYLES}</style>
      <div className="rv-shell">
        {analysis?.error ? (
          <div className="rv-error">
            <strong>Analysis error:</strong> {(analysis as any).error || 'unknown'}
            {(analysis as any).claude_raw && (
              <pre className="rv-error-raw">{(analysis as any).claude_raw}</pre>
            )}
          </div>
        ) : analysis ? (
          <>
            <div className="rv-section">
              <div className="rv-section-label">Summary</div>
              <div className="rv-summary">{analysis.summary}</div>
            </div>

            <div className="rv-section">
              <div className="rv-section-label">Tier classification</div>
              <div className="rv-tier-row">
                <span className="rv-tier-pill" style={{ background: TIER_META[analysis.detected_tier]?.color }}>
                  {TIER_META[analysis.detected_tier]?.label}
                </span>
                <span className="rv-tier-reasoning">{analysis.detected_tier_reasoning}</span>
              </div>
            </div>

            <div className="rv-section">
              <div className="rv-section-label">Market state read</div>
              <div className="rv-read">
                <span className="rv-read-value">{analysis.market_state_read.read}</span>
                <span className={'rv-read-conf rv-conf-' + analysis.market_state_read.confidence}>
                  {analysis.market_state_read.confidence}
                </span>
              </div>
              <div className="rv-read-reasoning">{analysis.market_state_read.reasoning}</div>
            </div>

            <div className="rv-section">
              <div className="rv-section-label">Persona read</div>
              <div className="rv-read">
                <span className="rv-read-value">{analysis.persona_read.read}</span>
                <span className={'rv-read-conf rv-conf-' + analysis.persona_read.confidence}>
                  {analysis.persona_read.confidence}
                </span>
              </div>
              <div className="rv-read-reasoning">{analysis.persona_read.reasoning}</div>
            </div>

            {claims.length > 0 && (
              <div className="rv-section">
                <div className="rv-section-label">Proposed claims ({claims.length})</div>
                <div className="rv-section-sub">What this artifact says the prospect or their materials assert.</div>
                <ul className="rv-list">
                  {claims.map(c => (
                    <li key={c.id} className={'rv-item' + (c.is_brief_critical ? ' rv-item-critical' : '')}>
                      <div className="rv-item-text">{c.claim_text}</div>
                      <div className="rv-item-meta">
                        <span className="rv-item-tag">{c.claim_category}</span>
                        <span className={'rv-conf-tag rv-conf-' + (c.confidence_level || 'low')}>{c.confidence_level}</span>
                        {c.is_brief_critical && <span className="rv-item-critical-tag">brief-critical</span>}
                      </div>
                      <button type="button" className="rv-item-reject" onClick={() => deleteClaim(c.id)}>Reject</button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {evidence.length > 0 && (
              <div className="rv-section">
                <div className="rv-section-label">Proposed evidence ({evidence.length})</div>
                <div className="rv-section-sub">What the federal record or this artifact actually shows.</div>
                <ul className="rv-list">
                  {evidence.map(e => (
                    <li key={e.id} className="rv-item">
                      <div className="rv-item-text">{e.evidence_text}</div>
                      <div className="rv-item-meta">
                        <span className="rv-item-tag">{e.evidence_category}</span>
                        {e.data_as_of && <span className="rv-item-date">as of {e.data_as_of}</span>}
                        {e.citation_url && <a className="rv-item-link" href={e.citation_url} target="_blank" rel="noopener noreferrer">source</a>}
                      </div>
                      <button type="button" className="rv-item-reject" onClick={() => deleteEvidence(e.id)}>Reject</button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {analysis.dynamic_findings?.length > 0 && (
              <div className="rv-section">
                <div className="rv-section-label">Dynamic findings ({analysis.dynamic_findings.length})</div>
                <ul className="rv-list">
                  {analysis.dynamic_findings.map((f, i) => (
                    <li key={i} className="rv-item">
                      <div className="rv-item-text">
                        <strong>{f.topic}:</strong> {f.finding}
                      </div>
                      <div className="rv-item-meta">
                        <span className={'rv-conf-tag rv-conf-' + f.confidence}>{f.confidence}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {analysis.framing_questions?.length > 0 && (
              <div className="rv-section">
                <div className="rv-section-label">Framing questions ({analysis.framing_questions.length})</div>
                <div className="rv-section-sub">Claude has questions for you about how to use this artifact.</div>
                <div className="rv-questions">
                  {analysis.framing_questions.map((q, i) => {
                    const key = 'q_' + i
                    return (
                      <div key={i} className="rv-question">
                        <div className="rv-question-text">{q.question}</div>
                        <div className="rv-question-why">{q.why_asking}</div>
                        <textarea
                          value={framingAnswers[key] || ''}
                          onChange={e => setFramingAnswers({ ...framingAnswers, [key]: e.target.value })}
                          placeholder={q.expected_answer_shape || 'Your answer'}
                          rows={2}
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {analysis.open_questions?.length > 0 && (
              <div className="rv-section">
                <div className="rv-section-label">Open questions raised ({analysis.open_questions.length})</div>
                <ul className="rv-list-plain">
                  {analysis.open_questions.map((q, i) => <li key={i}>{q}</li>)}
                </ul>
              </div>
            )}
          </>
        ) : (
          <div className="rv-empty">No analysis yet for this entry.</div>
        )}
      </div>
    </Modal>
  )
}

// =============================================================================
// STYLES
// =============================================================================

const STYLES = `
.sr-shell { font-family: var(--font-text); color: var(--color-text-primary); padding: 24px 28px 32px; }

.sr-intro {
  font-size: 13px;
  color: var(--color-text-secondary);
  margin-bottom: 20px;
  padding: 12px 16px;
  background: var(--color-bg-subtle);
  border-radius: 8px;
  border-left: 3px solid #F0A742;
  line-height: 1.5;
}
.sr-intro em { font-style: italic; color: var(--color-text-primary); font-weight: 600; }

/* UNDERSTANDING PANEL */
.sr-understanding {
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-hairline);
  border-radius: 12px;
  padding: 18px 20px;
  margin-bottom: 20px;
}
.sr-understanding-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 14px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--color-hairline);
}
.sr-understanding-eyebrow {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.16em;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
}
.sr-understanding-sub {
  font-size: 11px;
  color: var(--color-text-tertiary);
}
.sr-understanding-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin-bottom: 14px;
}
.sr-uc-card {
  padding: 12px 14px;
  background: var(--color-bg-subtle);
  border-radius: 8px;
}
.sr-uc-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.10em;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  margin-bottom: 6px;
}
.sr-uc-value {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 4px;
}
.sr-uc-confidence {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  display: inline-block;
  padding: 2px 8px;
  border-radius: 3px;
  margin-bottom: 6px;
}
.sr-conf-high { color: #2E6B3E; background: rgba(46,107,62,0.10); }
.sr-conf-medium { color: #C77A0F; background: rgba(240,167,66,0.12); }
.sr-conf-low { color: #8B2A1F; background: rgba(139,42,31,0.10); }
.sr-uc-reasoning {
  font-size: 12px;
  color: var(--color-text-secondary);
  line-height: 1.4;
}
.sr-uc-empty {
  font-size: 12px;
  color: var(--color-text-tertiary);
  font-style: italic;
}
.sr-uc-findings, .sr-uc-open-questions { margin-top: 12px; }
.sr-uc-findings-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.10em;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  margin-bottom: 6px;
}
.sr-uc-findings-list {
  list-style: none;
  margin: 0;
  padding: 0;
  font-size: 12px;
  line-height: 1.5;
}
.sr-uc-findings-list li {
  padding: 4px 0;
  color: var(--color-text-secondary);
}
.sr-uc-conf-tag {
  display: inline-block;
  margin-left: 8px;
  font-size: 9px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 2px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.sr-uc-more {
  font-style: italic;
  color: var(--color-text-tertiary) !important;
}

/* CORPUS */
.sr-corpus {
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-hairline);
  border-radius: 12px;
  padding: 18px 20px;
}
.sr-corpus-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
}
.sr-corpus-head h3 { font-size: 14px; font-weight: 600; margin: 0; }
.sr-add-btn {
  background: #F0A742;
  color: #fff;
  border: none;
  padding: 8px 14px;
  border-radius: 8px;
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}
.sr-add-btn:hover { background: #C77A0F; }

.sr-empty { padding: 48px 16px; text-align: center; color: var(--color-text-tertiary); }
.sr-empty-title { font-size: 14px; font-weight: 600; margin-bottom: 6px; color: var(--color-text-secondary); }
.sr-empty-sub { font-size: 12px; max-width: 480px; margin: 0 auto; line-height: 1.5; }

.sr-tier-groups { display: flex; flex-direction: column; gap: 16px; }
.sr-tier-group { }
.sr-tier-header {
  border-left: 3px solid;
  padding: 6px 0 6px 12px;
  margin-bottom: 8px;
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
}
.sr-tier-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--color-text-primary);
  text-transform: uppercase;
}
.sr-tier-desc {
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.sr-entries { list-style: none; margin: 0; padding: 0; }
.sr-entry {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 0;
  border-top: 1px solid var(--color-hairline);
}
.sr-entry:first-child { border-top: none; }
.sr-entry-body { flex: 1; min-width: 0; }
.sr-entry-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 4px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.sr-entry-meta {
  font-size: 11px;
  color: var(--color-text-tertiary);
  display: flex;
  gap: 8px;
}
.sr-entry-summary {
  font-size: 12px;
  color: var(--color-text-secondary);
  line-height: 1.5;
  margin-top: 4px;
  font-style: italic;
}
.sr-entry-actions { display: flex; gap: 6px; align-items: flex-start; }
.sr-status-badge {
  display: inline-block;
  font-size: 9px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 3px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.sr-status-pending { color: var(--color-text-tertiary); background: var(--color-bg-subtle); }
.sr-status-analyzing { color: #C77A0F; background: rgba(240,167,66,0.14); }
.sr-status-review { color: #8B2A1F; background: rgba(139,42,31,0.10); }
.sr-status-reviewed { color: #2E6B3E; background: rgba(46,107,62,0.10); }
.sr-status-error { color: #8B2A1F; background: rgba(139,42,31,0.20); }

.sr-entry-review {
  padding: 4px 10px;
  background: #F0A742;
  border: none;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  color: #fff;
  cursor: pointer;
}
.sr-entry-retry {
  padding: 4px 10px;
  background: #8B2A1F;
  border: none;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  color: #fff;
  cursor: pointer;
}
.sr-entry-delete {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  font-size: 16px;
  color: var(--color-text-tertiary);
  cursor: pointer;
  border-radius: 4px;
}
.sr-entry-delete:hover { color: var(--color-danger); }
`

const DIALOG_STYLES = `
.sr-dlg-body { padding: 4px 0; }

.sr-tier-picker {
  padding: 4px 0;
}
.sr-tier-picker-label {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 4px;
}
.sr-tier-picker-sub {
  font-size: 12px;
  color: var(--color-text-tertiary);
  margin-bottom: 14px;
}
.sr-tier-options {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.sr-tier-option {
  text-align: left;
  background: var(--color-bg-subtle);
  border: 1px solid var(--color-hairline);
  border-left: 4px solid;
  padding: 12px 14px;
  border-radius: 6px;
  cursor: pointer;
  font-family: inherit;
}
.sr-tier-option:hover {
  background: var(--color-bg-elevated);
  border-color: #F0A742;
}
.sr-tier-option-label {
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 3px;
  color: var(--color-text-primary);
}
.sr-tier-option-desc {
  font-size: 12px;
  color: var(--color-text-secondary);
  margin-bottom: 6px;
}
.sr-tier-option-detail {
  font-size: 11px;
  color: var(--color-text-tertiary);
  margin-bottom: 4px;
  line-height: 1.4;
}
.sr-tier-option-examples {
  font-size: 11px;
  color: var(--color-text-tertiary);
  font-style: italic;
}

.sr-selected-tier {
  border: 1px solid var(--color-hairline);
  border-left: 4px solid;
  padding: 10px 14px;
  border-radius: 6px;
  background: var(--color-bg-subtle);
  position: relative;
}
.sr-selected-tier strong { font-size: 13px; }
.sr-selected-tier-detail {
  font-size: 11px;
  color: var(--color-text-tertiary);
  margin-top: 4px;
  line-height: 1.4;
}
.sr-tier-change {
  position: absolute;
  top: 8px;
  right: 10px;
  background: transparent;
  border: 1px solid var(--color-hairline);
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 10px;
  cursor: pointer;
  color: var(--color-text-secondary);
}

.sr-dlg-row { margin-bottom: 14px; }
.sr-dlg-row label {
  display: block;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-tertiary);
  margin-bottom: 4px;
}
.sr-dlg-row input,
.sr-dlg-row select,
.sr-dlg-row textarea {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--color-hairline);
  border-radius: 6px;
  font-family: inherit;
  font-size: 13px;
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  box-sizing: border-box;
}
.sr-dlg-row input:focus,
.sr-dlg-row select:focus,
.sr-dlg-row textarea:focus {
  outline: 1px solid #F0A742;
  border-color: #F0A742;
}

.sr-file-preview {
  margin-top: 8px;
  padding: 8px 10px;
  background: rgba(46,107,62,0.05);
  border: 1px solid rgba(46,107,62,0.20);
  border-radius: 4px;
  font-size: 11px;
  color: var(--color-text-secondary);
}
.sr-file-preview strong {
  color: var(--color-text-primary);
  font-size: 12px;
}
`

const REVIEW_STYLES = `
.rv-shell { padding: 20px 28px 32px; max-width: 900px; }
.rv-section { margin-bottom: 22px; padding-bottom: 18px; border-bottom: 1px solid var(--color-hairline); }
.rv-section:last-child { border-bottom: none; }
.rv-section-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.10em;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  margin-bottom: 6px;
}
.rv-section-sub {
  font-size: 11px;
  color: var(--color-text-tertiary);
  margin-bottom: 10px;
  font-style: italic;
}

.rv-error {
  padding: 14px 16px;
  background: rgba(139,42,31,0.06);
  border: 1px solid rgba(139,42,31,0.30);
  border-radius: 6px;
  color: #8B2A1F;
  font-size: 13px;
}
.rv-error-raw {
  margin-top: 10px;
  padding: 8px;
  background: var(--color-bg-subtle);
  font-size: 11px;
  font-family: 'SF Mono', Menlo, monospace;
  white-space: pre-wrap;
  max-height: 200px;
  overflow: auto;
  border-radius: 4px;
  color: var(--color-text-secondary);
}

.rv-summary {
  font-size: 14px;
  line-height: 1.5;
  color: var(--color-text-primary);
}

.rv-tier-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.rv-tier-pill {
  display: inline-block;
  padding: 4px 12px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  letter-spacing: 0.06em;
}
.rv-tier-reasoning { font-size: 12px; color: var(--color-text-secondary); flex: 1; min-width: 200px; }

.rv-read { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
.rv-read-value { font-size: 16px; font-weight: 600; color: var(--color-text-primary); }
.rv-read-conf {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 3px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.rv-conf-high { color: #2E6B3E; background: rgba(46,107,62,0.10); }
.rv-conf-medium { color: #C77A0F; background: rgba(240,167,66,0.14); }
.rv-conf-low { color: #8B2A1F; background: rgba(139,42,31,0.10); }
.rv-read-reasoning { font-size: 12px; color: var(--color-text-secondary); line-height: 1.5; }

.rv-list { list-style: none; margin: 0; padding: 0; }
.rv-list-plain {
  margin: 0;
  padding-left: 20px;
  font-size: 13px;
  color: var(--color-text-secondary);
  line-height: 1.5;
}
.rv-item {
  padding: 12px 14px;
  background: var(--color-bg-subtle);
  border-radius: 6px;
  margin-bottom: 8px;
  position: relative;
}
.rv-item-critical {
  background: rgba(240,167,66,0.05);
  border: 1px solid rgba(240,167,66,0.20);
}
.rv-item-text { font-size: 13px; color: var(--color-text-primary); margin-bottom: 6px; line-height: 1.5; }
.rv-item-meta { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.rv-item-tag {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 3px;
  background: var(--color-bg-elevated);
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.rv-item-critical-tag {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 3px;
  background: #F0A742;
  color: #fff;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.rv-conf-tag {
  font-size: 9px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 3px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.rv-item-date { font-size: 11px; color: var(--color-text-tertiary); }
.rv-item-link { font-size: 11px; color: #5B7DB8; text-decoration: none; }
.rv-item-link:hover { text-decoration: underline; }
.rv-item-reject {
  position: absolute;
  top: 10px;
  right: 10px;
  background: transparent;
  border: 1px solid var(--color-hairline);
  border-radius: 4px;
  padding: 3px 9px;
  font-size: 10px;
  cursor: pointer;
  color: var(--color-text-tertiary);
}
.rv-item-reject:hover { background: rgba(139,42,31,0.06); color: var(--color-danger); border-color: var(--color-danger); }

.rv-questions { display: flex; flex-direction: column; gap: 12px; }
.rv-question {
  padding: 12px 14px;
  background: var(--color-bg-subtle);
  border-radius: 6px;
}
.rv-question-text {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 4px;
}
.rv-question-why {
  font-size: 11px;
  color: var(--color-text-tertiary);
  margin-bottom: 8px;
  font-style: italic;
}
.rv-question textarea {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--color-hairline);
  border-radius: 4px;
  font-family: inherit;
  font-size: 12px;
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  box-sizing: border-box;
  resize: vertical;
}

.rv-empty {
  padding: 48px 16px;
  text-align: center;
  color: var(--color-text-tertiary);
  font-size: 13px;
}
`
