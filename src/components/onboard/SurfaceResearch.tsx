/**
 * Surface Research workspace — Recon Engine
 *
 * Iterative outcome-managed loop. Three things on the page:
 *   1. CORPUS — running list of evidence entries the consultant adds
 *   2. SCORE — live read of corpus against 6 sufficiency dimensions
 *   3. GENERATE-BRIEF GATE — green when score crosses the bar; red otherwise
 *
 * The consultant adds entries freely (any kind, any order, any number) until
 * the score reads "ready." No fixed sequence. No predefined sources.
 *
 * Gate 4a: heuristic scoring only. Manual paste-in / note / fact entry kinds.
 * Gate 4b will add: HigherGov + USASpending API pulls, file uploads,
 * LLM-judged commentary on what's thin and what would strengthen it.
 */

import { useEffect, useMemo, useState } from 'react'
import { Modal } from '@/components/Modal'
import { Button } from '@/components/Button'
import {
  SurfaceEntry,
  SurfaceEntryKind,
  SignalDimension,
  SufficiencyScore,
  ReconFrame,
  loadSurfaceEntries,
  addSurfaceEntry,
  deleteSurfaceEntry,
  loadSufficiencyScore,
  computeAndSaveSufficiency,
  loadFrame,
} from '@/lib/recon'

interface Props {
  strategicProfileId: string
  tenantId: string
  profileName: string
  onClose: () => void
}

const DIMENSION_META: Record<SignalDimension, { label: string; hint: string }> = {
  market_sizing:     { label: 'Market sizing',      hint: 'Total federal $ in the prospect\'s codes; addressable subset' },
  peer_cohort:       { label: 'Peer cohort',        hint: 'Comparable firms (same NAICS, year, size); their outcomes' },
  vehicle_landscape: { label: 'Vehicle landscape',  hint: 'Active IDIQs, schedules, set-asides; dollar flow per vehicle' },
  agency_map:        { label: 'Agency map',         hint: 'Top buying agencies in the codes; their patterns' },
  doppelganger:      { label: 'Doppelganger vendors', hint: 'Vendors that look like the prospect; what they\'ve won' },
  trajectory:        { label: 'Trajectory',         hint: 'Public-record milestones for THIS prospect (entity, SAM, schedules, awards)' },
}

const ENTRY_KIND_META: Record<SurfaceEntryKind, { label: string; icon: string }> = {
  highergov_pull:   { label: 'HigherGov pull',   icon: '⛁' },
  usaspending_pull: { label: 'USASpending pull', icon: '$' },
  paste_in:         { label: 'Paste-in',         icon: '✎' },
  file_upload:      { label: 'File upload',      icon: '⊕' },
  note:             { label: 'Note',             icon: '⌇' },
  fact:             { label: 'Extracted fact',   icon: '✓' },
}

export function SurfaceResearch({ strategicProfileId, tenantId, profileName, onClose }: Props) {
  const [entries, setEntries] = useState<SurfaceEntry[]>([])
  const [score, setScore] = useState<SufficiencyScore | null>(null)
  const [frame, setFrame] = useState<ReconFrame | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [showAddEntry, setShowAddEntry] = useState(false)
  const [computing, setComputing] = useState(false)

  // ---------------------------------------------------------------------------
  // INITIAL LOAD
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [e, s, f] = await Promise.all([
        loadSurfaceEntries(strategicProfileId),
        loadSufficiencyScore(strategicProfileId),
        loadFrame(strategicProfileId),
      ])
      if (cancelled) return
      setEntries(e)
      setScore(s)
      setFrame(f)
      setLoaded(true)
    })()
    return () => {
      cancelled = true
    }
  }, [strategicProfileId])

  // ---------------------------------------------------------------------------
  // RECOMPUTE SUFFICIENCY when corpus changes
  // ---------------------------------------------------------------------------
  async function recomputeSufficiency(currentEntries: SurfaceEntry[]) {
    setComputing(true)
    const newScore = await computeAndSaveSufficiency(
      tenantId,
      strategicProfileId,
      frame,
      currentEntries,
    )
    if (newScore) setScore(newScore)
    setComputing(false)
  }

  async function handleAddEntry(entry: {
    kind: SurfaceEntryKind
    title: string
    sourceLabel?: string
    sourceUrl?: string
    rawText?: string
    dimensions: SignalDimension[]
  }) {
    const created = await addSurfaceEntry(tenantId, strategicProfileId, {
      title: entry.title,
      entry_kind: entry.kind,
      source_label: entry.sourceLabel,
      source_url: entry.sourceUrl,
      raw_payload: entry.rawText ? { text: entry.rawText } : {},
      signal_dimensions: entry.dimensions,
      extracted_facts: [],
    })
    if (!created) return
    const next = [created, ...entries]
    setEntries(next)
    setShowAddEntry(false)
    await recomputeSufficiency(next)
  }

  async function handleDeleteEntry(id: string) {
    if (!window.confirm('Delete this entry from the corpus?')) return
    const ok = await deleteSurfaceEntry(id)
    if (!ok) return
    const next = entries.filter(e => e.id !== id)
    setEntries(next)
    await recomputeSufficiency(next)
  }

  // ---------------------------------------------------------------------------
  // SUFFICIENCY DISPLAY
  // ---------------------------------------------------------------------------
  const dimensions: SignalDimension[] = useMemo(
    () => ['market_sizing', 'peer_cohort', 'vehicle_landscape', 'agency_map', 'doppelganger', 'trajectory'],
    [],
  )

  const dimensionScores: Record<SignalDimension, number> = score
    ? {
        market_sizing: score.market_sizing_score,
        peer_cohort: score.peer_cohort_score,
        vehicle_landscape: score.vehicle_landscape_score,
        agency_map: score.agency_map_score,
        doppelganger: score.doppelganger_score,
        trajectory: score.trajectory_score,
      }
    : { market_sizing: 0, peer_cohort: 0, vehicle_landscape: 0, agency_map: 0, doppelganger: 0, trajectory: 0 }

  const totalScore = score?.total_score || 0
  const requiredScore = score?.required_score || 12
  const isSufficient = score?.is_sufficient || false

  // ---------------------------------------------------------------------------
  // RENDER
  // ---------------------------------------------------------------------------
  if (!loaded) {
    return (
      <Modal open={true} onClose={onClose} title={`Surface Research · ${profileName}`} size="full">
        <div style={{ padding: 64, textAlign: 'center', color: 'var(--color-text-secondary)' }}>
          Loading corpus…
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={`Surface Research · ${profileName}`}
      size="full"
      footer={
        <>
          <div style={{ flex: 1, fontSize: 12, color: 'var(--color-text-tertiary)' }}>
            {entries.length === 0
              ? 'Add evidence to the corpus until the platform reports it can support a compelling brief.'
              : computing
                ? 'Recomputing sufficiency…'
                : `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'} in the corpus`}
          </div>
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </>
      }
    >
      <style>{STYLES}</style>

      <div className="sr-shell">
        {/* INTRO */}
        <div className="sr-intro">
          <strong>Add evidence freely.</strong> Any source, any order, any number of entries.
          The platform reports when the corpus can support a compelling brief for the chosen Frame.
          You decide when to stop iterating.
        </div>

        {/* SCORE PANEL */}
        <div className={`sr-score-card${isSufficient ? ' ready' : ''}`}>
          <div className="sr-score-head">
            <div>
              <div className="sr-score-eyebrow">SUFFICIENCY READ</div>
              <div className="sr-score-headline">
                {totalScore} of {requiredScore}
                {isSufficient && <span className="sr-score-ready-tag">Ready</span>}
              </div>
              <div className="sr-score-sub">
                {isSufficient
                  ? 'The corpus can support a compelling brief. Proceed to Stones, then generate.'
                  : `Need ${requiredScore - totalScore} more dimension points before generating the brief.`}
              </div>
            </div>
            <div className="sr-score-progress-wrap">
              <div
                className="sr-score-progress-bar"
                style={{ width: `${Math.min(100, (totalScore / requiredScore) * 100)}%` }}
              />
            </div>
          </div>

          <div className="sr-dim-grid">
            {dimensions.map((dim) => {
              const d = dimensionScores[dim]
              const meta = DIMENSION_META[dim]
              return (
                <div key={dim} className="sr-dim">
                  <div className="sr-dim-head">
                    <span className="sr-dim-label">{meta.label}</span>
                    <span className={`sr-dim-score score-${d}`}>{d}/3</span>
                  </div>
                  <div className="sr-dim-pips">
                    {[1, 2, 3].map((n) => (
                      <span key={n} className={`sr-dim-pip${d >= n ? ' filled' : ''}`} />
                    ))}
                  </div>
                  <div className="sr-dim-hint">{meta.hint}</div>
                </div>
              )
            })}
          </div>

          {!frame?.is_complete && (
            <div className="sr-frame-warn">
              Framing the Frame is incomplete. The brief needs all four blocks answered before generation,
              and sufficiency reads against the chosen Frame.
            </div>
          )}
        </div>

        {/* CORPUS */}
        <div className="sr-corpus">
          <div className="sr-corpus-head">
            <h3>Corpus</h3>
            <button
              type="button"
              className="sr-add-btn"
              onClick={() => setShowAddEntry(true)}
            >
              + Add entry
            </button>
          </div>

          {entries.length === 0 ? (
            <div className="sr-empty">
              <div className="sr-empty-title">No entries yet.</div>
              <div className="sr-empty-sub">
                Click <strong>+ Add entry</strong> to drop in a HigherGov pull, USASpending query result,
                paste-in from a market report, or your own observation note.
              </div>
            </div>
          ) : (
            <ul className="sr-entries">
              {entries.map((e) => (
                <li key={e.id} className="sr-entry">
                  <div className="sr-entry-icon">{ENTRY_KIND_META[e.entry_kind].icon}</div>
                  <div className="sr-entry-body">
                    <div className="sr-entry-title">{e.title}</div>
                    <div className="sr-entry-meta">
                      <span className="sr-entry-kind">{ENTRY_KIND_META[e.entry_kind].label}</span>
                      {e.source_label && <span className="sr-entry-source">· {e.source_label}</span>}
                      <span className="sr-entry-date">
                        · {new Date(e.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    {e.signal_dimensions.length > 0 && (
                      <div className="sr-entry-dims">
                        {e.signal_dimensions.map((d) => (
                          <span key={d} className="sr-entry-dim">
                            {DIMENSION_META[d].label}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    className="sr-entry-delete"
                    onClick={() => handleDeleteEntry(e.id)}
                    aria-label="Delete entry"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {showAddEntry && (
        <AddEntryDialog
          onCancel={() => setShowAddEntry(false)}
          onSubmit={handleAddEntry}
        />
      )}
    </Modal>
  )
}

// =============================================================================
// ADD ENTRY DIALOG
// =============================================================================
function AddEntryDialog({
  onCancel, onSubmit,
}: {
  onCancel: () => void
  onSubmit: (entry: {
    kind: SurfaceEntryKind
    title: string
    sourceLabel?: string
    sourceUrl?: string
    rawText?: string
    dimensions: SignalDimension[]
  }) => void
}) {
  const [kind, setKind] = useState<SurfaceEntryKind>('paste_in')
  const [title, setTitle] = useState('')
  const [sourceLabel, setSourceLabel] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [rawText, setRawText] = useState('')
  const [selectedDims, setSelectedDims] = useState<Set<SignalDimension>>(new Set())

  const dimensions: SignalDimension[] = [
    'market_sizing', 'peer_cohort', 'vehicle_landscape', 'agency_map', 'doppelganger', 'trajectory',
  ]

  function toggleDim(d: SignalDimension) {
    setSelectedDims((prev) => {
      const next = new Set(prev)
      if (next.has(d)) next.delete(d)
      else next.add(d)
      return next
    })
  }

  function handleSubmit() {
    if (!title.trim()) return
    onSubmit({
      kind,
      title: title.trim(),
      sourceLabel: sourceLabel.trim() || undefined,
      sourceUrl: sourceUrl.trim() || undefined,
      rawText: rawText.trim() || undefined,
      dimensions: Array.from(selectedDims),
    })
  }

  // The pull kinds are stubbed for gate 4a — they'll be wired to actual API
  // calls in gate 4b. For now, the consultant pastes results manually.
  const isPullKind = kind === 'highergov_pull' || kind === 'usaspending_pull'

  return (
    <div className="sr-dialog-backdrop" onClick={onCancel}>
      <div className="sr-dialog" onClick={(e) => e.stopPropagation()}>
        <h3 className="sr-dialog-title">Add corpus entry</h3>

        <div className="sr-dialog-row">
          <label>Entry kind</label>
          <select value={kind} onChange={(e) => setKind(e.target.value as SurfaceEntryKind)}>
            <option value="paste_in">Paste-in (text from a market report, search result, etc.)</option>
            <option value="note">Note (your own observation or synthesis)</option>
            <option value="fact">Extracted fact (a single specific claim with a value)</option>
            <option value="highergov_pull">HigherGov pull (stub — API integration in gate 4b)</option>
            <option value="usaspending_pull">USASpending pull (stub — API integration in gate 4b)</option>
          </select>
        </div>

        {isPullKind && (
          <div className="sr-dialog-warn">
            API integration for {ENTRY_KIND_META[kind].label} arrives in gate 4b. For now, run the
            query manually and paste the result into the text field below.
          </div>
        )}

        <div className="sr-dialog-row">
          <label>Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Short summary of what this entry contains"
          />
        </div>

        <div className="sr-dialog-row">
          <label>Source label (optional)</label>
          <input
            type="text"
            value={sourceLabel}
            onChange={(e) => setSourceLabel(e.target.value)}
            placeholder='e.g. "USASpending FY24-26 NAICS 541512" or "Gartner 2024 report"'
          />
        </div>

        <div className="sr-dialog-row">
          <label>Source URL (optional)</label>
          <input
            type="url"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://..."
          />
        </div>

        <div className="sr-dialog-row">
          <label>Content (optional)</label>
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder="Paste the data, extract, or full text here. The brief generator will pull from this in gate 4b."
            rows={5}
          />
        </div>

        <div className="sr-dialog-row">
          <label>Which dimensions does this contribute to?</label>
          <div className="sr-dim-checks">
            {dimensions.map((d) => (
              <label key={d} className={`sr-dim-check${selectedDims.has(d) ? ' checked' : ''}`}>
                <input
                  type="checkbox"
                  checked={selectedDims.has(d)}
                  onChange={() => toggleDim(d)}
                />
                {DIMENSION_META[d].label}
              </label>
            ))}
          </div>
          <div className="sr-dim-hint-row">
            Selecting dimensions tells the sufficiency scorer which gaps this entry fills.
          </div>
        </div>

        <div className="sr-dialog-actions">
          <button type="button" className="sr-dialog-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="sr-dialog-save"
            disabled={!title.trim()}
            onClick={handleSubmit}
          >
            Add to corpus
          </button>
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// STYLES
// =============================================================================
const STYLES = `
.sr-shell {
  font-family: var(--font-text);
  color: var(--color-text-primary);
  padding: 24px 28px 32px;
}

.sr-intro {
  font-size: 13px;
  color: var(--color-text-secondary);
  margin-bottom: 20px;
  padding: 12px 16px;
  background: var(--color-bg-subtle);
  border-radius: 8px;
  border-left: 3px solid #F0A742;
}

/* SCORE CARD */
.sr-score-card {
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-hairline);
  border-radius: 12px;
  padding: 20px 24px;
  margin-bottom: 24px;
}
.sr-score-card.ready {
  border-color: rgba(46,107,62,0.4);
  background: rgba(46,107,62,0.02);
}

.sr-score-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 24px;
  margin-bottom: 18px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--color-hairline);
}

.sr-score-eyebrow {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.16em;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  margin-bottom: 6px;
}

.sr-score-headline {
  font-size: 32px;
  font-weight: 700;
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  display: flex;
  align-items: center;
  gap: 12px;
}

.sr-score-ready-tag {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: #fff;
  background: #2E6B3E;
  padding: 4px 10px;
  border-radius: 4px;
  text-transform: uppercase;
}

.sr-score-sub {
  font-size: 12px;
  color: var(--color-text-tertiary);
  margin-top: 4px;
}

.sr-score-progress-wrap {
  flex: 0 0 240px;
  height: 8px;
  background: var(--color-bg-subtle);
  border-radius: 4px;
  overflow: hidden;
  margin-top: 28px;
}

.sr-score-progress-bar {
  height: 100%;
  background: linear-gradient(90deg, #F0A742, #2E6B3E);
  transition: width .3s ease;
}

.sr-dim-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 14px;
}

.sr-dim {
  padding: 12px 14px;
  background: var(--color-bg-subtle);
  border-radius: 8px;
}

.sr-dim-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 6px;
}

.sr-dim-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.sr-dim-score {
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  padding: 2px 6px;
  border-radius: 3px;
}
.sr-dim-score.score-0 { color: var(--color-text-tertiary); background: transparent; }
.sr-dim-score.score-1 { color: #C77A0F; background: rgba(240,167,66,0.10); }
.sr-dim-score.score-2 { color: #C77A0F; background: rgba(240,167,66,0.18); }
.sr-dim-score.score-3 { color: #2E6B3E; background: rgba(46,107,62,0.14); }

.sr-dim-pips {
  display: flex;
  gap: 4px;
  margin-bottom: 6px;
}
.sr-dim-pip {
  flex: 1;
  height: 4px;
  background: var(--color-hairline);
  border-radius: 2px;
}
.sr-dim-pip.filled { background: #F0A742; }
.sr-dim-pip.filled:nth-last-child(-n+1) { background: #2E6B3E; }

.sr-dim-hint {
  font-size: 11px;
  color: var(--color-text-tertiary);
  line-height: 1.4;
}

.sr-frame-warn {
  margin-top: 16px;
  padding: 10px 14px;
  background: rgba(240,167,66,0.08);
  border: 1px solid rgba(240,167,66,0.30);
  border-radius: 8px;
  font-size: 12px;
  color: #8C5208;
}

/* CORPUS */
.sr-corpus {
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-hairline);
  border-radius: 12px;
  padding: 20px 24px;
}

.sr-corpus-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.sr-corpus-head h3 {
  font-size: 14px;
  font-weight: 600;
  margin: 0;
}

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

.sr-empty {
  padding: 48px 16px;
  text-align: center;
  color: var(--color-text-tertiary);
}
.sr-empty-title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 6px;
  color: var(--color-text-secondary);
}
.sr-empty-sub {
  font-size: 12px;
  max-width: 480px;
  margin: 0 auto;
  line-height: 1.5;
}

.sr-entries {
  list-style: none;
  margin: 0;
  padding: 0;
}

.sr-entry {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 0;
  border-top: 1px solid var(--color-hairline);
}
.sr-entry:first-child { border-top: none; padding-top: 0; }

.sr-entry-icon {
  flex: 0 0 28px;
  width: 28px;
  height: 28px;
  background: var(--color-bg-subtle);
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: var(--color-text-secondary);
}

.sr-entry-body { flex: 1; min-width: 0; }

.sr-entry-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 3px;
}

.sr-entry-meta {
  font-size: 11px;
  color: var(--color-text-tertiary);
  margin-bottom: 6px;
}

.sr-entry-kind {
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.sr-entry-dims {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.sr-entry-dim {
  font-size: 10px;
  font-weight: 500;
  padding: 2px 8px;
  background: rgba(240,167,66,0.10);
  color: #C77A0F;
  border-radius: 10px;
}

.sr-entry-delete {
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  font-size: 18px;
  color: var(--color-text-tertiary);
  cursor: pointer;
  border-radius: 4px;
}
.sr-entry-delete:hover {
  color: var(--color-danger);
  background: rgba(139,42,31,0.06);
}

/* ADD-ENTRY DIALOG */
.sr-dialog-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  z-index: 500;
  padding: 48px 16px;
  overflow: auto;
}

.sr-dialog {
  background: var(--color-bg-elevated);
  border-radius: 12px;
  padding: 24px 28px;
  width: 100%;
  max-width: 640px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.25);
}

.sr-dialog-title {
  font-size: 16px;
  font-weight: 600;
  margin: 0 0 18px;
  letter-spacing: -0.011em;
}

.sr-dialog-row {
  margin-bottom: 14px;
}

.sr-dialog-row label {
  display: block;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-tertiary);
  margin-bottom: 4px;
}

.sr-dialog-row input,
.sr-dialog-row select,
.sr-dialog-row textarea {
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
.sr-dialog-row input:focus,
.sr-dialog-row select:focus,
.sr-dialog-row textarea:focus {
  outline: 1px solid
