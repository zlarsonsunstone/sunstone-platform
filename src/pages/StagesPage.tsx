/**
 * StagesPage - Captain's Log / Prospect-facing Stages experience.
 *
 * Renders at /stages. Two-pane layout:
 *   LEFT:  accordion of all 12 stages, grouped by 4 Acts
 *   RIGHT: workspace showing the active stage's content
 *
 * Each stage's content is data-driven from v2.prospect_context (per-tenant).
 * Pending/empty fields show as "Pending..." muted text.
 *
 * Prospects (engagement_state='prospect') see stages 1-10. Stages 11-12 are
 * visible but locked with an "Available after engagement" label.
 *
 * Clients (engagement_state='client') see all 12 stages unlocked.
 *
 * The Stage of Discovery has the "Open the Dartboard Tool" button that
 * routes to /recon (the cluster-view Dartboard Tool).
 */

import React, { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useStore } from '@/store/useStore'

// =============================================================================
// TYPES
// =============================================================================

interface ProspectContext {
  tenant_id: string
  referred_by: string | null
  referral_date: string | null
  catalyst: string | null
  intake_submitted_at: string | null
  industry_sector: string | null
  revenue_band: string | null
  headcount: string | null
  federal_posture_summary: string | null
  self_stated_capabilities: string | null
  company_legal_name: string | null
  company_display_name: string | null
  primary_contact_name: string | null
  primary_contact_email: string | null
  uei: string | null
  cage: string | null
  hq_location: string | null
  year_founded: number | null
  certifications: string | null
  sam_status: string | null
  encounter_scheduled_for: string | null
  encounter_completed_at: string | null
  encounter_transcript_status: string | null
  pcbp_commercial_status: string | null
  pcbp_federal_status: string | null
  pcbp_reconciliation_status: string | null
  pcbp_claims_count: number | null
  pcbp_sources_reviewed: string | null
  discovery_total_awards: number | null
  discovery_total_dollars: string | null
  discovery_ring_count: number | null
  discovery_ring_1_label: string | null
  discovery_ring_1_count: number | null
  proposal_status: string | null
  proposal_delivered_at: string | null
  active_stage: number
}

interface Stage {
  num: number
  name: string
  subtitle: string
  act: string
  workspace: string
}

const STAGES: Stage[] = [
  { num: 1,  name: 'Stage of Origin',         subtitle: 'The catalyst that surfaced the route',          act: 'Approach',       workspace: 'origin' },
  { num: 2,  name: 'Stage of Inquiry',        subtitle: 'Your first description of your own waters',     act: 'Approach',       workspace: 'inquiry' },
  { num: 3,  name: 'Stage of Encounter',      subtitle: 'Voice-to-voice. The crystal feels weight.',     act: 'Approach',       workspace: 'encounter' },
  { num: 4,  name: 'Stage of Reconnaissance', subtitle: 'The crystal turns in silence',                  act: 'Reconnaissance', workspace: 'reconnaissance' },
  { num: 5,  name: 'Stage of Confirmation',   subtitle: 'Light splits in two; you tell us which is true',act: 'Reconnaissance', workspace: 'confirmation' },
  { num: 6,  name: 'Stage of Discovery',      subtitle: 'The fog parts. You see your federal continent.',act: 'Reconnaissance', workspace: 'discovery' },
  { num: 7,  name: 'Stage of Refinement',     subtitle: 'You teach the crystal your distinctions',       act: 'Reconnaissance', workspace: 'refinement' },
  { num: 8,  name: 'Stage of Validation',     subtitle: 'Deep pass. Every signal checked twice.',        act: 'Reconnaissance', workspace: 'validation' },
  { num: 9,  name: 'Stage of Revelation',     subtitle: 'The bearing is named. The course is set.',      act: 'Bearing',        workspace: 'revelation' },
  { num: 10, name: 'Stage of Decision',       subtitle: 'Your turn at the helm',                         act: 'Bearing',        workspace: 'decision' },
  { num: 11, name: 'Stage of Commencement',   subtitle: 'The longship leaves harbor',                    act: 'Pursuit',        workspace: 'commencement' },
  { num: 12, name: 'Stage of Pursuit',        subtitle: 'Open water. True bearing held.',                act: 'Pursuit',        workspace: 'pursuit' },
]

const ACT_BOUNDARIES: Record<number, { num: string; name: string }> = {
  1:  { num: 'I',   name: 'Approach' },
  4:  { num: 'II',  name: 'Reconnaissance' },
  9:  { num: 'III', name: 'Bearing' },
  11: { num: 'IV',  name: 'Pursuit' },
}

// =============================================================================
// COMPONENT
// =============================================================================

export function StagesPage() {
  const tenant = useStore((s) => s.activeTenant)
  const currentUser = useStore((s) => s.currentUser)
  const tenantResolutionState = useStore((s) => s.tenantResolutionState)

  const [context, setContext] = useState<ProspectContext | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeStage, setActiveStage] = useState<number>(6)

  // engagement_state determines whether stages 11-12 are unlocked
  const isClient = currentUser?.engagement_state === 'client'
  const lockedAtStage = isClient ? 13 : 11   // prospects: stages >= 11 are 'locked'; clients: all unlocked

  // Tenant color for accent (used in selected stage highlight, links, etc.)
  const tenantColor = tenant?.client_color || '#C5933A'

  useEffect(() => {
    if (!tenant) return
    setLoading(true)
    setError(null)
    supabase
      .from('prospect_context')
      .select('*')
      .eq('tenant_id', tenant.id)
      .maybeSingle()
      .then(({ data, error: err }) => {
        if (err) {
          setError('Failed to load stage data: ' + err.message)
        } else {
          setContext(data as ProspectContext | null)
          if (data && (data as ProspectContext).active_stage) {
            setActiveStage((data as ProspectContext).active_stage)
          }
        }
        setLoading(false)
      })
  }, [tenant])

  if (tenantResolutionState !== 'ready' || !tenant) {
    return <FullPageMessage>Resolving your workspace...</FullPageMessage>
  }
  if (loading) {
    return <FullPageMessage>Loading your captain's log...</FullPageMessage>
  }
  if (error) {
    return <FullPageMessage isError>{error}</FullPageMessage>
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg-primary)' }}>
      {/* HEADER */}
      <header style={{ padding: '20px 32px', borderBottom: '1px solid var(--color-hairline)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--color-bg-elevated)' }}>
        <div>
          <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '2px' }}>
            Captain's Log
          </div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '20px', fontWeight: 600, margin: 0, letterSpacing: '-0.015em' }}>
            {tenant.name} <span style={{ color: tenantColor }}>·</span> Sunstone Advisory Group
          </h1>
        </div>
        <button
          onClick={() => supabase.auth.signOut()}
          style={{ background: 'transparent', border: '1px solid var(--color-hairline)', color: 'var(--color-text-secondary)', padding: '6px 12px', fontSize: '12px', fontWeight: 500, borderRadius: '6px', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          Sign out
        </button>
      </header>

      {/* TWO-PANE LAYOUT */}
      <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', minHeight: 'calc(100vh - 65px)' }}>
        {/* LEFT: accordion */}
        <aside style={{ background: 'var(--color-bg-elevated)', borderRight: '1px solid var(--color-hairline)', padding: '20px 0', overflowY: 'auto' }}>
          <Accordion stages={STAGES} activeStage={activeStage} setActiveStage={setActiveStage} lockedAtStage={lockedAtStage} tenantColor={tenantColor} />
        </aside>

        {/* RIGHT: workspace */}
        <main style={{ padding: '32px 40px', overflowY: 'auto' }}>
          <Workspace
            stage={STAGES.find((s) => s.num === activeStage)!}
            context={context}
            isLocked={activeStage >= lockedAtStage}
            tenantColor={tenantColor}
          />
        </main>
      </div>
    </div>
  )
}

// =============================================================================
// ACCORDION
// =============================================================================

function Accordion({ stages, activeStage, setActiveStage, lockedAtStage, tenantColor }: { stages: Stage[]; activeStage: number; setActiveStage: (n: number) => void; lockedAtStage: number; tenantColor: string }) {
  return (
    <div>
      {stages.map((s) => {
        const isActive = s.num === activeStage
        const isLocked = s.num >= lockedAtStage
        const actBoundary = ACT_BOUNDARIES[s.num]

        return (
          <div key={s.num}>
            {actBoundary && (
              <div style={{ padding: '14px 22px 6px', fontSize: '10px', color: 'var(--color-text-tertiary)', letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 700, marginTop: s.num === 1 ? 0 : '8px' }}>
                Act {actBoundary.num} — {actBoundary.name}
              </div>
            )}
            <button
              onClick={() => setActiveStage(s.num)}
              style={{
                width: '100%',
                textAlign: 'left',
                background: isActive ? 'var(--color-bg-primary)' : 'transparent',
                border: 'none',
                borderLeft: isActive ? `3px solid ${tenantColor}` : '3px solid transparent',
                padding: '12px 20px 12px 17px',
                cursor: 'pointer',
                fontFamily: 'inherit',
                opacity: isLocked ? 0.55 : 1,
                transition: 'background 0.12s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                <div style={{ flexShrink: 0, width: '24px', height: '24px', borderRadius: '50%', background: isActive ? tenantColor : 'var(--color-hairline)', color: isActive ? 'white' : 'var(--color-text-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700, fontFamily: 'var(--font-display)' }}>
                  {s.num}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '13px', fontWeight: isActive ? 600 : 500, color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-primary)', marginBottom: '2px' }}>
                    {s.name}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', lineHeight: 1.4 }}>
                    {s.subtitle}
                  </div>
                  {isLocked && (
                    <div style={{ fontSize: '9px', color: 'var(--color-text-tertiary)', letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: '4px', fontWeight: 600 }}>
                      Available after engagement
                    </div>
                  )}
                </div>
              </div>
            </button>
          </div>
        )
      })}
    </div>
  )
}

// =============================================================================
// WORKSPACE
// =============================================================================

function Workspace({ stage, context, isLocked, tenantColor }: { stage: Stage; context: ProspectContext | null; isLocked: boolean; tenantColor: string }) {
  return (
    <div>
      <div style={{ marginBottom: '24px', paddingBottom: '20px', borderBottom: '1px solid var(--color-hairline)' }}>
        <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '6px' }}>
          Stage {stage.num} of 12 · Act {stage.act}
        </div>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '32px', fontWeight: 600, margin: '0 0 8px 0', letterSpacing: '-0.02em' }}>
          {stage.name}
        </h2>
        <p style={{ fontSize: '15px', color: 'var(--color-text-secondary)', margin: 0, lineHeight: 1.5 }}>
          {stage.subtitle}
        </p>
      </div>

      {isLocked ? (
        <LockedState tenantColor={tenantColor} />
      ) : (
        <WorkspaceContent stage={stage} context={context} tenantColor={tenantColor} />
      )}
    </div>
  )
}

function LockedState({ tenantColor: _ }: { tenantColor: string }) {
  return (
    <div style={{ background: 'var(--color-bg-elevated)', border: '1px dashed var(--color-hairline)', borderRadius: 'var(--radius-card)', padding: '48px 32px', textAlign: 'center' }}>
      <div style={{ fontSize: '32px', marginBottom: '12px', opacity: 0.4 }}>🔒</div>
      <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '18px', fontWeight: 600, marginBottom: '8px' }}>Available after engagement</h3>
      <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', maxWidth: '420px', margin: '0 auto', lineHeight: 1.5 }}>
        This stage activates when you become a Sunstone client. Your decision in Stage 10 determines whether the voyage continues.
      </p>
    </div>
  )
}

// =============================================================================
// WORKSPACE CONTENT — per-stage renderers
// =============================================================================

function WorkspaceContent({ stage, context, tenantColor }: { stage: Stage; context: ProspectContext | null; tenantColor: string }) {
  switch (stage.workspace) {
    case 'origin':         return <RenderOrigin context={context} />
    case 'inquiry':        return <RenderInquiry context={context} />
    case 'encounter':      return <RenderEncounter context={context} />
    case 'reconnaissance': return <RenderReconnaissance context={context} />
    case 'confirmation':   return <RenderConfirmation />
    case 'discovery':      return <RenderDiscovery context={context} tenantColor={tenantColor} />
    case 'refinement':     return <RenderRefinement />
    case 'validation':     return <RenderValidation />
    case 'revelation':     return <RenderRevelation />
    case 'decision':       return <RenderDecision />
    default:               return <LockedState tenantColor={tenantColor} />
  }
}

// ---------------------------------------------------------------------------
// Shared UI helpers
// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '32px' }}>
      <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '18px', fontWeight: 600, marginBottom: '12px', letterSpacing: '-0.012em' }}>{title}</h3>
      <div style={{ fontSize: '14px', color: 'var(--color-text-primary)', lineHeight: 1.6 }}>{children}</div>
    </div>
  )
}

function FieldGrid({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: '8px 16px', fontSize: '13px' }}>
      {rows.map(([k, v], i) => (
        <React.Fragment key={i}>
          <div style={{ color: 'var(--color-text-tertiary)', fontWeight: 500 }}>{k}</div>
          <div style={{ color: 'var(--color-text-primary)' }}>{v}</div>
        </React.Fragment>
      ))}
    </div>
  )
}

function Pending({ children }: { children?: React.ReactNode }) {
  return <span style={{ color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>{children || 'Pending...'}</span>
}

function val(v: string | number | null | undefined, pending = 'Pending...') {
  if (v === null || v === undefined || v === '') return <Pending>{pending}</Pending>
  return String(v)
}

function fmtDate(s: string | null | undefined) {
  if (!s) return null
  try {
    return new Date(s).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  } catch { return s }
}

// ---------------------------------------------------------------------------
// Stage renderers
// ---------------------------------------------------------------------------

function RenderOrigin({ context }: { context: ProspectContext | null }) {
  return (
    <>
      <Section title="How Your Voyage Was Named">
        <p>
          Every voyage begins with a sighting. Yours began when{' '}
          <strong>{val(context?.referred_by, 'a referrer')}</strong> named your company to Sunstone —
          federal contracting as the next horizon. The crystal hadn't been raised yet, but the heading was real.
        </p>
      </Section>
      <Section title="Referral Record">
        <FieldGrid rows={[
          ['Referred By', val(context?.referred_by)],
          ['Date Surfaced', val(fmtDate(context?.referral_date))],
          ['Catalyst', context?.catalyst ? <em>"{context.catalyst}"</em> : <Pending />],
          ['Prospect', val(context?.company_display_name || context?.company_legal_name)],
          ['Point of Contact', val(context?.primary_contact_name)],
        ]} />
      </Section>
    </>
  )
}

function RenderInquiry({ context }: { context: ProspectContext | null }) {
  return (
    <>
      <Section title="Your Self-Described Starting Position">
        <p>You told the system who you are in your own words. This is the heading you set before the fog rolled in. The crystal reads what you give it.</p>
      </Section>
      <Section title="Intake Form — Submitted">
        <FieldGrid rows={[
          ['Submitted', val(fmtDate(context?.intake_submitted_at))],
          ['Industry Sector', val(context?.industry_sector)],
          ['Revenue Band (Self-Reported)', val(context?.revenue_band)],
          ['Headcount', val(context?.headcount)],
          ['Federal Posture', val(context?.federal_posture_summary)],
          ['Catalyst', context?.catalyst ? <em>"{context.catalyst}"</em> : <Pending />],
          ['Stated Capabilities', val(context?.self_stated_capabilities)],
        ]} />
      </Section>
      <Section title="Captured Identity">
        <FieldGrid rows={[
          ['Company', val(context?.company_legal_name || context?.company_display_name)],
          ['UEI / CAGE', context?.uei || context?.cage ? `${context?.uei || '-'} · ${context?.cage || '-'}` : <Pending />],
          ['HQ', val(context?.hq_location)],
          ['Year Founded', val(context?.year_founded)],
          ['Certifications', val(context?.certifications)],
          ['SAM Status', val(context?.sam_status)],
        ]} />
      </Section>
    </>
  )
}

function RenderEncounter({ context }: { context: ProspectContext | null }) {
  const inProgress = context?.encounter_scheduled_for && !context?.encounter_completed_at
  return (
    <>
      <Section title="Today's Call">
        <p>A 30-minute Zoom call with Sunstone, captured by Fireflies. This is where you stop being a form submission and become a known navigator. The system learns how you speak, what you emphasize, what you avoid.</p>
      </Section>
      {inProgress ? (
        <div style={{ background: 'var(--color-bg-elevated)', border: '1px dashed var(--color-hairline)', borderRadius: 'var(--radius-card)', padding: '32px', textAlign: 'center', marginBottom: '32px' }}>
          <div style={{ fontSize: '28px', marginBottom: '10px' }}>🎙</div>
          <h4 style={{ fontFamily: 'var(--font-display)', fontSize: '16px', fontWeight: 600, marginBottom: '6px' }}>Call in progress</h4>
          <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', maxWidth: '500px', margin: '0 auto', lineHeight: 1.5 }}>
            The Fireflies transcript, captured signals, and conversation insights will populate here once the call concludes.
          </p>
        </div>
      ) : null}
      <Section title="What Will Be Captured">
        <FieldGrid rows={[
          ['Transcript', <Pending>Pending — full Fireflies capture</Pending>],
          ['Key Signals', <Pending>Pending — extracted phrases, priorities, hesitations</Pending>],
          ['Lexicon', <Pending>Pending — how you talk about your own work</Pending>],
          ['Action Items', <Pending>Pending — commitments from both sides</Pending>],
        ]} />
      </Section>
    </>
  )
}

function RenderReconnaissance({ context }: { context: ProspectContext | null }) {
  const fmt = (s: string | null | undefined) => s ? s.replace(/_/g, ' ') : null
  return (
    <>
      <Section title="The Crystal Turns in Silence">
        <p>Sunstone goes dark and works the public archives — SAM, USASpending, CAGE, your website, your press, your past performance. Building your Preliminary Comprehensive Business Profile (PCBP) without your input. This is the system rotating the crystal against the sky you can't see through.</p>
      </Section>
      <Section title="PCBP Build — In Progress">
        <FieldGrid rows={[
          ['Commercial Profile', val(fmt(context?.pcbp_commercial_status))],
          ['Federal Profile', val(fmt(context?.pcbp_federal_status))],
          ['Reconciliation', val(fmt(context?.pcbp_reconciliation_status))],
          ['Claims Documented', val(context?.pcbp_claims_count)],
        ]} />
      </Section>
      {context?.pcbp_sources_reviewed && (
        <Section title="Sources Reviewed">
          <p style={{ fontSize: '13px' }}>{context.pcbp_sources_reviewed}</p>
        </Section>
      )}
    </>
  )
}

function RenderConfirmation() {
  return (
    <>
      <Section title="Light Splits in Two">
        <p>You review the PCBP line by line. Confirm, edit, dispute, attest. The two beams of light from the crystal are public reality and your reality — you tell us where they meet, where they diverge. The Confirmed CBP becomes our shared map.</p>
      </Section>
      <div style={{ background: 'var(--color-bg-elevated)', border: '1px dashed var(--color-hairline)', borderRadius: 'var(--radius-card)', padding: '32px', textAlign: 'center' }}>
        <div style={{ fontSize: '28px', marginBottom: '10px' }}>🔒</div>
        <h4 style={{ fontFamily: 'var(--font-display)', fontSize: '16px', fontWeight: 600, marginBottom: '6px' }}>Awaiting completion of Reconnaissance</h4>
        <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', maxWidth: '500px', margin: '0 auto', lineHeight: 1.5 }}>
          This stage activates once the PCBP draft is delivered. You will see every claim with its source, mark each as confirmed / edited / disputed / removed, and lock the Confirmed CBP as your canonical truth-of-record.
        </p>
      </div>
    </>
  )
}

function RenderDiscovery({ context, tenantColor }: { context: ProspectContext | null; tenantColor: string }) {
  const hasData = !!context?.discovery_total_awards
  return (
    <>
      <Section title="The Fog Parts. You See Your Federal Continent.">
        <p>Your validated federal market surfaces for the first time. The rings, the dollars, the doppelgangers, the awards you should have won. The crystal has found the sun through the overcast. <em>You see what others cannot see.</em></p>
      </Section>

      {hasData ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '12px', marginBottom: '32px' }}>
          <StatCard label="Awards Surfaced" value={context?.discovery_total_awards?.toLocaleString() || '-'} sub="since Jan 1, 2025" />
          <StatCard label="Obligated Value" value={context?.discovery_total_dollars || '-'} sub="in your capability rings" tenantColor={tenantColor} />
          <StatCard label="Capability Rings" value={String(context?.discovery_ring_count || 4)} sub="from bullseye to outer" />
          <StatCard label="Ring 1 (Core)" value={String(context?.discovery_ring_1_count || '-')} sub={context?.discovery_ring_1_label || 'Bullseye capability'} />
        </div>
      ) : (
        <div style={{ background: 'var(--color-bg-elevated)', border: '1px dashed var(--color-hairline)', borderRadius: 'var(--radius-card)', padding: '32px', textAlign: 'center', marginBottom: '32px' }}>
          <p style={{ fontSize: '13px', color: 'var(--color-text-tertiary)' }}>Discovery stats will appear here once your reconnaissance pull completes.</p>
        </div>
      )}

      <Section title="Open the Recon Tool">
        <p style={{ marginBottom: '16px' }}>
          The interactive dartboard, the clustered capability lanes, the doppelganger scoring, the misaligned-phrase capture. Click below to enter the tool. Your feedback persists across sessions.
        </p>
        <a
          href="/recon"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-block',
            background: tenantColor,
            color: 'white',
            padding: '12px 24px',
            borderRadius: '6px',
            textDecoration: 'none',
            fontWeight: 600,
            fontSize: '14px',
            letterSpacing: '-0.005em',
          }}
        >
          Open the Dartboard Tool ↗
        </a>
      </Section>

      <Section title="What You Will Do Here">
        <p style={{ fontSize: '14px' }}>
          Walk the awards, grouped by capability. Accept whole capability lanes with a single click, then drill in to refine outliers. Flag misaligned phrases. Send obviously-irrelevant awards to cold storage. Find the awardees who look like you. Identify the "direct hits" — work you want, won by companies that look like you.
        </p>
      </Section>
    </>
  )
}

function StatCard({ label, value, sub, tenantColor }: { label: string; value: string; sub: string; tenantColor?: string }) {
  return (
    <div style={{ background: 'var(--color-bg-elevated)', borderRadius: 'var(--radius-card)', padding: '18px 16px', border: '1px solid var(--color-hairline)' }}>
      <div style={{ fontSize: '10px', color: 'var(--color-text-tertiary)', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600, marginBottom: '8px' }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: '24px', fontWeight: 700, color: tenantColor || 'var(--color-text-primary)', lineHeight: 1, marginBottom: '4px' }}>{value}</div>
      <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>{sub}</div>
    </div>
  )
}

function RenderRefinement() {
  return (
    <>
      <Section title="You Teach the Crystal Your Distinctions">
        <p>You walk the awards with us. Yes, no, misaligned. Your misaligned phrases become negative signals. Your retention rules become positive signals. The system learns your boundary from your actual reactions to actual awards.</p>
      </Section>
      <div style={{ background: 'var(--color-bg-elevated)', border: '1px dashed var(--color-hairline)', borderRadius: 'var(--radius-card)', padding: '32px', textAlign: 'center' }}>
        <div style={{ fontSize: '28px', marginBottom: '10px' }}>🔒</div>
        <h4 style={{ fontFamily: 'var(--font-display)', fontSize: '16px', fontWeight: 600, marginBottom: '6px' }}>Begin in Stage of Discovery</h4>
        <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', maxWidth: '500px', margin: '0 auto', lineHeight: 1.5 }}>
          Refinement happens AS you work through Discovery — every click, flag, and decision you make in the Dartboard Tool feeds into your captain's log. Once you've worked through enough awards, this stage rolls up your distinction signals.
        </p>
      </div>
    </>
  )
}

function RenderValidation() {
  return (
    <>
      <Section title="Every Signal Checked Twice">
        <p>Sunstone runs the validated award pool through QA, clustering, doppelganger scoring, and the intelligence engine. We test our reading against the data. We stop when the signal is conclusive — not before, not after. <em>The crystal stops rotating and the bearing locks.</em></p>
      </Section>
      <div style={{ background: 'var(--color-bg-elevated)', border: '1px dashed var(--color-hairline)', borderRadius: 'var(--radius-card)', padding: '32px', textAlign: 'center' }}>
        <div style={{ fontSize: '28px', marginBottom: '10px' }}>🔒</div>
        <h4 style={{ fontFamily: 'var(--font-display)', fontSize: '16px', fontWeight: 600, marginBottom: '6px' }}>Awaiting your Refinement signals</h4>
        <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', maxWidth: '500px', margin: '0 auto', lineHeight: 1.5 }}>
          Validation runs once your Refinement has accumulated enough feedback to ground the analysis. The system runs per-award QA via Claude, clusters NAICS / PSC / agency patterns, scores all doppelganger candidates, and produces strategic recommendations.
        </p>
      </div>
    </>
  )
}

function RenderRevelation() {
  return (
    <>
      <Section title="The Bearing Is Named. The Course Is Set.">
        <p>The RECON brief lands. Your federal market thesis, your stones, your lanes, your doctrine moves, your persona reading, your next 90 days. <em>This is what every prior stage has been building toward — not the map, the route.</em></p>
      </Section>
      <div style={{ background: 'var(--color-bg-elevated)', border: '1px dashed var(--color-hairline)', borderRadius: 'var(--radius-card)', padding: '32px', textAlign: 'center' }}>
        <div style={{ fontSize: '28px', marginBottom: '10px' }}>🔒</div>
        <h4 style={{ fontFamily: 'var(--font-display)', fontSize: '16px', fontWeight: 600, marginBottom: '6px' }}>Coming after Validation</h4>
        <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', maxWidth: '500px', margin: '0 auto', lineHeight: 1.5 }}>
          The RECON brief is your strategic deliverable: a 1-page BLUF-led document plus a 7-page OPTIONS workbook. It names your federal thesis, identifies your capability lanes, recommends your near-term moves, and frames the 90-day plan.
        </p>
      </div>
    </>
  )
}

function RenderDecision() {
  return (
    <>
      <Section title="Your Turn at the Helm">
        <p>Sunstone delivers a custom engagement plan — pricing, scope, cadence — built around what we learned together. <strong>You decide if the voyage continues with us as your navigator.</strong> No pressure, no upsell: the work either fits or it does not.</p>
      </Section>
      <div style={{ background: 'var(--color-bg-elevated)', border: '1px dashed var(--color-hairline)', borderRadius: 'var(--radius-card)', padding: '32px', textAlign: 'center' }}>
        <div style={{ fontSize: '28px', marginBottom: '10px' }}>🔒</div>
        <h4 style={{ fontFamily: 'var(--font-display)', fontSize: '16px', fontWeight: 600, marginBottom: '6px' }}>Coming after Revelation</h4>
        <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', maxWidth: '500px', margin: '0 auto', lineHeight: 1.5 }}>
          Your engagement proposal will land here with custom pricing tiers, scope options, and recommended cadence. Tailored to what the prior stages have revealed.
        </p>
      </div>
    </>
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
