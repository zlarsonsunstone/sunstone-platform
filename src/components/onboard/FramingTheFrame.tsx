/**
 * Framing the Frame — Recon Engine intake Q&A
 *
 * Gate 4a: 4-block Q&A intake (Purpose / Sizing / Engagement Openness / Persona)
 * Gate 4b: Adds Block 5 (Persona + approach — free-text "Zack's call") and
 *          Block 6 (Market State selector). These are the v1 axis-classification
 *          inputs. Per the architecture pivot locked yesterday: Zack is the classifier
 *          for v1; calibration after 20-25 prospects determines whether to automate.
 *
 * The new fields are NOT required for is_complete — the brief generator can
 * render with reduced specificity if they are absent. But populated, they drive
 * conditional profile lookup and persona-specific brief content.
 *
 * Autosave: 1.5s debounce on every answer change. Save indicator at top right.
 */

import { useEffect, useRef, useState } from 'react'
import { Modal } from '@/components/Modal'
import { Button } from '@/components/Button'
import {
  ReconPersona,
  FramePurpose,
  FrameCompanySize,
  FrameEngagementOpenness,
  MarketState,
  loadFrame,
  upsertFrame,
  loadPersonas,
  addCustomPersona,
} from '@/lib/recon'

interface Props {
  strategicProfileId: string
  tenantId: string
  profileName: string
  onClose: () => void
  onCompleted?: () => void
}

const PURPOSE_OPTIONS: { value: FramePurpose; label: string; hint: string }[] = [
  { value: 'educate',           label: 'Educate',                 hint: 'They need to understand federal mechanics before they can decide.' },
  { value: 'convince',          label: 'Convince / persuade',     hint: 'They have skepticism. Brief should overcome a specific objection or pattern.' },
  { value: 'show_market_demand',label: 'Show evidence of market demand', hint: 'They doubt the market exists at scale. Brief sizes it.' },
  { value: 'show_market_state', label: 'Show evidence of market state',  hint: 'They believe market is one way; brief reframes what it actually is.' },
]

const SIZE_OPTIONS: { value: FrameCompanySize; label: string; hint: string }[] = [
  { value: 'micro',      label: 'Micro',       hint: 'Under $1M revenue. Cost-sensitive. Modest absolute upside lands.' },
  { value: 'small',      label: 'Small',       hint: '$1M – $10M. Step-function growth needed. Mid-six-figure upside compelling.' },
  { value: 'midmarket',  label: 'Mid-market',  hint: '$10M – $100M. Multi-million upside required. Strategic decisions involve a board.' },
  { value: 'enterprise', label: 'Enterprise',  hint: '$100M+. Eight-figure addressable upside. Multiple stakeholder buy-in needed.' },
]

const ENGAGEMENT_OPTIONS: { value: FrameEngagementOpenness; label: string; hint: string }[] = [
  { value: 'sun_only',       label: 'Sunstone only (start lean)',           hint: 'Stones 1-2. No Steptoe. Lower commitment, slower path.' },
  { value: 'sun_then_step',  label: 'Sunstone now, Steptoe when proven',    hint: 'Ladder up. Start with Sun, expand to full ecosystem on Stone outcomes.' },
  { value: 'full_ecosystem', label: 'Full Sun + Step ecosystem from day one', hint: 'Stones 1-4. Steptoe activated immediately.' },
]

const MARKET_STATE_OPTIONS: { value: MarketState; label: string; hint: string }[] = [
  { value: 'mature_defined',      label: 'Mature & Defined',     hint: 'Established market, clear vehicles, vocabulary stable. Competition shapes wins.' },
  { value: 'mature_diffuse',      label: 'Mature & Diffuse',     hint: 'Real demand, scattered vocabulary. Bedsheet pursuits sat here. Reconstruction work.' },
  { value: 'emerging',            label: 'Emerging',             hint: 'Vocabulary lags 3-5 years behind technology. Architect plays land.' },
  { value: 'recently_legislated', label: 'Recently Legislated',  hint: 'Calendar/statute window. Fresh appropriations or new mandates driving spend.' },
  { value: 'novel',               label: 'Novel',                hint: 'Pre-vocabulary. No federal buy pattern yet. Education before procurement.' },
]

export function FramingTheFrame({ strategicProfileId, tenantId, profileName, onClose, onCompleted }: Props) {
  const [loaded, setLoaded] = useState(false)
  const [personas, setPersonas] = useState<ReconPersona[]>([])

  // Block 1 — Purpose
  const [purpose, setPurpose] = useState<FramePurpose>('unset')
  const [purposeNotes, setPurposeNotes] = useState('')

  // Block 2 — Sizing & receptivity
  const [companySize, setCompanySize] = useState<FrameCompanySize>('unset')
  const [receptivityNotes, setReceptivityNotes] = useState('')

  // Block 3 — Engagement openness
  const [engagementOpenness, setEngagementOpenness] = useState<FrameEngagementOpenness>('unset')
  const [engagementNotes, setEngagementNotes] = useState('')

  // Block 4 — Persona (selectable)
  const [personaId, setPersonaId] = useState<string | null>(null)
  const [showAddPersona, setShowAddPersona] = useState(false)
  const [newPersonaName, setNewPersonaName] = useState('')
  const [newPersonaDesc, setNewPersonaDesc] = useState('')

  // Block 5 (gate 4b) — Persona + approach (Zack's call) free-text
  const [humanClassification, setHumanClassification] = useState('')

  // Block 6 (gate 4b) — Market state classification
  const [marketState, setMarketState] = useState<MarketState | null>(null)

  const [saveState, setSaveState] = useState<'idle' | 'editing' | 'saving' | 'saved' | 'error'>('idle')
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previouslyComplete = useRef(false)

  // ---------------------------------------------------------------------------
  // INITIAL LOAD
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [f, ps] = await Promise.all([loadFrame(strategicProfileId), loadPersonas()])
      if (cancelled) return
      setPersonas(ps)
      if (f) {
        setPurpose(f.purpose)
        setPurposeNotes(f.purpose_notes || '')
        setCompanySize(f.company_size_band)
        setReceptivityNotes(f.receptivity_notes || '')
        setEngagementOpenness(f.engagement_openness)
        setEngagementNotes(f.engagement_notes || '')
        setPersonaId(f.persona_id)
        setHumanClassification(f.human_classification || '')
        setMarketState(f.market_state || null)
        previouslyComplete.current = f.is_complete
      }
      setLoaded(true)
    })()
    return () => {
      cancelled = true
    }
  }, [strategicProfileId])

  // ---------------------------------------------------------------------------
  // AUTOSAVE (1.5s debounce on any change)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!loaded) return
    setSaveState('editing')
    if (debounceTimer.current) clearTimeout(debounceTimer.current)

    debounceTimer.current = setTimeout(async () => {
      setSaveState('saving')
      const updated = await upsertFrame(tenantId, strategicProfileId, {
        purpose,
        purpose_notes: purposeNotes || null,
        company_size_band: companySize,
        receptivity_notes: receptivityNotes || null,
        engagement_openness: engagementOpenness,
        engagement_notes: engagementNotes || null,
        persona_id: personaId,
        human_classification: humanClassification || null,
        market_state: marketState,
      })
      if (!updated) {
        setSaveState('error')
        return
      }
      setSaveState('saved')
      if (updated.is_complete && !previouslyComplete.current) {
        previouslyComplete.current = true
        onCompleted?.()
      }
    }, 1500)

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
    }
  }, [
    loaded, tenantId, strategicProfileId,
    purpose, purposeNotes, companySize, receptivityNotes,
    engagementOpenness, engagementNotes, personaId,
    humanClassification, marketState,
    onCompleted,
  ])

  // ---------------------------------------------------------------------------
  // PERSONA ADD-NEW
  // ---------------------------------------------------------------------------
  async function handleAddPersona() {
    const trimmed = newPersonaName.trim()
    if (!trimmed) return
    const created = await addCustomPersona(trimmed, newPersonaDesc.trim())
    if (!created) return
    setPersonas(prev => [...prev, created])
    setPersonaId(created.id)
    setShowAddPersona(false)
    setNewPersonaName('')
    setNewPersonaDesc('')
  }

  // ---------------------------------------------------------------------------
  // RENDER HELPERS
  // ---------------------------------------------------------------------------
  function saveIndicator() {
    const labels: Record<typeof saveState, string> = {
      idle:    'Idle',
      editing: 'Editing — autosave in 1.5s',
      saving:  'Saving…',
      saved:   '✓ Saved',
      error:   '✗ Save error',
    }
    const colors: Record<typeof saveState, string> = {
      idle:    'var(--color-text-tertiary)',
      editing: 'var(--color-text-secondary)',
      saving:  'var(--color-text-secondary)',
      saved:   '#2E6B3E',
      error:   '#9B3838',
    }
    return (
      <span style={{ fontSize: 12, color: colors[saveState], fontWeight: 500 }}>
        {labels[saveState]}
      </span>
    )
  }

  if (!loaded) {
    return (
      <Modal open={true} onClose={onClose} title={`Framing the Frame · ${profileName}`} size="full">
        <div style={{ padding: 64, textAlign: 'center', color: 'var(--color-text-secondary)' }}>
          Loading frame…
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={`Framing the Frame · ${profileName}`}
      size="full"
      footer={
        <>
          <div style={{ flex: 1 }}>{saveIndicator()}</div>
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </>
      }
    >
      <style>{STYLES}</style>

      <div className="ftf-shell">
        <div className="ftf-intro">
          <strong>Six blocks.</strong> Answer in any order. Autosaves as you go.
          The first four define the editorial frame the brief renders against.
          Blocks 5–6 (Zack's classification call + market state) drive axis-coded
          conditional profile lookup at brief generation time.
        </div>

        {/* BLOCK 1 — PURPOSE */}
        <section className="ftf-block">
          <div className="ftf-block-num">01</div>
          <div className="ftf-block-body">
            <h3 className="ftf-q">What is this brief for?</h3>
            <p className="ftf-q-hint">The purpose anchors the editorial spine. Pick the dominant one; secondary purposes get notes below.</p>
            <div className="ftf-options">
              {PURPOSE_OPTIONS.map(opt => (
                <label key={opt.value} className={`ftf-opt${purpose === opt.value ? ' selected' : ''}`}>
                  <input
                    type="radio"
                    name="purpose"
                    checked={purpose === opt.value}
                    onChange={() => setPurpose(opt.value)}
                  />
                  <div>
                    <div className="ftf-opt-label">{opt.label}</div>
                    <div className="ftf-opt-hint">{opt.hint}</div>
                  </div>
                </label>
              ))}
            </div>
            <textarea
              className="ftf-notes"
              placeholder="Notes on purpose (optional) — secondary purposes, specific angle, what NOT to do…"
              value={purposeNotes}
              onChange={e => setPurposeNotes(e.target.value)}
              rows={2}
            />
          </div>
        </section>

        {/* BLOCK 2 — SIZING & RECEPTIVITY */}
        <section className="ftf-block">
          <div className="ftf-block-num">02</div>
          <div className="ftf-block-body">
            <h3 className="ftf-q">What scale of evidence will land for this prospect?</h3>
            <p className="ftf-q-hint">Determines how to size dollar references, peer cohorts, and award rings. A $5M opportunity reads compellingly to a small firm; the same number reads small to a midmarket firm.</p>
            <div className="ftf-options">
              {SIZE_OPTIONS.map(opt => (
                <label key={opt.value} className={`ftf-opt${companySize === opt.value ? ' selected' : ''}`}>
                  <input
                    type="radio"
                    name="company_size"
                    checked={companySize === opt.value}
                    onChange={() => setCompanySize(opt.value)}
                  />
                  <div>
                    <div className="ftf-opt-label">{opt.label}</div>
                    <div className="ftf-opt-hint">{opt.hint}</div>
                  </div>
                </label>
              ))}
            </div>
            <textarea
              className="ftf-notes"
              placeholder="Receptivity notes — what evidence patterns specifically resonate with this prospect's decision-makers…"
              value={receptivityNotes}
              onChange={e => setReceptivityNotes(e.target.value)}
              rows={2}
            />
          </div>
        </section>

        {/* BLOCK 3 — ENGAGEMENT OPENNESS */}
        <section className="ftf-block">
          <div className="ftf-block-num">03</div>
          <div className="ftf-block-body">
            <h3 className="ftf-q">Are they open to the full Sunstone + Steptoe ecosystem, or starting lean?</h3>
            <p className="ftf-q-hint">Drives Stones recommendation. Lean prospects get Stones 1-2 emphasized; full-ecosystem prospects see all four with Steptoe burgundy active.</p>
            <div className="ftf-options">
              {ENGAGEMENT_OPTIONS.map(opt => (
                <label key={opt.value} className={`ftf-opt${engagementOpenness === opt.value ? ' selected' : ''}`}>
                  <input
                    type="radio"
                    name="engagement_openness"
                    checked={engagementOpenness === opt.value}
                    onChange={() => setEngagementOpenness(opt.value)}
                  />
                  <div>
                    <div className="ftf-opt-label">{opt.label}</div>
                    <div className="ftf-opt-hint">{opt.hint}</div>
                  </div>
                </label>
              ))}
            </div>
            <textarea
              className="ftf-notes"
              placeholder="Engagement notes — known budget constraints, timeline pressure, prior consultant history (intake context only — does not appear in brief)…"
              value={engagementNotes}
              onChange={e => setEngagementNotes(e.target.value)}
              rows={2}
            />
          </div>
        </section>

        {/* BLOCK 4 — PERSONA */}
        <section className="ftf-block">
          <div className="ftf-block-num">04</div>
          <div className="ftf-block-body">
            <h3 className="ftf-q">Which persona best describes this prospect?</h3>
            <p className="ftf-q-hint">Drives narrative tone, evidence selection, BLUF posture, and the "What about..." page content. Selectable from the canonical 9, expandable when you encounter a new type.</p>
            <div className="ftf-personas">
              {personas.map(p => (
                <label key={p.id} className={`ftf-persona${personaId === p.id ? ' selected' : ''}`}>
                  <input
                    type="radio"
                    name="persona"
                    checked={personaId === p.id}
                    onChange={() => setPersonaId(p.id)}
                  />
                  <div>
                    <div className="ftf-persona-name">
                      {p.name}
                      {!p.is_seeded && <span className="ftf-custom-tag">CUSTOM</span>}
                      {p.axis_code_pattern && (
                        <span className="ftf-axis-tag">{p.axis_code_pattern}</span>
                      )}
                    </div>
                    <div className="ftf-persona-desc">{p.description}</div>
                  </div>
                </label>
              ))}
            </div>
            <div className="ftf-add-persona-wrap">
              {!showAddPersona ? (
                <button type="button" className="ftf-add-link" onClick={() => setShowAddPersona(true)}>
                  + Add a new persona
                </button>
              ) : (
                <div className="ftf-add-persona-form">
                  <input
                    type="text"
                    placeholder="Persona name (e.g. 'Recently acquired')"
                    value={newPersonaName}
                    onChange={e => setNewPersonaName(e.target.value)}
                  />
                  <textarea
                    placeholder="Short description — what makes this prospect type distinct"
                    value={newPersonaDesc}
                    onChange={e => setNewPersonaDesc(e.target.value)}
                    rows={2}
                  />
                  <div className="ftf-add-persona-actions">
                    <button type="button" className="ftf-cancel" onClick={() => setShowAddPersona(false)}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="ftf-save"
                      disabled={!newPersonaName.trim()}
                      onClick={handleAddPersona}
                    >
                      Add persona
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* BLOCK 5 — PERSONA + APPROACH (ZACK'S CALL) — gate 4b */}
        <section className="ftf-block ftf-block-gate4b">
          <div className="ftf-block-num">05</div>
          <div className="ftf-block-body">
            <h3 className="ftf-q">Persona + approach <span className="ftf-q-tag">v1 classifier</span></h3>
            <p className="ftf-q-hint">
              Free-text. Your read of who this prospect is and how to approach the brief.
              In v1 this is the canonical input the brief generator uses to drive narrative tone,
              evidence selection, and "What about..." page content. Mention specific levers
              ("mirror their pursuit math against parallel sole-source landscape"),
              specific framings to avoid ("don't lean on past performance — they have none"),
              specific things to feature ("emphasize FAR 19.7 subcontracting").
            </p>
            <textarea
              className="ftf-notes ftf-notes-large"
              placeholder="Example: 'Successful Know-it-All in a Mature & Defined market. Don't argue. Mirror their pursuit math (83% F&O competitions, ask their win rate, calculate spend-to-lose). Show parallel sole-source landscape going to firms with their exact profile. Red-pill structure. They decide.'"
              value={humanClassification}
              onChange={e => setHumanClassification(e.target.value)}
              rows={5}
            />
          </div>
        </section>

        {/* BLOCK 6 — MARKET STATE — gate 4b */}
        <section className="ftf-block ftf-block-gate4b">
          <div className="ftf-block-num">06</div>
          <div className="ftf-block-body">
            <h3 className="ftf-q">Market state <span className="ftf-q-tag">v1 classifier</span></h3>
            <p className="ftf-q-hint">
              How developed is the federal market for what this prospect sells?
              Pairs with the persona to look up the conditional profile in the brief generator.
            </p>
            <div className="ftf-options">
              {MARKET_STATE_OPTIONS.map(opt => (
                <label key={opt.value} className={`ftf-opt${marketState === opt.value ? ' selected' : ''}`}>
                  <input
                    type="radio"
                    name="market_state"
                    checked={marketState === opt.value}
                    onChange={() => setMarketState(opt.value)}
                  />
                  <div>
                    <div className="ftf-opt-label">{opt.label}</div>
                    <div className="ftf-opt-hint">{opt.hint}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </section>
      </div>
    </Modal>
  )
}

// =============================================================================
// STYLES
// =============================================================================
const STYLES = `
.ftf-shell {
  font-family: var(--font-text);
  color: var(--color-text-primary);
  padding: 24px 28px 32px;
  max-width: 920px;
  margin: 0 auto;
}

.ftf-intro {
  font-size: 13px;
  color: var(--color-text-secondary);
  margin-bottom: 24px;
  padding: 12px 16px;
  background: var(--color-bg-subtle);
  border-radius: 8px;
  border-left: 3px solid #F0A742;
}

.ftf-block {
  display: flex;
  gap: 20px;
  margin-bottom: 28px;
  padding-bottom: 28px;
  border-bottom: 1px solid var(--color-hairline);
}
.ftf-block:last-child { border-bottom: none; }

.ftf-block-gate4b {
  background: rgba(240,167,66,0.04);
  border-radius: 8px;
  padding: 20px 16px 28px;
  margin-left: -16px;
  margin-right: -16px;
  border-bottom: 1px solid var(--color-hairline);
}
.ftf-block-gate4b .ftf-block-num {
  background: #F0A742;
  color: #fff;
}

.ftf-block-num {
  flex: 0 0 36px;
  width: 36px;
  height: 36px;
  border-radius: 18px;
  background: var(--color-bg-subtle);
  color: var(--color-text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.ftf-block-body { flex: 1; min-width: 0; }

.ftf-q {
  font-size: 16px;
  font-weight: 600;
  margin: 0 0 6px;
  letter-spacing: -0.011em;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.ftf-q-tag {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: #C77A0F;
  background: rgba(240,167,66,0.14);
  padding: 3px 8px;
  border-radius: 3px;
  text-transform: uppercase;
}

.ftf-q-hint {
  font-size: 12px;
  color: var(--color-text-tertiary);
  margin: 0 0 14px;
  line-height: 1.5;
}

.ftf-options {
  display: grid;
  gap: 8px;
  margin-bottom: 12px;
}

.ftf-opt {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 10px 12px;
  border: 1px solid var(--color-hairline);
  border-radius: 8px;
  cursor: pointer;
  background: var(--color-bg-elevated);
  transition: all .15s ease;
}
.ftf-opt:hover { border-color: var(--color-text-tertiary); }
.ftf-opt.selected {
  border-color: #F0A742;
  background: rgba(240,167,66,0.06);
}
.ftf-opt input { margin-top: 4px; cursor: pointer; }

.ftf-opt-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
}
.ftf-opt-hint {
  font-size: 11px;
  color: var(--color-text-tertiary);
  margin-top: 2px;
  line-height: 1.4;
}

.ftf-personas {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 6px;
  margin-bottom: 12px;
}

.ftf-persona {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 8px 10px;
  border: 1px solid var(--color-hairline);
  border-radius: 6px;
  cursor: pointer;
  background: var(--color-bg-elevated);
  transition: all .15s ease;
}
.ftf-persona:hover { border-color: var(--color-text-tertiary); }
.ftf-persona.selected {
  border-color: #F0A742;
  background: rgba(240,167,66,0.06);
}
.ftf-persona input { margin-top: 3px; cursor: pointer; }

.ftf-persona-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-primary);
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.ftf-custom-tag {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--color-text-tertiary);
  background: var(--color-bg-subtle);
  padding: 1px 5px;
  border-radius: 3px;
}
.ftf-axis-tag {
  font-size: 10px;
  font-weight: 600;
  font-family: 'SF Mono', Menlo, monospace;
  color: #C77A0F;
  background: rgba(240,167,66,0.10);
  padding: 1px 5px;
  border-radius: 3px;
}
.ftf-persona-desc {
  font-size: 11px;
  color: var(--color-text-tertiary);
  margin-top: 2px;
  line-height: 1.4;
}

.ftf-notes {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--color-hairline);
  border-radius: 6px;
  font-family: inherit;
  font-size: 12px;
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  resize: vertical;
  box-sizing: border-box;
}
.ftf-notes:focus {
  outline: 1px solid #F0A742;
  border-color: #F0A742;
}

.ftf-notes-large {
  font-size: 13px;
  min-height: 100px;
}

.ftf-add-persona-wrap { margin-top: 8px; }

.ftf-add-link {
  background: none;
  border: none;
  font-family: inherit;
  font-size: 12px;
  color: #C77A0F;
  cursor: pointer;
  padding: 4px 0;
  font-weight: 500;
}
.ftf-add-link:hover { text-decoration: underline; }

.ftf-add-persona-form {
  margin-top: 8px;
  padding: 12px;
  background: var(--color-bg-subtle);
  border-radius: 8px;
  display: grid;
  gap: 8px;
}
.ftf-add-persona-form input,
.ftf-add-persona-form textarea {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--color-hairline);
  border-radius: 4px;
  font-family: inherit;
  font-size: 12px;
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  box-sizing: border-box;
}

.ftf-add-persona-actions {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
}

.ftf-cancel,
.ftf-save {
  padding: 6px 12px;
  border-radius: 4px;
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  border: none;
}
.ftf-cancel {
  background: transparent;
  color: var(--color-text-secondary);
  border: 1px solid var(--color-hairline);
}
.ftf-save {
  background: #F0A742;
  color: #fff;
  font-weight: 600;
}
.ftf-save:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
`
