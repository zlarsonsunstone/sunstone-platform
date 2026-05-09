/**
 * FrameWorkshop - Stage 2 of the recon journey
 *
 * Consultant reviews system recommendations for:
 *   1. Analytical frame (lions vs lambs)
 *   2. Persona
 *   3. Purpose
 */
import { useState, useEffect, CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { Modal } from '@/components/Modal'
import { Button } from '@/components/Button'
import {
  recommendAnalyticalFrame,
  recommendPersona,
  recommendPurpose,
  generateProspectViewToken,
  FrameRecommendation,
  PersonaRecommendation,
  PurposeRecommendation,
} from '@/lib/claude'

interface Props {
  strategicProfileId: string
  tenantId: string
  profileName: string
  onClose: () => void
  onCompleted: (tokenUrl: string) => void
}

type Stage = 'loading_recs' | 'editing' | 'sending' | 'sent'

const PERSONA_OPTIONS = [
  'Subcontractor Stuck in the Middle',
  'Successful and Skeptical',
  'Brand New',
  'Compliance-maintaining non-participant',
  'Recently Re-Energized',
  'Sub-Prime Plateau',
  'Disruptive Entrant',
  'Mature Player Pivoting',
  'Adjacent Market Crossover',
]

export function FrameWorkshop({
  strategicProfileId,
  tenantId,
  profileName,
  onClose,
  onCompleted,
}: Props) {
  const [stage, setStage] = useState<Stage>('loading_recs')
  const [error, setError] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string>('')

  const [frameRec, setFrameRec] = useState<FrameRecommendation | null>(null)
  const [personaRec, setPersonaRec] = useState<PersonaRecommendation | null>(null)
  const [purposeRec, setPurposeRec] = useState<PurposeRecommendation | null>(null)

  const [framePick, setFramePick] = useState<'lions' | 'lambs'>('lions')
  const [frameReasoning, setFrameReasoning] = useState('')
  const [frameClientText, setFrameClientText] = useState('')

  const [personaPick, setPersonaPick] = useState('')
  const [personaReasoning, setPersonaReasoning] = useState('')
  const [personaClientText, setPersonaClientText] = useState('')

  const [purposePick, setPurposePick] = useState<'show_market_state' | 'convince' | 'educate' | 'show_market_demand'>('show_market_state')
  const [purposeReasoning, setPurposeReasoning] = useState('')
  const [purposeClientText, setPurposeClientText] = useState('')

  const [existingTokenUrl, setExistingTokenUrl] = useState<string | null>(null)

  useEffect(() => {
    void initialize()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strategicProfileId])

  async function initialize() {
    const { data: existing } = await supabase
      .from('client_confirmations')
      .select('*')
      .eq('strategic_profile_id', strategicProfileId)
      .in('confirmation_type', ['analytical_frame', 'persona', 'purpose'])
      .order('sequence_position', { ascending: true })

    if (existing && existing.length === 3) {
      const frameC = existing.find(c => c.confirmation_type === 'analytical_frame')
      const personaC = existing.find(c => c.confirmation_type === 'persona')
      const purposeC = existing.find(c => c.confirmation_type === 'purpose')

      if (frameC) {
        const r = frameC.consultant_recommendation as FrameRecommendation
        setFrameRec(r)
        setFramePick(r.frame)
        setFrameReasoning(r.reasoning)
        setFrameClientText(r.what_we_would_show_client)
      }
      if (personaC) {
        const r = personaC.consultant_recommendation as PersonaRecommendation
        setPersonaRec(r)
        setPersonaPick(r.persona)
        setPersonaReasoning(r.reasoning)
        setPersonaClientText(r.what_we_would_show_client)
      }
      if (purposeC) {
        const r = purposeC.consultant_recommendation as PurposeRecommendation
        setPurposeRec(r)
        setPurposePick(r.purpose)
        setPurposeReasoning(r.reasoning)
        setPurposeClientText(r.what_we_would_show_client)
      }

      const { data: tokens } = await supabase
        .from('prospect_view_tokens')
        .select('*')
        .eq('strategic_profile_id', strategicProfileId)
        .eq('token_purpose', 'confirmation')
        .is('revoked_at', null)
        .order('issued_at', { ascending: false })
        .limit(1)
      if (tokens && tokens.length > 0) {
        setExistingTokenUrl(buildTokenUrl(tokens[0].token))
      }

      setStage('sent')
      return
    }

    setStage('loading_recs')
    try {
      setStatusMessage('Reading reconciled profile...')
      const snapshot = await loadProfileSnapshot(strategicProfileId)

      setStatusMessage('Analyzing analytical frame...')
      const fRec = await recommendAnalyticalFrame(snapshot)
      setFrameRec(fRec)
      setFramePick(fRec.frame)
      setFrameReasoning(fRec.reasoning)
      setFrameClientText(fRec.what_we_would_show_client)

      setStatusMessage('Analyzing persona...')
      const pRec = await recommendPersona(snapshot, fRec.frame)
      setPersonaRec(pRec)
      setPersonaPick(pRec.persona)
      setPersonaReasoning(pRec.reasoning)
      setPersonaClientText(pRec.what_we_would_show_client)

      setStatusMessage('Analyzing purpose...')
      const purRec = await recommendPurpose(snapshot, fRec.frame, pRec.persona)
      setPurposeRec(purRec)
      setPurposePick(purRec.purpose)
      setPurposeReasoning(purRec.reasoning)
      setPurposeClientText(purRec.what_we_would_show_client)

      setStage('editing')
      setStatusMessage('')
    } catch (e: any) {
      setError(`Recommendation failed: ${e.message || 'unknown error'}`)
      setStage('editing')
      setStatusMessage('')
    }
  }

  async function sendToClient() {
    setError(null)
    if (!frameRec || !personaRec || !purposeRec) {
      setError('Recommendations not yet loaded')
      return
    }
    setStage('sending')

    try {
      const baseRow = {
        tenant_id: tenantId,
        strategic_profile_id: strategicProfileId,
        client_decision: 'pending',
        consultant_sent_at: new Date().toISOString(),
      }

      const { data: confirmations, error: insertErr } = await supabase
        .from('client_confirmations')
        .insert([
          {
            ...baseRow,
            confirmation_type: 'analytical_frame',
            sequence_position: 1,
            consultant_recommendation: {
              ...frameRec,
              frame: framePick,
              reasoning: frameReasoning,
              what_we_would_show_client: frameClientText,
            },
            consultant_reasoning: frameReasoning,
          },
          {
            ...baseRow,
            confirmation_type: 'persona',
            sequence_position: 2,
            consultant_recommendation: {
              ...personaRec,
              persona: personaPick,
              reasoning: personaReasoning,
              what_we_would_show_client: personaClientText,
            },
            consultant_reasoning: personaReasoning,
          },
          {
            ...baseRow,
            confirmation_type: 'purpose',
            sequence_position: 3,
            consultant_recommendation: {
              ...purposeRec,
              purpose: purposePick,
              reasoning: purposeReasoning,
              what_we_would_show_client: purposeClientText,
            },
            consultant_reasoning: purposeReasoning,
          },
        ])
        .select()
      if (insertErr) throw insertErr

      const token = generateProspectViewToken()
      const expiresAt = new Date()
      expiresAt.setDate(expiresAt.getDate() + 90)

      await supabase.from('prospect_view_tokens').insert({
        tenant_id: tenantId,
        strategic_profile_id: strategicProfileId,
        token,
        token_purpose: 'confirmation',
        expires_at: expiresAt.toISOString(),
      })

      await supabase.from('confirmation_change_log').insert({
        tenant_id: tenantId,
        strategic_profile_id: strategicProfileId,
        event_type: 'consultant_sent_to_client',
        actor_type: 'consultant',
        payload_snapshot: {
          confirmations: confirmations?.map(c => c.id),
          token_purpose: 'confirmation',
        },
      })

      await supabase
        .from('strategic_profiles')
        .update({ engagement_stage: 'stage_3_frame_confirmation' })
        .eq('id', strategicProfileId)

      const url = buildTokenUrl(token)
      setExistingTokenUrl(url)
      setStage('sent')
      onCompleted(url)
    } catch (e: any) {
      setError(`Send failed: ${e.message || 'unknown error'}`)
      setStage('editing')
    }
  }

  function buildTokenUrl(token: string): string {
    return `${window.location.origin}/prospect/${token}`
  }

  if (stage === 'loading_recs') {
    return (
      <Modal open={true} onClose={onClose} title="Frame Workshop" size="full">
        <div style={{ padding: '60px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: '14px', color: 'var(--color-text-secondary)', marginBottom: '12px' }}>
            {statusMessage || 'Reading reconciled profile and generating recommendations...'}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
            This typically takes 20-40 seconds.
          </div>
        </div>
      </Modal>
    )
  }

  if (stage === 'sent' && existingTokenUrl) {
    return (
      <Modal open={true} onClose={onClose} title="Frame Workshop - Sent to Client" size="full">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={successBoxStyle}>
            <strong>Sent.</strong> Three confirmations are pending the Decider's review:
            Frame, Persona, Purpose. Below is the tokenized link to send to the client.
            The Frame Workshop is now locked - to revise these recommendations, the
            client must initiate a pivot from their dashboard.
          </div>

          <div>
            <Label>Client Confirmation Link (send via email / Slack / share screen)</Label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                value={existingTokenUrl}
                readOnly
                style={{ ...inputStyle, fontFamily: 'monospace', fontSize: '12px' }}
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button onClick={() => {
                navigator.clipboard.writeText(existingTokenUrl)
                setStatusMessage('Copied!')
                setTimeout(() => setStatusMessage(''), 2000)
              }}>
                {statusMessage === 'Copied!' ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>

          <div style={summaryBoxStyle}>
            <SummaryRow label="Frame" value={framePick === 'lions' ? 'Lions (competing for territory)' : 'Lambs (disrupting)'} />
            <SummaryRow label="Persona" value={personaPick} />
            <SummaryRow label="Purpose" value={purposePick.replace(/_/g, ' ')} />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button onClick={onClose}>Close</Button>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal open={true} onClose={onClose} title={`Frame Workshop - ${profileName}`} size="full">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={introBoxStyle}>
          <strong>Stage 2: Frame Workshop.</strong> Review the system's three foundational recommendations.
          Edit any of them before sending to the client. Once you click "Send to client for confirmation",
          the recommendations are locked into the chain and the client receives a tokenized link to confirm.
        </div>

        {error && <div style={errorStyle}>{error}</div>}

        <RecommendationCard
          number="01"
          title="Analytical Frame"
          systemRecommendation={frameRec}
          editor={
            <>
              <Label>Frame Selection - Lions or Lambs?</Label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                <FrameButton
                  active={framePick === 'lions'}
                  onClick={() => setFramePick('lions')}
                  title="Lions"
                  subtitle="Competing for territory - Serengeti pride taking turf from other prides"
                />
                <FrameButton
                  active={framePick === 'lambs'}
                  onClick={() => setFramePick('lambs')}
                  title="Lambs"
                  subtitle="Disrupting - obsolete incumbents about to be slaughtered"
                />
              </div>
              <Label>Reasoning</Label>
              <textarea
                value={frameReasoning}
                onChange={(e) => setFrameReasoning(e.target.value)}
                rows={3}
                style={textareaStyle}
              />
              <Label>What We'd Show Client</Label>
              <textarea
                value={frameClientText}
                onChange={(e) => setFrameClientText(e.target.value)}
                rows={2}
                style={textareaStyle}
              />
              {frameRec && (
                <details style={{ marginTop: '8px', fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
                  <summary style={{ cursor: 'pointer' }}>System signals (read-only)</summary>
                  <div style={{ marginTop: '8px' }}>
                    <strong>Lions signals:</strong>
                    <ul style={{ margin: '4px 0', paddingLeft: '18px' }}>
                      {(frameRec.signals_for_lions || []).map((s: string, i: number) => <li key={i}>{s}</li>)}
                    </ul>
                    <strong>Lambs signals:</strong>
                    <ul style={{ margin: '4px 0', paddingLeft: '18px' }}>
                      {(frameRec.signals_for_lambs || []).map((s: string, i: number) => <li key={i}>{s}</li>)}
                    </ul>
                    <div>System confidence: <strong>{frameRec.confidence}</strong></div>
                  </div>
                </details>
              )}
            </>
          }
        />
        <RecommendationCard
          number="02"
          title="Persona"
          systemRecommendation={personaRec}
          editor={
            <>
              <Label>Persona Selection</Label>
              <select
                value={personaPick}
                onChange={(e) => setPersonaPick(e.target.value)}
                style={inputStyle}
              >
                {PERSONA_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <Label>Reasoning</Label>
              <textarea
                value={personaReasoning}
                onChange={(e) => setPersonaReasoning(e.target.value)}
                rows={3}
                style={textareaStyle}
              />
              <Label>What We'd Show Client</Label>
              <textarea
                value={personaClientText}
                onChange={(e) => setPersonaClientText(e.target.value)}
                rows={2}
                style={textareaStyle}
              />
              {personaRec?.alternative_personas && personaRec.alternative_personas.length > 0 && (
                <details style={{ marginTop: '8px', fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
                  <summary style={{ cursor: 'pointer' }}>Alternative personas considered</summary>
                  <ul style={{ margin: '8px 0', paddingLeft: '18px' }}>
                    {personaRec.alternative_personas.map((alt, i) => (
                      <li key={i}><strong>{alt.name}</strong>: {alt.why_not_lead}</li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          }
        />

        <RecommendationCard
          number="03"
          title="Brief Purpose"
          systemRecommendation={purposeRec}
          editor={
            <>
              <Label>Purpose Selection</Label>
              <select
                value={purposePick}
                onChange={(e) => setPurposePick(e.target.value as any)}
                style={inputStyle}
              >
                <option value="show_market_state">show_market_state - diagnostic mirror</option>
                <option value="convince">convince - dismantle a specific objection</option>
                <option value="educate">educate - teach federal mechanics</option>
                <option value="show_market_demand">show_market_demand - prove scale</option>
              </select>
              <Label>Reasoning</Label>
              <textarea
                value={purposeReasoning}
                onChange={(e) => setPurposeReasoning(e.target.value)}
                rows={3}
                style={textareaStyle}
              />
              <Label>What We'd Show Client</Label>
              <textarea
                value={purposeClientText}
                onChange={(e) => setPurposeClientText(e.target.value)}
                rows={2}
                style={textareaStyle}
              />
            </>
          }
        />

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', paddingTop: '8px' }}>
          <button onClick={onClose} style={{ padding: "8px 16px", background: "transparent", border: "1px solid var(--color-hairline)", borderRadius: "var(--radius-input)", color: "var(--color-text-secondary)", cursor: "pointer", fontFamily: "inherit", fontSize: "13px" }}>Cancel</button>
          <Button onClick={sendToClient} disabled={stage === 'sending'}>
            {stage === 'sending' ? 'Sending...' : 'Send to Client for Confirmation'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

async function loadProfileSnapshot(profileId: string) {
  let profile: { data: any } = { data: null }
  try {
    profile = await supabase.from('strategic_profiles').select('*').eq('id', profileId).single()
  } catch {
    // Skip if profile not found
  }

  let claims: any[] = []
  try {
    const result = await supabase.from('profile_claims').select('claim_text, status, source_tier').eq('strategic_profile_id', profileId)
    if (result.data) claims = result.data
  } catch {
    try {
      const result = await supabase.from('profile_claims').select('claim_text, source_tier').eq('strategic_profile_id', profileId)
      if (result.data) claims = result.data
    } catch {
      // Skip claims if table doesn't exist
    }
  }

  let evidence: any[] = []
  try {
    const result = await supabase.from('profile_evidence').select('evidence_text, source_tier').eq('strategic_profile_id', profileId)
    if (result.data) evidence = result.data
  } catch {
    // Skip if missing
  }

  let understanding: { data: any } = { data: null }
  try {
    understanding = await supabase.from('strategic_profiles').select('profile_understanding, market_understanding').eq('id', profileId).single()
  } catch {
    // Skip if not available
  }

  const tenantId = profile.data?.tenant_id
  let reconciledSummary = ''
  if (tenantId) {
    try {
      const [fp, cp] = await Promise.all([
        supabase.from('federal_profile').select('summary').eq('tenant_id', tenantId).maybeSingle(),
        supabase.from('commercial_profile').select('summary').eq('tenant_id', tenantId).maybeSingle(),
      ])
      if (cp.data?.summary) reconciledSummary += `COMMERCIAL: ${cp.data.summary}\n\n`
      if (fp.data?.summary) reconciledSummary += `FEDERAL: ${fp.data.summary}\n\n`
    } catch {
      // Skip if profile tables not available
    }
  }

  return {
    profile_name: profile.data?.name,
    reconciled_summary: reconciledSummary,
    claims: claims.map((c: any) => ({
      claim_text: c.claim_text,
      status: c.status,
      tier: c.source_tier,
    })),
    evidence: evidence.map((e: any) => ({
      evidence_text: e.evidence_text,
      tier: e.source_tier,
    })),
    market_understanding: understanding.data?.market_understanding,
    capability_narrative: understanding.data?.profile_understanding?.dynamic_findings
      ? JSON.stringify(understanding.data.profile_understanding.dynamic_findings)
      : '',
  }
}

function RecommendationCard({
  number,
  title,
  systemRecommendation,
  editor,
}: {
  number: string
  title: string
  systemRecommendation: any
  editor: React.ReactNode
}) {
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', marginBottom: '12px' }}>
        <span style={{ fontSize: '12px', fontWeight: 700, color: '#f0a742', letterSpacing: '0.1em' }}>
          {number}
        </span>
        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--color-text-primary)' }}>
          {title}
        </h3>
        {systemRecommendation?.confidence && (
          <span style={confidenceBadgeStyle(systemRecommendation.confidence)}>
            {systemRecommendation.confidence} confidence
          </span>
        )}
      </div>
      {editor}
    </div>
  )
}

function FrameButton({
  active,
  onClick,
  title,
  subtitle,
}: {
  active: boolean
  onClick: () => void
  title: string
  subtitle: string
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '12px 14px',
        border: `2px solid ${active ? '#f0a742' : 'var(--color-hairline)'}`,
        borderRadius: 'var(--radius-input)',
        background: active ? 'rgba(240, 167, 66, 0.06)' : 'white',
        textAlign: 'left',
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      <div style={{ fontWeight: 600, fontSize: '14px', color: active ? '#2a2622' : 'var(--color-text-primary)', marginBottom: '4px' }}>
        {title}
      </div>
      <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>{subtitle}</div>
    </button>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--color-hairline)' }}>
      <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      <span style={{ fontSize: '13px', color: 'var(--color-text-primary)' }}>{value}</span>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: '10px', marginBottom: '6px' }}>
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

const textareaStyle: CSSProperties = { ...inputStyle, resize: 'vertical' }

const cardStyle: CSSProperties = {
  padding: '16px 18px',
  border: '1px solid var(--color-hairline)',
  borderRadius: 'var(--radius-input)',
  background: 'white',
}

const introBoxStyle: CSSProperties = {
  padding: '12px 14px',
  background: 'rgba(240, 167, 66, 0.06)',
  border: '1px solid rgba(240, 167, 66, 0.25)',
  borderRadius: 'var(--radius-input)',
  fontSize: '13px',
  color: 'var(--color-text-secondary)',
  lineHeight: 1.5,
}

const errorStyle: CSSProperties = {
  padding: '10px 12px',
  background: 'rgba(255, 59, 48, 0.08)',
  border: '1px solid rgba(255, 59, 48, 0.25)',
  borderRadius: 'var(--radius-input)',
  color: 'var(--color-danger)',
  fontSize: '13px',
}

const successBoxStyle: CSSProperties = {
  padding: '12px 14px',
  background: 'rgba(52, 199, 89, 0.08)',
  border: '1px solid rgba(52, 199, 89, 0.3)',
  borderRadius: 'var(--radius-input)',
  fontSize: '13px',
  color: 'var(--color-text-secondary)',
  lineHeight: 1.5,
}

const summaryBoxStyle: CSSProperties = {
  padding: '14px 16px',
  background: 'var(--color-bg-subtle)',
  border: '1px solid var(--color-hairline)',
  borderRadius: 'var(--radius-input)',
}

function confidenceBadgeStyle(confidence: string): CSSProperties {
  const colors: Record<string, string> = {
    high: '#34C759',
    medium: '#FF9500',
    low: '#FF3B30',
  }
  return {
    fontSize: '10px',
    fontWeight: 600,
    padding: '2px 8px',
    borderRadius: '4px',
    background: `${colors[confidence] || '#888'}15`,
    color: colors[confidence] || '#888',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  }
}
