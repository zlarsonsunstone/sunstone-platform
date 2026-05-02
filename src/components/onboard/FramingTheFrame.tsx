/**
 * Framing the Frame — Recon Engine intake Q&A
 *
 * Captures the four blocks that frame the editorial angle the brief renders
 * against:
 *   1. Purpose — what is this brief for?
 *   2. Sizing & receptivity — what scale of evidence will land?
 *   3. Engagement openness — Sun-only vs. Sun+Step
 *   4. Persona — selectable from library, expandable
 *
 * Auto-saves to v2.recon_frames with 1.5s debounce after each change.
 * Persists across modal close/reopen. is_complete computes server-side
 * from all four required fields being present.
 */

import { useEffect, useState, useRef } from 'react'
import { Modal } from '@/components/Modal'
import { Button } from '@/components/Button'
import {
  ReconPersona,
  FramePurpose,
  FrameCompanySize,
  FrameEngagementOpenness,
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
  onCompleted?: () => void  // called when frame transitions to complete
}

export function FramingTheFrame({
  strategicProfileId,
  tenantId,
  profileName,
  onClose,
  onCompleted,
}: Props) {
  const [personas, setPersonas] = useState<ReconPersona[]>([])
  const [loaded, setLoaded] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'dirty' | 'saving' | 'saved' | 'error'>('idle')
  const [showAddPersona, setShowAddPersona] = useState(false)
  const [newPersonaName, setNewPersonaName] = useState('')
  const [newPersonaDesc, setNewPersonaDesc] = useState('')
  const previouslyComplete = useRef<boolean>(false)

  // Local state mirror of frame fields for snappy UI; debounced save flushes.
  const [purpose, setPurpose] = useState<FramePurpose | null>(null)
  const [purposeNotes, setPurposeNotes] = useState('')
  const [companySize, setCompanySize] = useState<FrameCompanySize | null>(null)
  const [receptivityNotes, setReceptivityNotes] = useState('')
  const [engagementOpenness, setEngagementOpenness] = useState<FrameEngagementOpenness | null>(null)
  const [engagementNotes, setEngagementNotes] = useState('')
  const [personaId, setPersonaId] = useState<string | null>(null)

  // ---------------------------------------------------------------------------
  // LOAD on mount
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
        previouslyComplete.current = f.is_complete
      }
      setLoaded(true)
    })()
    return () => {
      cancelled = true
    }
  }, [strategicProfileId])

  // ---------------------------------------------------------------------------
  // DEBOUNCED AUTOSAVE — 1.5s after last change
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!loaded) return
    if (saveState !== 'dirty') return
    const timer = setTimeout(async () => {
      setSaveState('saving')
      const updated = await upsertFrame(tenantId, strategicProfileId, {
        purpose,
        purpose_notes: purposeNotes.trim() || null,
        company_size_band: companySize,
        receptivity_notes: receptivityNotes.trim() || null,
        engagement_openness: engagementOpenness,
        engagement_notes: engagementNotes.trim() || null,
        persona_id: personaId,
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
      setTimeout(() => {
        setSaveState((s) => (s === 'saved' ? 'idle' : s))
      }, 1500)
    }, 1500)
    return () => clearTimeout(timer)
  }, [
    saveState, loaded, tenantId, strategicProfileId,
    purpose, purposeNotes, companySize, receptivityNotes,
    engagementOpenness, engagementNotes, personaId, onCompleted,
  ])

  // Mark dirty on any change after load
  function markDirty() {
    if (!loaded) return
    setSaveState((s) => (s === 'saving' ? s : 'dirty'))
  }

  async function handleAddCustomPersona() {
    if (!newPersonaName.trim() || !newPersonaDesc.trim()) return
    const created = await addCustomPersona(newPersonaName.trim(), newPersonaDesc.trim())
    if (created) {
      setPersonas((prev) => [...prev, created])
      setPersonaId(created.id)
      setNewPersonaName('')
      setNewPersonaDesc('')
      setShowAddPersona(false)
      markDirty()
    }
  }

  // ---------------------------------------------------------------------------
  // RENDER
  // ---------------------------------------------------------------------------
  if (!loaded) {
    return (
      <Modal open={true} onClose={onClose} title="Framing the Frame" size="lg">
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--color-text-secondary)' }}>
          Loading…
        </div>
      </Modal>
    )
  }

  const isComplete = !!(purpose && companySize && engagementOpenness && personaId)

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={`Framing the Frame · ${profileName}`}
      size="lg"
      footer={
        <>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12 }}>
            <SaveIndicator state={saveState} />
            <CompletionState isComplete={isComplete} />
          </div>
          <Button variant="secondary" onClick={onClose}>
            {isComplete ? 'Done' : 'Close'}
          </Button>
        </>
      }
    >
      <style>{STYLES}</style>

      <div className="ftf-shell">
        <p className="ftf-intro">
          The brief renders against the answers below. Each block adjusts how
          the Recon Brief and Options deck are voiced — what gets emphasized,
          what gets backgrounded, what closing question lands.
        </p>

        {/* BLOCK 1 — PURPOSE */}
        <Block
          number="01"
          title="What is the purpose of this Recon Brief?"
          subtitle="Pick the primary intent. The brief's BLUF and section ordering will follow."
        >
          <OptionGroup
            value={purpose}
            options={[
              { value: 'educate', label: 'Educate', desc: 'Prospect needs to understand the federal landscape before any sale conversation.' },
              { value: 'convince', label: 'Convince / persuade', desc: 'Prospect understands federal but needs to be moved to action.' },
              { value: 'show_market_demand', label: 'Show evidence of market demand', desc: 'Surface that real demand exists in the prospect\'s codes.' },
              { value: 'show_market_state', label: 'Show evidence of market state', desc: 'Surface what tier of competition the prospect is actually entering.' },
            ]}
            onChange={(v) => {
              setPurpose(v as FramePurpose)
              markDirty()
            }}
          />
          <NotesField
            value={purposeNotes}
            onChange={(v) => {
              setPurposeNotes(v)
              markDirty()
            }}
            placeholder="Optional: any specifics about why this purpose for this prospect"
          />
        </Block>

        {/* BLOCK 2 — SIZING & RECEPTIVITY */}
        <Block
          number="02"
          title="What size of company will read this — and what will land?"
          subtitle="Calibrates the scale of evidence and the gravity of the claims."
        >
          <OptionGroup
            value={companySize}
            options={[
              { value: '<1M',     label: 'Under $1M',         desc: 'Pre-revenue or very early. Numbers in thousands feel large.' },
              { value: '1M-10M',  label: '$1M – $10M',        desc: 'Most of Sunstone\'s prospects. $100K-$5M numbers land.' },
              { value: '10M-50M', label: '$10M – $50M',       desc: 'Mid-market. $1M-$50M figures resonate.' },
              { value: '50M-250M',label: '$50M – $250M',      desc: 'Established mid-market. $10M+ figures expected.' },
              { value: '250M+',   label: '$250M+',            desc: 'Enterprise. Hundreds of millions or billions in TAM.' },
            ]}
            onChange={(v) => {
              setCompanySize(v as FrameCompanySize)
              markDirty()
            }}
          />
          <NotesField
            value={receptivityNotes}
            onChange={(v) => {
              setReceptivityNotes(v)
              markDirty()
            }}
            placeholder="What will THIS prospect specifically need to see to find this compelling?"
          />
        </Block>

        {/* BLOCK 3 — ENGAGEMENT OPENNESS */}
        <Block
          number="03"
          title="Sunstone-only entry, or open to the full Sun + Steptoe ecosystem?"
          subtitle="Drives Stones emphasis. Sun-only weights Stones 1-2; full ecosystem opens Stones 1-4 in the Options deck."
        >
          <OptionGroup
            value={engagementOpenness}
            options={[
              { value: 'sun_only', label: 'Sunstone-only to start', desc: 'Prospect not ready for Steptoe-tier commitment. Stones 1-2 dominate.' },
              { value: 'sun_step_full', label: 'Open to Sun + Steptoe', desc: 'Full ecosystem available. Stones 1-4 carry trajectory analysis.' },
              { value: 'undecided', label: 'Not yet known', desc: 'Show both paths in the Options deck and let them choose.' },
            ]}
            onChange={(v) => {
              setEngagementOpenness(v as FrameEngagementOpenness)
              markDirty()
            }}
          />
          <NotesField
            value={engagementNotes}
            onChange={(v) => {
              setEngagementNotes(v)
              markDirty()
            }}
            placeholder="Optional context — has Steptoe been discussed, what was the temperature, etc."
          />
        </Block>

        {/* BLOCK 4 — PERSONA */}
        <Block
          number="04"
          title="What type of prospect is this?"
          subtitle="Drives narrative tone, evidence selection, and the &quot;What about…&quot; page in the Options deck."
        >
          <div className="ftf-personas">
            {personas.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`ftf-persona-card${personaId === p.id ? ' selected' : ''}`}
                onClick={() => {
                  setPersonaId(p.id)
                  markDirty()
                }}
              >
                <div className="ftf-persona-name">
                  {p.name}
                  {!p.is_seeded && <span className="ftf-persona-tag">CUSTOM</span>}
                </div>
                <div className="ftf-persona-desc">{p.description}</div>
              </button>
            ))}
          </div>

          {!showAddPersona ? (
            <button
              type="button"
              className="ftf-add-persona-btn"
              onClick={() => setShowAddPersona(true)}
            >
              + Add a new persona
            </button>
          ) : (
            <div className="ftf-add-persona-form">
              <div className="ftf-add-persona-row">
                <label>Name</label>
                <input
                  type="text"
                  value={newPersonaName}
                  onChange={(e) => setNewPersonaName(e.target.value)}
                  placeholder="e.g. Acquired by PE, mandate to scale federal"
                />
              </div>
              <div className="ftf-add-persona-row">
                <label>Description</label>
                <input
                  type="text"
                  value={newPersonaDesc}
                  onChange={(e) => setNewPersonaDesc(e.target.value)}
                  placeholder="One-line definition of the defining trait"
                />
              </div>
              <div className="ftf-add-persona-actions">
                <button
                  type="button"
                  className="ftf-add-persona-cancel"
                  onClick={() => {
                    setShowAddPersona(false)
                    setNewPersonaName('')
                    setNewPersonaDesc('')
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="ftf-add-persona-save"
                  disabled={!newPersonaName.trim() || !newPersonaDesc.trim()}
                  onClick={handleAddCustomPersona}
                >
                  Add persona
                </button>
              </div>
            </div>
          )}
        </Block>
      </div>
    </Modal>
  )
}

// =============================================================================
// SUB-COMPONENTS
// =============================================================================
function Block({
  number, title, subtitle, children,
}: {
  number: string
  title: string
  subtitle: string
  children: React.ReactNode
}) {
  return (
    <section className="ftf-block">
      <div className="ftf-block-head">
        <span className="ftf-block-num">{number}</span>
        <div>
          <h3 className="ftf-block-title">{title}</h3>
          <p className="ftf-block-subtitle">{subtitle}</p>
        </div>
      </div>
      <div className="ftf-block-body">{children}</div>
    </section>
  )
}

function OptionGroup<T extends string>({
  value, options, onChange,
}: {
  value: T | null
  options: Array<{ value: T; label: string; desc: string }>
  onChange: (v: T) => void
}) {
  return (
    <div className="ftf-options">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`ftf-option${value === opt.value ? ' selected' : ''}`}
          onClick={() => onChange(opt.value)}
        >
          <div className="ftf-option-label">{opt.label}</div>
          <div className="ftf-option-desc">{opt.desc}</div>
        </button>
      ))}
    </div>
  )
}

function NotesField({
  value, onChange, placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
}) {
  return (
    <textarea
      className="ftf-notes"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={2}
    />
  )
}

function SaveIndicator({ state }: { state: 'idle' | 'dirty' | 'saving' | 'saved' | 'error' }) {
  if (state === 'idle') return null
  const styles: Record<string, { color: string; text: string }> = {
    dirty:  { color: '#F0A742', text: 'Editing — autosave in 1.5s' },
    saving: { color: 'var(--color-accent)', text: 'Saving…' },
    saved:  { color: '#2E6B3E', text: '✓ Saved' },
    error:  { color: 'var(--color-danger)', text: '⚠ Save failed — will retry' },
  }
  const s = styles[state]
  return <span style={{ color: s.color, fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{s.text}</span>
}

function CompletionState({ isComplete }: { isComplete: boolean }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
      color: isComplete ? '#2E6B3E' : 'var(--color-text-tertiary)',
      padding: '3px 8px', borderRadius: 4,
      background: isComplete ? 'rgba(46,107,62,0.10)' : 'transparent',
      border: isComplete ? '1px solid rgba(46,107,62,0.25)' : '1px dashed var(--color-hairline)',
    }}>
      {isComplete ? 'Frame complete' : 'Frame incomplete'}
    </span>
  )
}

// =============================================================================
// STYLES
// =============================================================================
const STYLES = `
.ftf-shell {
  font-family: var(--font-text);
  color: var(--color-text-primary);
  padding: 4px 0;
}

.ftf-intro {
  font-size: 13px;
  color: var(--color-text-secondary);
  margin: 0 0 20px;
  padding: 12px 16px;
  background: var(--color-bg-subtle);
  border-radius: 8px;
  border-left: 3px solid #F0A742;
}

.ftf-block {
  margin-bottom: 28px;
  padding-bottom: 24px;
  border-bottom: 1px solid var(--color-hairline);
}
.ftf-block:last-child { border-bottom: none; }

.ftf-block-head {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  margin-bottom: 14px;
}

.ftf-block-num {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  color: #F0A742;
  background: rgba(240,167,66,0.10);
  padding: 4px 8px;
  border-radius: 4px;
  font-variant-numeric: tabular-nums;
  height: fit-content;
  margin-top: 2px;
}

.ftf-block-title {
  font-size: 16px;
  font-weight: 600;
  margin: 0 0 4px;
  letter-spacing: -0.011em;
}

.ftf-block-subtitle {
  font-size: 12px;
  color: var(--color-text-tertiary);
  margin: 0;
  line-height: 1.5;
}

.ftf-block-body {
  margin-left: 38px;
}

.ftf-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}

.ftf-option {
  text-align: left;
  padding: 12px 14px;
  border: 1px solid var(--color-hairline);
  border-radius: 8px;
  background: var(--color-bg-elevated);
  cursor: pointer;
  font-family: inherit;
  transition: border-color .12s ease, background .12s ease, box-shadow .12s ease;
}
.ftf-option:hover {
  border-color: var(--color-text-tertiary);
  background: var(--color-bg-subtle);
}
.ftf-option.selected {
  border-color: #F0A742;
  background: rgba(240,167,66,0.06);
  box-shadow: 0 0 0 2px rgba(240,167,66,0.18);
}

.ftf-option-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 2px;
}

.ftf-option-desc {
  font-size: 12px;
  color: var(--color-text-tertiary);
  line-height: 1.45;
}

.ftf-notes {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--color-hairline);
  border-radius: 6px;
  font-family: inherit;
  font-size: 13px;
  resize: vertical;
  min-height: 50px;
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
}
.ftf-notes:focus {
  outline: 1px solid #F0A742;
  border-color: #F0A742;
}

.ftf-personas {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 8px;
  margin-bottom: 12px;
}

.ftf-persona-card {
  text-align: left;
  padding: 10px 12px;
  border: 1px solid var(--color-hairline);
  border-radius: 8px;
  background: var(--color-bg-elevated);
  cursor: pointer;
  font-family: inherit;
  transition: border-color .12s ease, background .12s ease;
}
.ftf-persona-card:hover {
  border-color: var(--color-text-tertiary);
  background: var(--color-bg-subtle);
}
.ftf-persona-card.selected {
  border-color: #F0A742;
  background: rgba(240,167,66,0.06);
  box-shadow: 0 0 0 2px rgba(240,167,66,0.18);
}

.ftf-persona-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 2px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.ftf-persona-tag {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: #C77A0F;
  background: rgba(240,167,66,0.10);
  padding: 1px 5px;
  border-radius: 3px;
}

.ftf-persona-desc {
  font-size: 11px;
  color: var(--color-text-tertiary);
  line-height: 1.4;
}

.ftf-add-persona-btn {
  width: 100%;
  padding: 10px;
  background: transparent;
  border: 1px dashed var(--color-hairline);
  border-radius: 8px;
  font-family: inherit;
  font-size: 12px;
  color: var(--color-text-tertiary);
  cursor: pointer;
}
.ftf-add-persona-btn:hover {
  color: var(--color-text-primary);
  border-color: var(--color-text-tertiary);
}

.ftf-add-persona-form {
  padding: 14px;
  background: var(--color-bg-subtle);
  border-radius: 8px;
  border: 1px solid var(--color-hairline);
}
.ftf-add-persona-row {
  margin-bottom: 10px;
}
.ftf-add-persona-row label {
  display: block;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-tertiary);
  margin-bottom: 4px;
}
.ftf-add-persona-row input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--color-hairline);
  border-radius: 6px;
  font-family: inherit;
  font-size: 13px;
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
}
.ftf-add-persona-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.ftf-add-persona-cancel {
  padding: 6px 12px;
  background: transparent;
  border: 1px solid var(--color-hairline);
  border-radius: 6px;
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  color: var(--color-text-secondary);
}
.ftf-add-persona-save {
  padding: 6px 12px;
  background: #F0A742;
  border: none;
  border-radius: 6px;
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  color: #fff;
}
.ftf-add-persona-save:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
`
