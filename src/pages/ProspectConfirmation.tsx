/**
 * ProspectConfirmation - client-side view at /prospect/:token
 *
 * Token-validated, no auth required. Decider sees the active confirmations
 * the consultant sent over and confirms / redirects each one. Viewers see
 * read-only.
 *
 * Stage 3 of the recon journey - first confirmation round (Frame, Persona,
 * Purpose). Subsequent rounds (cohort, awards, hypothesis) reuse the same
 * pattern with different confirmation_type rows.
 *
 * URL: /prospect/:token
 *
 * State machine:
 *   loading_token -> validate token, load engagement
 *   landing       -> first-time welcome (only on first visit)
 *   confirming    -> show pending confirmations one at a time
 *   awaiting      -> all done, waiting on consultant for next stage
 *   error         -> token invalid / expired / revoked
 */
import { useState, useEffect, CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/Button'

interface Props {
  token: string
}

interface TokenData {
  id: string
  token: string
  strategic_profile_id: string
  tenant_id: string
  expires_at: string
  revoked_at: string | null
  first_used_at: string | null
  use_count: number
}

interface Engagement {
  profile_id: string
  profile_name: string
  engagement_title: string
  engagement_stage: string
  client_status: string
  consultant_name?: string
  consultant_email?: string
}

interface PendingConfirmation {
  id: string
  confirmation_type: string
  sequence_position: number
  consultant_recommendation: any
  consultant_reasoning: string
}

type Stage = 'loading_token' | 'landing' | 'confirming' | 'awaiting' | 'error'
type LandingPhase = 'entrance' | 'welcome' | 'primer'

export function ProspectConfirmation({ token }: Props) {
  const [stage, setStage] = useState<Stage>('loading_token')
  const [landingPhase, setLandingPhase] = useState<LandingPhase>('entrance')
  const [error, setError] = useState<string | null>(null)
  const [tokenData, setTokenData] = useState<TokenData | null>(null)
  const [engagement, setEngagement] = useState<Engagement | null>(null)
  const [pendingConfirmations, setPendingConfirmations] = useState<PendingConfirmation[]>([])
  const [currentIdx, setCurrentIdx] = useState(0)

  // Decider responses (kept locally until "Lock in" button)
  const [decisions, setDecisions] = useState<Record<string, {
    decision: 'confirmed' | 'redirected' | null
    redirectText: string
    notes: string
  }>>({})

  useEffect(() => {
    void initialize()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  // Auto-advance brand entrance after 3 seconds
  useEffect(() => {
    if (stage === 'landing' && landingPhase === 'entrance') {
      const timer = setTimeout(() => setLandingPhase('welcome'), 3000)
      return () => clearTimeout(timer)
    }
  }, [stage, landingPhase])

  async function initialize() {
    setStage('loading_token')
    setError(null)

    // 1. Validate token
    const { data: tok, error: tokErr } = await supabase
      .from('prospect_view_tokens')
      .select('*')
      .eq('token', token)
      .maybeSingle()

    if (tokErr || !tok) {
      setError('This link is invalid. Please contact your Sunstone consultant for a new link.')
      setStage('error')
      return
    }
    if (tok.revoked_at) {
      setError('This link has been revoked. Please contact your Sunstone consultant for a new link.')
      setStage('error')
      return
    }
    if (new Date(tok.expires_at) < new Date()) {
      setError('This link has expired. Please contact your Sunstone consultant for a new link.')
      setStage('error')
      return
    }
    setTokenData(tok)

    // 2. Track usage
    const newUseCount = (tok.use_count || 0) + 1
    await supabase
      .from('prospect_view_tokens')
      .update({
        first_used_at: tok.first_used_at || new Date().toISOString(),
        last_used_at: new Date().toISOString(),
        use_count: newUseCount,
      })
      .eq('id', tok.id)

    await supabase.from('confirmation_change_log').insert({
      tenant_id: tok.tenant_id,
      strategic_profile_id: tok.strategic_profile_id,
      event_type: 'client_link_opened',
      actor_type: 'decider',
    })

    // 3. Load engagement
    const { data: profile } = await supabase
      .from('strategic_profiles')
      .select('id, name, engagement_title, engagement_stage, client_status')
      .eq('id', tok.strategic_profile_id)
      .single()

    if (profile) {
      setEngagement({
        profile_id: profile.id,
        profile_name: profile.name,
        engagement_title: profile.engagement_title || profile.name,
        engagement_stage: profile.engagement_stage,
        client_status: profile.client_status,
      })
    }

    // 4. Load pending confirmations
    const { data: confirmations } = await supabase
      .from('client_confirmations')
      .select('*')
      .eq('strategic_profile_id', tok.strategic_profile_id)
      .eq('client_decision', 'pending')
      .order('sequence_position', { ascending: true })

    if (confirmations && confirmations.length > 0) {
      setPendingConfirmations(confirmations)
      setStage(tok.first_used_at ? 'confirming' : 'landing')
    } else {
      // No pending confirmations - they're awaiting next stage
      setStage('awaiting')
    }
  }

  function startConfirming() {
    setStage('confirming')
  }

  function recordDecision(confirmationId: string, decision: 'confirmed' | 'redirected') {
    setDecisions(prev => ({
      ...prev,
      [confirmationId]: {
        decision,
        redirectText: prev[confirmationId]?.redirectText || '',
        notes: prev[confirmationId]?.notes || '',
      },
    }))
  }

  function updateRedirectText(confirmationId: string, text: string) {
    setDecisions(prev => ({
      ...prev,
      [confirmationId]: {
        decision: prev[confirmationId]?.decision || null,
        redirectText: text,
        notes: prev[confirmationId]?.notes || '',
      },
    }))
  }

  function updateNotes(confirmationId: string, text: string) {
    setDecisions(prev => ({
      ...prev,
      [confirmationId]: {
        decision: prev[confirmationId]?.decision || null,
        redirectText: prev[confirmationId]?.redirectText || '',
        notes: text,
      },
    }))
  }

  async function lockIn() {
    if (!tokenData || !engagement) return

    // Validate all confirmations have a decision
    const undecided = pendingConfirmations.filter(c => !decisions[c.id]?.decision)
    if (undecided.length > 0) {
      setError(`Please respond to all ${pendingConfirmations.length} confirmations before locking in.`)
      return
    }

    setError(null)

    try {
      // Need to find the active Decider for this engagement
      const { data: deciderAssignment } = await supabase
        .from('decider_assignments')
        .select('assigned_user_id')
        .eq('strategic_profile_id', tokenData.strategic_profile_id)
        .eq('is_active', true)
        .maybeSingle()

      let deciderUserId: string | null = null
      let deciderName = 'Unknown Decider'
      let deciderEmail = ''
      if (deciderAssignment?.assigned_user_id) {
        const { data: deciderUser } = await supabase
          .from('engagement_users')
          .select('id, user_name, user_email')
          .eq('id', deciderAssignment.assigned_user_id)
          .maybeSingle()
        if (deciderUser) {
          deciderUserId = deciderUser.id
          deciderName = deciderUser.user_name
          deciderEmail = deciderUser.user_email
        }
      }

      // Update each confirmation
      for (const c of pendingConfirmations) {
        const d = decisions[c.id]
        if (!d || !d.decision) continue

        await supabase
          .from('client_confirmations')
          .update({
            client_decision: d.decision,
            client_redirect_payload: d.decision === 'redirected'
              ? { redirect_text: d.redirectText }
              : null,
            client_notes: d.notes || null,
            confirmed_at: new Date().toISOString(),
            confirmed_via: 'shared_link',
            decider_user_id: deciderUserId,
            decider_email_at_confirmation: deciderEmail,
            decider_name_at_confirmation: deciderName,
          })
          .eq('id', c.id)

        await supabase.from('confirmation_change_log').insert({
          tenant_id: tokenData.tenant_id,
          strategic_profile_id: tokenData.strategic_profile_id,
          client_confirmation_id: c.id,
          event_type: d.decision === 'confirmed' ? 'client_confirmed' : 'client_redirected',
          actor_type: 'decider',
          actor_user_id: deciderUserId,
          actor_email: deciderEmail,
          actor_name: deciderName,
          payload_snapshot: { decision: d.decision, notes: d.notes, redirect: d.redirectText },
        })
      }

      // Advance the engagement stage if appropriate
      // (For the Frame Workshop confirmations, stage advances to stage_4_surface_research)
      const allFrameStageConfirmations = pendingConfirmations.every(c =>
        ['analytical_frame', 'persona', 'purpose'].includes(c.confirmation_type)
      )
      if (allFrameStageConfirmations) {
        await supabase
          .from('strategic_profiles')
          .update({ engagement_stage: 'stage_4_surface_research' })
          .eq('id', tokenData.strategic_profile_id)
      }

      setStage('awaiting')
    } catch (e: any) {
      setError(`Save failed: ${e.message || 'unknown error'}`)
    }
  }

  // -------------------------------------------------------------------------
  // RENDER STATES
  // -------------------------------------------------------------------------

  if (stage === 'loading_token') {
    return (
      <PageShell>
        <div style={{ padding: '60px 20px', textAlign: 'center', color: '#666' }}>
          Loading...
        </div>
      </PageShell>
    )
  }

  if (stage === 'error') {
    return (
      <PageShell>
        <div style={errorPageStyle}>
          <div style={{ fontSize: '24px', fontWeight: 600, color: '#2a2622', marginBottom: '12px' }}>
            Link unavailable
          </div>
          <div style={{ fontSize: '14px', color: '#666', lineHeight: 1.6 }}>
            {error || 'This link cannot be opened.'}
          </div>
        </div>
      </PageShell>
    )
  }

  if (stage === 'landing' && engagement) {
    // Sub-stage 1: Brand entrance (3 seconds, auto-advance)
    if (landingPhase === 'entrance') {
      return <BrandEntrance />
    }

    // Sub-stage 2: Personalized welcome card
    if (landingPhase === 'welcome') {
      return (
        <PageShell>
          <div style={landingStyle}>
            <div style={{ marginBottom: '24px' }}>
              <div style={brandMarkStyle}>SUNSTONE</div>
              <div style={{ fontSize: '12px', letterSpacing: '0.15em', color: '#666' }}>ADVISORY GROUP</div>
            </div>

            <h1 style={landingTitleStyle}>
              Welcome, {engagement.profile_name}.
            </h1>

            {engagement.consultant_name && (
              <div style={consultantCardStyle}>
                <div style={consultantAvatarStyle}>
                  {engagement.consultant_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#2a2622' }}>
                    {engagement.consultant_name}
                  </div>
                  <div style={{ fontSize: '12px', color: '#666' }}>
                    Principal, Sunstone Advisory Group
                  </div>
                </div>
              </div>
            )}

            <p style={landingBodyStyle}>
              We've been preparing your federal recon. Today we're asking for <strong>5 minutes</strong> of your input
              to confirm a few foundational decisions before we go deeper.
            </p>

            <div style={advisoryBoxStyle}>
              Best done at a quiet desk, not on the go.
            </div>

            <div style={{ marginTop: '32px' }}>
              <Button onClick={() => setLandingPhase('primer')}>I'm ready</Button>
            </div>
          </div>
        </PageShell>
      )
    }

    // Sub-stage 3: Brief context primer
    return (
      <PageShell>
        <div style={landingStyle}>
          <div style={{ marginBottom: '24px' }}>
            <div style={brandMarkStyle}>SUNSTONE</div>
            <div style={{ fontSize: '12px', letterSpacing: '0.15em', color: '#666' }}>ADVISORY GROUP</div>
          </div>

          <h1 style={landingTitleStyle}>
            Here's what's about to happen.
          </h1>

          <p style={landingBodyStyle}>
            <strong>Recon</strong> is how we map your federal opportunity. We've already pulled apart your
            commercial profile, your federal posture, and the market your capability sits in.
          </p>

          <p style={landingBodyStyle}>
            You'll see <strong>{pendingConfirmations.length} analytical reads</strong> from us. For each one,
            you either confirm we're right, or you tell us where we got it wrong. There are no wrong answers
            here - just your read of how you sit in the federal market.
          </p>

          <p style={landingBodyStyle}>
            Your input shapes everything that follows in your <strong>Recon Brief</strong>. The brief comes
            together as we work through these confirmations together.
          </p>

          <div style={{ marginTop: '32px' }}>
            <Button onClick={startConfirming}>Let's begin</Button>
          </div>
        </div>
      </PageShell>
    )
  }

  if (stage === 'awaiting' && engagement) {
    return (
      <PageShell>
        <div style={landingStyle}>
          <div style={{ marginBottom: '24px' }}>
            <div style={brandMarkStyle}>SUNSTONE</div>
            <div style={{ fontSize: '12px', letterSpacing: '0.15em', color: '#666' }}>ADVISORY GROUP</div>
          </div>

          <h1 style={landingTitleStyle}>Thank you.</h1>

          <p style={landingBodyStyle}>
            Your confirmations are locked in. Your Sunstone consultant has been notified and will
            continue building the next phase of your recon. You'll receive your next link when it's
            ready for your review.
          </p>

          <div style={progressBarContainerStyle}>
            <div style={progressBarLabelStyle}>Recon Progress</div>
            <div style={progressBarTrackStyle}>
              <div style={{ ...progressBarFillStyle, width: '23%' }} />
            </div>
            <div style={progressBarStageLabelStyle}>
              Stage 3 of 13 - Frame Confirmation Complete
            </div>
          </div>
        </div>
      </PageShell>
    )
  }

  if (stage === 'confirming' && pendingConfirmations.length > 0) {
    const c = pendingConfirmations[currentIdx]
    if (!c) {
      // All done - show lock-in
      const allHaveDecisions = pendingConfirmations.every(p => decisions[p.id]?.decision)
      return (
        <PageShell>
          <div style={confirmingFrameStyle}>
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '12px', letterSpacing: '0.15em', color: '#f0a742', fontWeight: 600 }}>
                READY TO LOCK IN
              </div>
            </div>
            <h2 style={{ fontSize: '24px', color: '#2a2622', margin: '0 0 16px 0' }}>
              Review your decisions
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
              {pendingConfirmations.map((conf, i) => {
                const d = decisions[conf.id]
                return (
                  <div key={conf.id} style={reviewRowStyle}>
                    <div>
                      <div style={{ fontSize: '11px', color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        {labelForType(conf.confirmation_type)}
                      </div>
                      <div style={{ fontSize: '13px', color: '#2a2622', marginTop: '2px' }}>
                        {d?.decision === 'confirmed' && (
                          <>Confirmed: <strong>{summarizeRec(conf)}</strong></>
                        )}
                        {d?.decision === 'redirected' && (
                          <>Redirected: <em>{d.redirectText.slice(0, 80)}{d.redirectText.length > 80 ? '...' : ''}</em></>
                        )}
                        {!d?.decision && (
                          <span style={{ color: '#FF3B30' }}>No decision recorded</span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => setCurrentIdx(i)}
                      style={editButtonStyle}
                    >
                      Edit
                    </button>
                  </div>
                )
              })}
            </div>
            {error && <div style={errorStyle}>{error}</div>}
            <Button onClick={lockIn} disabled={!allHaveDecisions}>
              Lock these in and continue
            </Button>
          </div>
        </PageShell>
      )
    }

    const d = decisions[c.id]
    const totalSteps = pendingConfirmations.length

    return (
      <PageShell>
        <div style={confirmingFrameStyle}>
          <div style={progressIndicatorStyle}>
            <span style={{ fontSize: '11px', color: '#666', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              Step {currentIdx + 1} of {totalSteps}
            </span>
            <div style={miniProgressTrackStyle}>
              {pendingConfirmations.map((_, i) => (
                <div
                  key={i}
                  style={{
                    ...miniProgressDotStyle,
                    background: i <= currentIdx ? '#f0a742' : '#e5e2dc',
                  }}
                />
              ))}
            </div>
          </div>

          <div style={{ fontSize: '11px', color: '#f0a742', fontWeight: 600, letterSpacing: '0.1em', marginBottom: '8px' }}>
            {labelForType(c.confirmation_type)}
          </div>

          <h2 style={confirmTitleStyle}>
            {questionForType(c.confirmation_type, c.consultant_recommendation)}
          </h2>

          <div style={recommendationBoxStyle}>
            <div style={{ fontSize: '11px', color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
              Our read
            </div>
            <div style={{ fontSize: '15px', color: '#2a2622', lineHeight: 1.5, marginBottom: '12px' }}>
              {summarizeRec(c)}
            </div>
            <div style={{ fontSize: '13px', color: '#666', lineHeight: 1.5 }}>
              {c.consultant_reasoning || c.consultant_recommendation?.reasoning}
            </div>
          </div>

          <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <DecisionButton
              active={d?.decision === 'confirmed'}
              onClick={() => recordDecision(c.id, 'confirmed')}
              icon="check"
              label="Confirm - this matches how we see it"
            />
            <DecisionButton
              active={d?.decision === 'redirected'}
              onClick={() => recordDecision(c.id, 'redirected')}
              icon="redirect"
              label="Redirect - we see this differently"
            />
          </div>

          {d?.decision === 'redirected' && (
            <div style={{ marginTop: '14px' }}>
              <div style={{ fontSize: '11px', color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
                Tell us where we got it wrong
              </div>
              <textarea
                value={d.redirectText}
                onChange={(e) => updateRedirectText(c.id, e.target.value)}
                placeholder="In your own words, what's the right read?"
                rows={3}
                style={textareaStyle}
              />
            </div>
          )}

          {d?.decision && (
            <div style={{ marginTop: '14px' }}>
              <div style={{ fontSize: '11px', color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
                Notes (optional)
              </div>
              <textarea
                value={d.notes}
                onChange={(e) => updateNotes(c.id, e.target.value)}
                placeholder="Anything else you want to share?"
                rows={2}
                style={textareaStyle}
              />
            </div>
          )}

          <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button
              onClick={() => setCurrentIdx(Math.max(0, currentIdx - 1))}
              disabled={currentIdx === 0}
              style={{ ...secondaryButtonStyle, opacity: currentIdx === 0 ? 0.4 : 1 }}
            >
              Previous
            </button>
            <Button
              onClick={() => setCurrentIdx(currentIdx + 1)}
              disabled={!d?.decision || (d.decision === 'redirected' && !d.redirectText.trim())}
            >
              {currentIdx + 1 === totalSteps ? 'Review all' : 'Next'}
            </Button>
          </div>
        </div>
      </PageShell>
    )
  }

  return null
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function labelForType(type: string): string {
  const map: Record<string, string> = {
    analytical_frame: 'Analytical Frame',
    persona: 'Persona',
    purpose: 'Brief Purpose',
    market_state: 'Market State',
    target_rings: 'Target Rings',
    doppelganger_selection: 'Vendor Cohort',
    lamb_selection: 'Displacement Targets',
    award_inclusion: 'Award Inclusion',
    tribal_investigation_request: 'Tribal Investigation',
    conversion_hypothesis: 'Closing Argument',
    brief_approval: 'Brief Approval',
  }
  return map[type] || type.replace(/_/g, ' ')
}

function questionForType(type: string, rec: any): string {
  if (type === 'analytical_frame') {
    if (rec?.frame === 'doppelganger') {
      return 'We see you as competing in established federal markets. Does this match how you see your federal play?'
    }
    return 'We see you as disrupting incumbents who don\'t know they\'re losing. Does this match how you see your federal play?'
  }
  if (type === 'persona') {
    return `We read your team as "${rec?.persona}". Does this match your current state?`
  }
  if (type === 'purpose') {
    return `Our read is that this recon should ${(rec?.purpose || '').replace(/_/g, ' ')}. Does this match what you're looking for?`
  }
  return rec?.what_we_would_show_client || 'Confirm or redirect?'
}

function summarizeRec(c: PendingConfirmation): string {
  const r = c.consultant_recommendation
  if (c.confirmation_type === 'analytical_frame') {
    return r?.frame === 'doppelganger' ? 'Doppelganger (competing)' : 'Lambs (disrupting)'
  }
  if (c.confirmation_type === 'persona') {
    return r?.persona || ''
  }
  if (c.confirmation_type === 'purpose') {
    return (r?.purpose || '').replace(/_/g, ' ')
  }
  return r?.what_we_would_show_client || ''
}

// -----------------------------------------------------------------------------
// Page shell + components
// -----------------------------------------------------------------------------

function BrandEntrance() {
  return (
    <div style={{
      minHeight: '100vh',
      background: '#000000',
      fontFamily: 'Inter, "Helvetica Neue", sans-serif',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Vertical amber rays - decorative */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: `repeating-linear-gradient(
          90deg,
          transparent,
          transparent 30px,
          rgba(240, 167, 66, 0.08) 30px,
          rgba(240, 167, 66, 0.08) 32px
        )`,
        animation: 'fadeIn 1s ease-in',
      }} />

      {/* Logo + wordmark */}
      <div style={{
        position: 'relative',
        textAlign: 'center',
        animation: 'fadeInScale 1.5s ease-out',
      }}>
        <div style={{
          width: '64px',
          height: '64px',
          background: '#f0a742',
          margin: '0 auto 16px',
          transform: 'rotate(45deg)',
          borderRadius: '8px',
        }} />
        <div style={{
          fontSize: '28px',
          fontWeight: 700,
          letterSpacing: '0.2em',
          color: '#ffffff',
          marginBottom: '4px',
        }}>
          SUNSTONE
        </div>
        <div style={{
          fontSize: '11px',
          letterSpacing: '0.25em',
          color: '#f0a742',
        }}>
          ADVISORY GROUP
        </div>
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes fadeInScale {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  )
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      minHeight: '100vh',
      background: '#f5f4ef',
      fontFamily: 'Inter, "Helvetica Neue", sans-serif',
      color: '#2a2622',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px 20px',
    }}>
      <div style={{ maxWidth: '640px', width: '100%' }}>
        {children}
      </div>
    </div>
  )
}

function DecisionButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: 'check' | 'redirect'
  label: string
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '14px 18px',
        border: `2px solid ${active ? '#f0a742' : '#e5e2dc'}`,
        borderRadius: '8px',
        background: active ? 'rgba(240, 167, 66, 0.06)' : 'white',
        textAlign: 'left',
        cursor: 'pointer',
        fontFamily: 'inherit',
        fontSize: '14px',
        color: '#2a2622',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        transition: 'all 0.15s ease',
      }}
    >
      <span style={{
        width: '24px',
        height: '24px',
        borderRadius: '50%',
        background: active ? '#f0a742' : '#e5e2dc',
        color: active ? '#2a2622' : '#999',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '14px',
        fontWeight: 700,
        flexShrink: 0,
      }}>
        {icon === 'check' ? 'OK' : '~'}
      </span>
      {label}
    </button>
  )
}

// -----------------------------------------------------------------------------
// Styles
// -----------------------------------------------------------------------------

const brandMarkStyle: CSSProperties = {
  fontSize: '20px',
  fontWeight: 700,
  letterSpacing: '0.18em',
  color: '#2a2622',
}

const landingStyle: CSSProperties = {
  background: 'white',
  padding: '48px 40px',
  borderRadius: '12px',
  boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.04)',
}

const landingTitleStyle: CSSProperties = {
  fontSize: '32px',
  fontWeight: 700,
  color: '#2a2622',
  margin: '0 0 16px 0',
  letterSpacing: '-0.02em',
}

const landingBodyStyle: CSSProperties = {
  fontSize: '15px',
  color: '#444',
  lineHeight: 1.6,
  margin: '0 0 16px 0',
}

const consultantCardStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '14px',
  padding: '14px 16px',
  background: '#faf9f5',
  border: '1px solid #e5e2dc',
  borderRadius: '10px',
  margin: '0 0 24px 0',
}

const consultantAvatarStyle: CSSProperties = {
  width: '44px',
  height: '44px',
  borderRadius: '50%',
  background: '#f0a742',
  color: '#2a2622',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontWeight: 700,
  fontSize: '16px',
  flexShrink: 0,
}

const advisoryBoxStyle: CSSProperties = {
  fontSize: '12px',
  color: '#999',
  fontStyle: 'italic',
  padding: '10px 14px',
  borderLeft: '2px solid #f0a742',
  background: 'rgba(240, 167, 66, 0.04)',
  margin: '8px 0',
}

const confirmingFrameStyle: CSSProperties = {
  background: 'white',
  padding: '32px 36px',
  borderRadius: '12px',
  boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.04)',
}

const confirmTitleStyle: CSSProperties = {
  fontSize: '22px',
  fontWeight: 600,
  color: '#2a2622',
  margin: '0 0 20px 0',
  lineHeight: 1.3,
}

const recommendationBoxStyle: CSSProperties = {
  padding: '14px 16px',
  background: '#faf9f5',
  border: '1px solid #e5e2dc',
  borderRadius: '8px',
}

const progressIndicatorStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: '20px',
}

const miniProgressTrackStyle: CSSProperties = {
  display: 'flex',
  gap: '4px',
}

const miniProgressDotStyle: CSSProperties = {
  width: '24px',
  height: '4px',
  borderRadius: '2px',
}

const progressBarContainerStyle: CSSProperties = {
  marginTop: '32px',
  padding: '20px 0',
  borderTop: '1px solid #e5e2dc',
}

const progressBarLabelStyle: CSSProperties = {
  fontSize: '11px',
  color: '#666',
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  marginBottom: '8px',
}

const progressBarTrackStyle: CSSProperties = {
  height: '6px',
  background: '#e5e2dc',
  borderRadius: '3px',
  overflow: 'hidden',
}

const progressBarFillStyle: CSSProperties = {
  height: '100%',
  background: '#f0a742',
  transition: 'width 0.3s ease',
}

const progressBarStageLabelStyle: CSSProperties = {
  fontSize: '12px',
  color: '#666',
  marginTop: '8px',
}

const reviewRowStyle: CSSProperties = {
  padding: '12px 14px',
  background: '#faf9f5',
  border: '1px solid #e5e2dc',
  borderRadius: '8px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: '12px',
}

const editButtonStyle: CSSProperties = {
  background: 'transparent',
  border: '1px solid #e5e2dc',
  borderRadius: '6px',
  padding: '4px 12px',
  fontSize: '12px',
  color: '#666',
  cursor: 'pointer',
  fontFamily: 'inherit',
  flexShrink: 0,
}

const secondaryButtonStyle: CSSProperties = {
  background: 'transparent',
  border: '1px solid #e5e2dc',
  borderRadius: '8px',
  padding: '8px 16px',
  fontSize: '13px',
  color: '#666',
  cursor: 'pointer',
  fontFamily: 'inherit',
}

const errorPageStyle: CSSProperties = {
  background: 'white',
  padding: '48px 40px',
  borderRadius: '12px',
  textAlign: 'center',
  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
}

const errorStyle: CSSProperties = {
  padding: '10px 12px',
  background: 'rgba(255, 59, 48, 0.08)',
  border: '1px solid rgba(255, 59, 48, 0.25)',
  borderRadius: '8px',
  color: '#FF3B30',
  fontSize: '13px',
  marginBottom: '16px',
}

const textareaStyle: CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  fontSize: '13px',
  fontFamily: 'inherit',
  border: '1px solid #e5e2dc',
  borderRadius: '8px',
  background: 'white',
  color: '#2a2622',
  resize: 'vertical',
}
