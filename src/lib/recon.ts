/**
 * Conversion Hypothesis — Recon Engine intake (Pillar 2 of Gate 4c)
 *
 * The editorial spine of the brief. While Framing the Frame captures HOW to
 * speak to the prospect (purpose, tone, persona, market state), this captures
 * WHAT specific evidence will close them.
 *
 * Frame shapes voice. Hypothesis shapes content.
 *
 * Six blocks:
 *   01 — Closing proof (REQUIRED)         — what specific evidence forces a yes
 *   02 — Supporting context               — sources, signals, named officials
 *   03 — Primary objections + counters    — what they'll push back with
 *   04 — Opening hook                     — what gets them to next conversation
 *   05 — Engagement risks + mitigations   — where this could go sideways
 *   06 — Success criteria + fallback      — what counts as a win, plan B
 *
 * Required-field doctrine: only Block 01 (closing_proof) is required for
 * is_complete. Everything else is optional context that enriches the brief.
 *
 * Schema: v2.conversion_hypothesis (migration 0029)
 *
 * Autosave: 1.5s debounce on every change. Same pattern as FramingTheFrame.
 */

import { useEffect, useRef, useState } from 'react'
import { Modal } from '@/components/Modal'
import { Button } from '@/components/Button'
import { supabase } from '@/lib/supabase'

// =============================================================================
// TYPES
// =============================================================================

export interface ObjectionItem {
  text: string
  counter?: string
}

export interface RiskItem {
  text: string
  mitigation?: string
}

export interface ConversionHypothesisRow {
  id: string
  tenant_id: string
  strategic_profile_id: string
  closing_proof: string
  closing_proof_notes: string | null
  primary_objections: ObjectionItem[] | null
  opening_hook: string | null
  engagement_risks: RiskItem[] | null
  success_criteria: string | null
  fallback_strategy: string | null
  is_complete: boolean
  completed_at: string | null
  created_at: string
  updated_at: string
  created_by: string | null
}

interface Props {
  strategicProfileId: string
  tenantId: string
  profileName: string
  onClose: () => void
  onCompleted?: () => void
}

// =============================================================================
// COMPONENT
// =============================================================================

export function ConversionHypothesis({
  strategicProfileId,
  tenantId,
  profileName,
  onClose,
  onCompleted,
}: Props) {
  const [loaded, setLoaded] = useState(false)

  // Block 1 — Closing proof (REQUIRED)
  const [closingProof, setClosingProof] = useState('')
  const [closingProofNotes, setClosingProofNotes] = useState('')

  // Block 3 — Objections (paired text + counter)
  const [objections, setObjections] = useState<ObjectionItem[]>([])

  // Block 4 — Opening hook
  const [openingHook, setOpeningHook] = useState('')

  // Block 5 — Engagement risks (paired text + mitigation)
  const [risks, setRisks] = useState<RiskItem[]>([])

  // Block 6 — Success criteria + fallback
  const [successCriteria, setSuccessCriteria] = useState('')
  const [fallbackStrategy, setFallbackStrategy] = useState('')

  const [saveState, setSaveState] = useState<'idle' | 'editing' | 'saving' | 'saved' | 'error'>(
    'idle',
  )
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previouslyComplete = useRef(false)

  // ---------------------------------------------------------------------------
  // INITIAL LOAD
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase
        .from('conversion_hypothesis')
        .select('*')
        .eq('strategic_profile_id', strategicProfileId)
        .maybeSingle()

      if (cancelled) return

      if (error) {
        console.error('loadConversionHypothesis error:', error.message)
      }

      if (data) {
        const h = data as ConversionHypothesisRow
        setClosingProof(h.closing_proof || '')
        setClosingProofNotes(h.closing_proof_notes || '')
        setObjections(Array.isArray(h.primary_objections) ? h.primary_objections : [])
        setOpeningHook(h.opening_hook || '')
        setRisks(Array.isArray(h.engagement_risks) ? h.engagement_risks : [])
        setSuccessCriteria(h.success_criteria || '')
        setFallbackStrategy(h.fallback_strategy || '')
        previouslyComplete.current = !!h.is_complete
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

      const isComplete = closingProof.trim().length > 0
      const justCompleted = isComplete && !previouslyComplete.current

      const payload = {
        tenant_id: tenantId,
        strategic_profile_id: strategicProfileId,
        closing_proof: closingProof,
        closing_proof_notes: closingProofNotes || null,
        primary_objections: objections.length > 0 ? objections : null,
        opening_hook: openingHook || null,
        engagement_risks: risks.length > 0 ? risks : null,
        success_criteria: successCriteria || null,
        fallback_strategy: fallbackStrategy || null,
        is_complete: isComplete,
        completed_at: justCompleted ? new Date().toISOString() : undefined,
        updated_at: new Date().toISOString(),
      }

      const { error } = await supabase
        .from('conversion_hypothesis')
        .upsert(payload, { onConflict: 'strategic_profile_id' })

      if (error) {
        console.error('upsertConversionHypothesis error:', error.message)
        setSaveState('error')
        return
      }

      setSaveState('saved')
      if (justCompleted) {
        previouslyComplete.current = true
        onCompleted?.()
      }
    }, 1500)

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
    }
  }, [
    loaded,
    tenantId,
    strategicProfileId,
    closingProof,
    closingProofNotes,
    objections,
    openingHook,
    risks,
    successCriteria,
    fallbackStrategy,
    onCompleted,
  ])

  // ---------------------------------------------------------------------------
  // OBJECTION/RISK ROW MUTATORS
  // ---------------------------------------------------------------------------
  function addObjection() {
    setObjections((prev) => [...prev, { text: '', counter: '' }])
  }
  function updateObjection(idx: number, patch: Partial<ObjectionItem>) {
    setObjections((prev) => prev.map((o, i) => (i === idx ? { ...o, ...patch } : o)))
  }
  function removeObjection(idx: number) {
    setObjections((prev) => prev.filter((_, i) => i !== idx))
  }

  function addRisk() {
    setRisks((prev) => [...prev, { text: '', mitigation: '' }])
  }
  function updateRisk(idx: number, patch: Partial<RiskItem>) {
    setRisks((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }
  function removeRisk(idx: number) {
    setRisks((prev) => prev.filter((_, i) => i !== idx))
  }

  // ---------------------------------------------------------------------------
  // RENDER HELPERS
  // ---------------------------------------------------------------------------
  function saveIndicator() {
    const labels: Record<typeof saveState, string> = {
      idle: 'Idle',
      editing: 'Editing — autosave in 1.5s',
      saving: 'Saving…',
      saved: '✓ Saved',
      error: '✗ Save error',
    }
    const colors: Record<typeof saveState, string> = {
      idle: 'var(--color-text-tertiary)',
      editing: 'var(--color-text-secondary)',
      saving: 'var(--color-text-secondary)',
      saved: '#2E6B3E',
      error: '#9B3838',
    }
    return (
      <span style={{ fontSize: 12, color: colors[saveState], fontWeight: 500 }}>
        {labels[saveState]}
      </span>
    )
  }

  if (!loaded) {
    return (
      <Modal
        open={true}
        onClose={onClose}
        title={`Conversion Hypothesis · ${profileName}`}
        size="full"
      >
        <div style={{ padding: 64, textAlign: 'center', color: 'var(--color-text-secondary)' }}>
          Loading hypothesis…
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={`Conversion Hypothesis · ${profileName}`}
      size="full"
      footer={
        <>
          <div style={{ flex: 1 }}>{saveIndicator()}</div>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <style>{STYLES}</style>

      <div className="ch-shell">
        <div className="ch-intro">
          <strong>Six blocks. The editorial spine of the brief.</strong>
          {' '}While Framing the Frame told the brief generator HOW to speak to this prospect,
          this tells it WHAT specific evidence will close them. Block 01 is required;
          the rest enrich the brief but are optional. Autosaves as you go.
        </div>

        {/* BLOCK 1 — CLOSING PROOF (REQUIRED) */}
        <section className="ch-block ch-block-required">
          <div className="ch-block-num">01</div>
          <div className="ch-block-body">
            <h3 className="ch-q">
              What specific evidence, if delivered, would force this prospect to a "yes"?
              <span className="ch-q-tag-required">Required</span>
            </h3>
            <p className="ch-q-hint">
              Not generic market data. The precise piece of proof. Be as specific as you can
              with what you know today — named officials, specific dollar amounts, specific
              product/service mappings, specific policy language. The brief generator leads
              with this as the editorial spine and structures Page 2 around proving it
              (or honestly admitting we couldn't prove it) with evidence.
            </p>
            <textarea
              className="ch-notes ch-notes-large"
              placeholder="Example: 'Confirmation from a named GS-15 at DLA Troop Support that the warm basing program has $X obligated for FY27 against medical glove product groups A, C, and E — paired with verifiable language in DOD's medical onshoring strategy that explicitly prefers US manufacturers.'"
              value={closingProof}
              onChange={(e) => setClosingProof(e.target.value)}
              rows={6}
            />
          </div>
        </section>

        {/* BLOCK 2 — SUPPORTING CONTEXT */}
        <section className="ch-block">
          <div className="ch-block-num">02</div>
          <div className="ch-block-body">
            <h3 className="ch-q">
              Supporting context for the closing proof
              <span className="ch-q-tag-optional">Optional</span>
            </h3>
            <p className="ch-q-hint">
              Sources, signals, named contacts, prior intel that supports the closing proof.
              Where to look. Who Steptoe could call. Specific HigherGov queries. Specific
              USASpending pulls. Anything that gives the research orchestration layer a head
              start when it goes hunting for the proof.
            </p>
            <textarea
              className="ch-notes"
              placeholder="Example: 'DLA Troop Support PIO + DLA Medical strategic plan FY26-30 (publicly available). Steptoe contact: [name] in DOD Health Affairs office. Cross-reference appropriations bill HR-XXXX, line items 1234-1240. Likely Anduril-style sole-source carveout based on Berry Amendment compliance language.'"
              value={closingProofNotes}
              onChange={(e) => setClosingProofNotes(e.target.value)}
              rows={4}
            />
          </div>
        </section>

        {/* BLOCK 3 — PRIMARY OBJECTIONS + COUNTERS */}
        <section className="ch-block">
          <div className="ch-block-num">03</div>
          <div className="ch-block-body">
            <h3 className="ch-q">
              Primary objections you expect, and your counter
              <span className="ch-q-tag-optional">Optional</span>
            </h3>
            <p className="ch-q-hint">
              The pushback you anticipate from this specific prospect. Each objection paired
              with how you'd answer it. Drives the "What about..." page in the companion
              Options deck and shapes how the brief preempts pushback.
            </p>

            {objections.length === 0 && (
              <p className="ch-empty">No objections logged yet. Click below to add the first.</p>
            )}

            <div className="ch-pair-list">
              {objections.map((obj, idx) => (
                <div key={idx} className="ch-pair">
                  <div className="ch-pair-num">{idx + 1}</div>
                  <div className="ch-pair-fields">
                    <textarea
                      className="ch-pair-input"
                      placeholder="Objection — e.g. 'We tried lobbyists before, didn't move'"
                      value={obj.text}
                      onChange={(e) => updateObjection(idx, { text: e.target.value })}
                      rows={2}
                    />
                    <textarea
                      className="ch-pair-input ch-pair-counter"
                      placeholder="Counter — e.g. 'Prior firm wasn't Steptoe-tier; show Anduril ratio'"
                      value={obj.counter || ''}
                      onChange={(e) => updateObjection(idx, { counter: e.target.value })}
                      rows={2}
                    />
                  </div>
                  <button
                    type="button"
                    className="ch-pair-remove"
                    onClick={() => removeObjection(idx)}
                    aria-label="Remove objection"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            <button type="button" className="ch-add-link" onClick={addObjection}>
              + Add objection
            </button>
          </div>
        </section>

        {/* BLOCK 4 — OPENING HOOK */}
        <section className="ch-block">
          <div className="ch-block-num">04</div>
          <div className="ch-block-body">
            <h3 className="ch-q">
              The opening hook — what gets them to the next conversation
              <span className="ch-q-tag-optional">Optional</span>
            </h3>
            <p className="ch-q-hint">
              The single most compelling thing the brief delivers in the BLUF. The hook
              isn't the close — it's the door-opener. What do you put on page 1, in the
              dark navy block, that makes them call you back instead of putting the brief
              on the shelf.
            </p>
            <textarea
              className="ch-notes"
              placeholder="Example: 'You hold a $99M IDIQ vehicle that has produced zero task orders in 24 months. We've identified four peer firms with parallel IDIQs that show the same pattern — and one specific reason it's happening that nobody is telling you.'"
              value={openingHook}
              onChange={(e) => setOpeningHook(e.target.value)}
              rows={4}
            />
          </div>
        </section>

        {/* BLOCK 5 — ENGAGEMENT RISKS + MITIGATIONS */}
        <section className="ch-block">
          <div className="ch-block-num">05</div>
          <div className="ch-block-body">
            <h3 className="ch-q">
              Engagement risks — where this could go sideways
              <span className="ch-q-tag-optional">Optional</span>
            </h3>
            <p className="ch-q-hint">
              Honest read on what could derail the engagement, paired with how you'd
              mitigate. Internal context only — does not appear in the brief itself.
              Used by the brief generator to calibrate confidence levels and by you to
              prepare for the conversation.
            </p>

            {risks.length === 0 && (
              <p className="ch-empty">No risks logged yet. Click below to add the first.</p>
            )}

            <div className="ch-pair-list">
              {risks.map((r, idx) => (
                <div key={idx} className="ch-pair">
                  <div className="ch-pair-num">{idx + 1}</div>
                  <div className="ch-pair-fields">
                    <textarea
                      className="ch-pair-input"
                      placeholder="Risk — e.g. 'Prospect is in the middle of an M&A close; can't engage until July'"
                      value={r.text}
                      onChange={(e) => updateRisk(idx, { text: e.target.value })}
                      rows={2}
                    />
                    <textarea
                      className="ch-pair-input ch-pair-counter"
                      placeholder="Mitigation — e.g. 'Pre-position research scope, signed Q3 start'"
                      value={r.mitigation || ''}
                      onChange={(e) => updateRisk(idx, { mitigation: e.target.value })}
                      rows={2}
                    />
                  </div>
                  <button
                    type="button"
                    className="ch-pair-remove"
                    onClick={() => removeRisk(idx)}
                    aria-label="Remove risk"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            <button type="button" className="ch-add-link" onClick={addRisk}>
              + Add risk
            </button>
          </div>
        </section>

        {/* BLOCK 6 — SUCCESS CRITERIA + FALLBACK */}
        <section className="ch-block">
          <div className="ch-block-num">06</div>
          <div className="ch-block-body">
            <h3 className="ch-q">
              Success criteria + fallback strategy
              <span className="ch-q-tag-optional">Optional</span>
            </h3>
            <p className="ch-q-hint">
              What does winning look like for this engagement? And if the primary close
              doesn't land, what's plan B? Calibrates the brief's "path forward" page and
              the companion Options deck's Stones recommendation.
            </p>

            <label className="ch-sublabel">Success criteria</label>
            <textarea
              className="ch-notes"
              placeholder="Example: 'Sunstone Foundation engagement signed within 30 days, ladder to Steptoe Tier 1 within 90 days. Prospect publicly attributes federal traction to Sunstone work.'"
              value={successCriteria}
              onChange={(e) => setSuccessCriteria(e.target.value)}
              rows={3}
            />

            <label className="ch-sublabel ch-sublabel-spaced">Fallback strategy</label>
            <textarea
              className="ch-notes"
              placeholder="Example: 'If primary close stalls on $$$$, downshift to $35K research-only scope with explicit gate review at 60 days. Preserve relationship for next-cycle Steptoe activation.'"
              value={fallbackStrategy}
              onChange={(e) => setFallbackStrategy(e.target.value)}
              rows={3}
            />
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
.ch-shell {
  font-family: var(--font-text);
  color: var(--color-text-primary);
  padding: 24px 28px 32px;
  max-width: 920px;
  margin: 0 auto;
}

.ch-intro {
  font-size: 13px;
  color: var(--color-text-secondary);
  margin-bottom: 24px;
  padding: 12px 16px;
  background: var(--color-bg-subtle);
  border-radius: 8px;
  border-left: 3px solid #F0A742;
  line-height: 1.5;
}

.ch-block {
  display: flex;
  gap: 20px;
  margin-bottom: 28px;
  padding-bottom: 28px;
  border-bottom: 1px solid var(--color-hairline);
}
.ch-block:last-child { border-bottom: none; }

.ch-block-required {
  background: rgba(31, 45, 74, 0.04);
  border-radius: 8px;
  padding: 20px 16px 28px;
  margin-left: -16px;
  margin-right: -16px;
  border-bottom: 1px solid var(--color-hairline);
}
.ch-block-required .ch-block-num {
  background: #1F2D4A;
  color: #fff;
}

.ch-block-num {
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

.ch-block-body { flex: 1; min-width: 0; }

.ch-q {
  font-size: 16px;
  font-weight: 600;
  margin: 0 0 6px;
  letter-spacing: -0.011em;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  line-height: 1.4;
}

.ch-q-tag-required {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: #fff;
  background: #1F2D4A;
  padding: 3px 8px;
  border-radius: 3px;
  text-transform: uppercase;
}
.ch-q-tag-optional {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--color-text-tertiary);
  background: var(--color-bg-subtle);
  padding: 3px 8px;
  border-radius: 3px;
  text-transform: uppercase;
}

.ch-q-hint {
  font-size: 12px;
  color: var(--color-text-tertiary);
  margin: 0 0 14px;
  line-height: 1.5;
}

.ch-empty {
  font-size: 12px;
  color: var(--color-text-tertiary);
  margin: 0 0 12px;
  font-style: italic;
}

.ch-sublabel {
  display: block;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-secondary);
  margin: 0 0 6px;
}
.ch-sublabel-spaced {
  margin-top: 16px;
}

.ch-notes {
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
  line-height: 1.5;
}
.ch-notes:focus {
  outline: 1px solid #F0A742;
  border-color: #F0A742;
}

.ch-notes-large {
  font-size: 13px;
  min-height: 120px;
}

.ch-pair-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 12px;
}

.ch-pair {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 10px 12px;
  border: 1px solid var(--color-hairline);
  border-radius: 8px;
  background: var(--color-bg-elevated);
}

.ch-pair-num {
  flex: 0 0 24px;
  width: 24px;
  height: 24px;
  border-radius: 12px;
  background: var(--color-bg-subtle);
  color: var(--color-text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.ch-pair-fields {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.ch-pair-input {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--color-hairline);
  border-radius: 4px;
  font-family: inherit;
  font-size: 12px;
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  resize: vertical;
  box-sizing: border-box;
  line-height: 1.5;
}
.ch-pair-input:focus {
  outline: 1px solid #F0A742;
  border-color: #F0A742;
}

.ch-pair-counter {
  background: rgba(46, 107, 62, 0.04);
  border-color: rgba(46, 107, 62, 0.2);
}

.ch-pair-remove {
  flex: 0 0 auto;
  background: transparent;
  border: none;
  color: var(--color-text-tertiary);
  font-size: 18px;
  font-family: inherit;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
  align-self: flex-start;
  margin-top: 2px;
}
.ch-pair-remove:hover {
  color: #9B3838;
}

.ch-add-link {
  background: none;
  border: none;
  font-family: inherit;
  font-size: 12px;
  color: #C77A0F;
  cursor: pointer;
  padding: 4px 0;
  font-weight: 500;
}
.ch-add-link:hover { text-decoration: underline; }
`
