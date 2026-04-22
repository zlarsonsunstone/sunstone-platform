import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useStore } from '@/store/useStore'
import { parseCsv, mapCsvRowToRecord } from '@/lib/csv'
import { callClaudeBrowser, extractJsonBlock } from '@/lib/claude'
import { TabPage } from '../TabPage'
import { Card } from '../Card'
import { Button } from '../Button'

interface SessionRow {
  session_id: string
  tenant_id: string
  iteration: number
  status: string
  record_count: number
  file_name: string | null
  created_at: string
}

interface RecordRow {
  id: string
  awardee: string | null
  agency: string | null
  obligated: number | null
  description: string | null
  naics_code: string | null
  contract_number: string | null
  enrichment_status: string | null
  enrichment_result: any
  fit_score: number | null
}

export function EnrichmentTab() {
  const tenant = useStore((s) => s.activeTenant)
  const commercialProfile = useStore((s) => s.commercialProfile)
  const federalProfile = useStore((s) => s.federalProfile)
  const reconciliation = useStore((s) => s.reconciliation)
  const strategicProfiles = useStore((s) => s.strategicProfiles)

  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [activeSession, setActiveSession] = useState<SessionRow | null>(null)
  const [records, setRecords] = useState<RecordRow[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [enriching, setEnriching] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [viewingRecord, setViewingRecord] = useState<RecordRow | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadSessions = async () => {
    if (!tenant) return
    const { data } = await supabase
      .from('enrichment_sessions')
      .select('*')
      .eq('tenant_id', tenant.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
    setSessions((data as SessionRow[]) || [])
    setLoading(false)
  }

  const loadRecordsForSession = async (session: SessionRow) => {
    setActiveSession(session)
    const { data } = await supabase
      .from('enrichment_records')
      .select('id, awardee, agency, obligated, description, naics_code, contract_number, enrichment_status, enrichment_result, fit_score')
      .eq('session_id', session.session_id)
      .is('deleted_at', null)
      .limit(500)
      .order('fit_score', { ascending: false, nullsFirst: false })
    setRecords((data as RecordRow[]) || [])
  }

  useEffect(() => {
    if (!tenant) return
    loadSessions()
  }, [tenant?.id])

  const maxIteration = sessions.reduce((m, s) => Math.max(m, s.iteration), 0)
  const nextIteration = maxIteration + 1

  const hasProfile = !!commercialProfile?.synthesized_text

  const handleFileChosen = async (file: File) => {
    if (!tenant) return
    setError(null)
    setUploading(true)

    try {
      const text = await file.text()
      const rows = parseCsv(text)
      const mapped = rows.map(mapCsvRowToRecord)

      // Pre-enrichment filter: obligated > tenant.value_threshold
      const filtered = mapped.filter((r: any) => {
        const v = typeof r.obligated === 'number' ? r.obligated : null
        return v !== null && v >= tenant.value_threshold
      })

      if (filtered.length === 0) {
        setError(
          `CSV parsed ${rows.length} rows but none passed the value threshold ($${tenant.value_threshold.toLocaleString()}). ` +
          `Either the file has no dollar-value column we recognize, or all values are below the threshold. Adjust the threshold in Admin or upload a different export.`
        )
        setUploading(false)
        return
      }

      const { data: sessionData, error: sessionError } = await supabase
        .from('enrichment_sessions')
        .insert({
          tenant_id: tenant.id,
          iteration: nextIteration,
          file_name: file.name,
          record_count: filtered.length,
          status: 'pending',
        })
        .select()
        .single()

      if (sessionError || !sessionData) {
        throw new Error(sessionError?.message || 'Failed to create session')
      }

      const session = sessionData as SessionRow

      const batchSize = 100
      for (let i = 0; i < filtered.length; i += batchSize) {
        const batch = filtered.slice(i, i + batchSize).map((r: any) => ({
          ...r,
          session_id: session.session_id,
          tenant_id: tenant.id,
          iteration: session.iteration,
          enrichment_status: 'pending',
        }))

        const { error: insertError } = await supabase
          .from('enrichment_records')
          .insert(batch)

        if (insertError) {
          throw new Error(`Row insert failed: ${insertError.message}`)
        }
      }

      await loadSessions()
      await loadRecordsForSession(session)
      setUploading(false)
    } catch (err: any) {
      setError(err?.message || 'Upload failed')
      setUploading(false)
    }
  }

  const runEnrichment = async () => {
    if (!tenant || !activeSession) return
    if (!hasProfile) {
      setError('Build the commercial profile on the Onboard tab before running enrichment.')
      return
    }
    setError(null)
    setEnriching(true)

    try {
      const { data: pending } = await supabase
        .from('enrichment_records')
        .select('*')
        .eq('session_id', activeSession.session_id)
        .eq('enrichment_status', 'pending')
        .is('deleted_at', null)
        .limit(tenant.batch_size || 50)

      if (!pending || pending.length === 0) {
        setError('No pending records in this session.')
        setEnriching(false)
        return
      }

      await supabase
        .from('enrichment_sessions')
        .update({ status: 'active' })
        .eq('session_id', activeSession.session_id)

      setProgress({ done: 0, total: pending.length })

      // Build the company context once — reused for every record
      const defaultStrategic = strategicProfiles.find((p) => p.is_default) || strategicProfiles[0] || null
      const companyContext = buildCompanyContext({
        tenantName: tenant.name,
        commercial: commercialProfile?.synthesized_text || '',
        federal: federalProfile?.synthesized_text || '',
        reconciliation: reconciliation?.suggestions || reconciliation?.alignment || '',
        strategic: defaultStrategic,
      })

      // Process sequentially to be kind to Anthropic
      for (let i = 0; i < pending.length; i++) {
        const rec = pending[i]
        const recordSummary = formatRecord(rec)

        const prompt = buildEnrichmentPrompt(companyContext, recordSummary)

        try {
          const { text, usage } = await callClaudeBrowser(prompt, {
            model: 'claude-haiku-4-5',
            maxTokens: 1500,
          })

          const structured = extractJsonBlock(text)
          const fitScore = typeof structured?.fit_score === 'number'
            ? Math.max(0, Math.min(100, Math.round(structured.fit_score)))
            : null

          await supabase
            .from('enrichment_records')
            .update({
              enrichment_status: 'complete',
              enrichment_result: { text, structured, usage },
              fit_score: fitScore,
            })
            .eq('id', rec.id)
        } catch (err: any) {
          await supabase
            .from('enrichment_records')
            .update({
              enrichment_status: 'error',
              enrichment_result: { error: err.message || 'Claude call failed' },
            })
            .eq('id', rec.id)
        }

        setProgress({ done: i + 1, total: pending.length })
      }

      // Mark session complete if no pending records remain
      const { count: remainingPending } = await supabase
        .from('enrichment_records')
        .select('id', { count: 'exact', head: true })
        .eq('session_id', activeSession.session_id)
        .eq('enrichment_status', 'pending')

      await supabase
        .from('enrichment_sessions')
        .update({ status: remainingPending === 0 ? 'complete' : 'active' })
        .eq('session_id', activeSession.session_id)

      await loadSessions()
      await loadRecordsForSession(activeSession)
      setEnriching(false)
      setProgress(null)
    } catch (err: any) {
      setError(err?.message || 'Enrichment failed')
      setEnriching(false)
      setProgress(null)
    }
  }

  if (!tenant) return null

  return (
    <TabPage
      eyebrow={`Turn ${Math.min(nextIteration, tenant.turn_count || 4)} of ${tenant.turn_count || 4}`}
      title="Enrichment"
      description={
        `Drop a SAM.gov or HigherGov CSV export. Records above $${tenant.value_threshold.toLocaleString()} are scored against ${tenant.name}'s profile.`
      }
      actions={
        activeSession && activeSession.status !== 'complete' && !enriching ? (
          <Button onClick={runEnrichment} disabled={!hasProfile}>
            {hasProfile ? 'Run enrichment' : 'Build profile first'}
          </Button>
        ) : null
      }
    >
      {!hasProfile && (
        <div
          style={{
            background: 'rgba(212, 146, 10, 0.08)',
            color: 'var(--color-warning)',
            padding: '12px 16px',
            borderRadius: 'var(--radius-input)',
            border: '1px solid rgba(212, 146, 10, 0.2)',
            fontSize: '13px',
            marginBottom: '24px',
          }}
        >
          ⚠ No commercial profile built yet for {tenant.name}. Head to the Onboard tab first — enrichment
          needs the profile as context to score records intelligently.
        </div>
      )}

      {error && (
        <div
          style={{
            background: 'rgba(255, 59, 48, 0.1)',
            color: 'var(--color-danger)',
            padding: '12px 16px',
            borderRadius: 'var(--radius-input)',
            fontSize: '13px',
            marginBottom: '24px',
          }}
        >
          {error}
        </div>
      )}

      {/* Upload zone */}
      <div
        style={{
          background: 'var(--color-bg-elevated)',
          borderRadius: 'var(--radius-card)',
          border: '2px dashed var(--color-hairline)',
          padding: '48px 24px',
          textAlign: 'center',
          marginBottom: '32px',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        <div style={{ fontSize: '15px', fontWeight: 500, marginBottom: '8px' }}>
          Drop Turn {nextIteration} export here
        </div>
        <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)', marginBottom: '16px' }}>
          CSV file from SAM.gov, HigherGov, or USASpending · minimum value ${tenant.value_threshold.toLocaleString()}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) handleFileChosen(file)
          }}
        />
        <Button
          variant="secondary"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? 'Parsing…' : 'Choose CSV file'}
        </Button>
      </div>

      {progress && (
        <div
          style={{
            background: 'var(--color-bg-elevated)',
            borderRadius: 'var(--radius-card)',
            padding: '20px 24px',
            marginBottom: '24px',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <div style={{ fontSize: '14px', fontWeight: 500, marginBottom: '8px' }}>
            Enriching records… {progress.done} of {progress.total}
          </div>
          <div
            style={{
              background: 'var(--color-bg-subtle)',
              height: '6px',
              borderRadius: '3px',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                background: 'var(--color-accent)',
                height: '100%',
                width: `${(progress.done / progress.total) * 100}%`,
                transition: 'width 200ms ease-out',
              }}
            />
          </div>
        </div>
      )}

      {!loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 2.5fr)', gap: '24px' }}>
          <Card padding="large">
            <h3
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: '20px',
                fontWeight: 600,
                letterSpacing: '-0.008em',
                marginBottom: '4px',
              }}
            >
              Sessions
            </h3>
            <p style={{ fontSize: '14px', color: 'var(--color-text-secondary)', marginBottom: '16px' }}>
              Click a session to see its records.
            </p>

            {sessions.length === 0 ? (
              <p style={{ color: 'var(--color-text-tertiary)', fontSize: '14px', padding: '24px 0', textAlign: 'center' }}>
                No sessions yet.
              </p>
            ) : (
              sessions.map((s) => (
                <button
                  key={s.session_id}
                  onClick={() => loadRecordsForSession(s)}
                  style={{
                    display: 'block',
                    width: '100%',
                    background: activeSession?.session_id === s.session_id ? 'var(--color-bg-subtle)' : 'transparent',
                    border: 'none',
                    borderRadius: 'var(--radius-input)',
                    padding: '12px 14px',
                    marginBottom: '4px',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    textAlign: 'left',
                  }}
                >
                  <div style={{ fontSize: '14px', fontWeight: 500 }}>Turn {s.iteration}</div>
                  <div
                    style={{
                      fontSize: '12px',
                      color: 'var(--color-text-secondary)',
                      marginTop: '2px',
                    }}
                  >
                    {s.record_count} records · {s.status}
                    {s.file_name && <> · {s.file_name}</>}
                  </div>
                </button>
              ))
            )}
          </Card>

          <Card padding="large">
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '16px' }}>
              <h3
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: '20px',
                  fontWeight: 600,
                  letterSpacing: '-0.008em',
                  margin: 0,
                }}
              >
                {activeSession ? `Records — Turn ${activeSession.iteration}` : 'No session selected'}
              </h3>
              {activeSession && records.length > 0 && (
                <span style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
                  Ranked by fit score
                </span>
              )}
            </div>

            {activeSession && records.length === 0 && (
              <p style={{ color: 'var(--color-text-tertiary)', fontSize: '14px' }}>No records in this session.</p>
            )}

            {records.map((r) => (
              <button
                key={r.id}
                onClick={() => r.enrichment_status === 'complete' && setViewingRecord(r)}
                disabled={r.enrichment_status !== 'complete'}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '12px 0',
                  borderBottom: '0.5px solid var(--color-hairline)',
                  border: 'none',
                  borderTop: 'none',
                  borderLeft: 'none',
                  borderRight: 'none',
                  background: 'transparent',
                  cursor: r.enrichment_status === 'complete' ? 'pointer' : 'default',
                  textAlign: 'left',
                  fontFamily: 'inherit',
                }}
              >
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '48px 1fr 110px 90px',
                    gap: '12px',
                    alignItems: 'center',
                  }}
                >
                  <FitScoreBadge score={r.fit_score} />
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 500 }}>{r.awardee || '—'}</div>
                    <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '2px' }}>
                      {r.agency || '—'}
                    </div>
                  </div>
                  <div style={{ fontSize: '13px', fontFamily: 'var(--font-mono)', textAlign: 'right' }}>
                    {r.obligated ? `$${r.obligated.toLocaleString()}` : '—'}
                  </div>
                  <RecordStatusPill status={r.enrichment_status} />
                </div>
              </button>
            ))}
          </Card>
        </div>
      )}

      {viewingRecord && (
        <RecordDetailModal
          record={viewingRecord}
          onClose={() => setViewingRecord(null)}
        />
      )}
    </TabPage>
  )
}

/* ========================================================================== */
/* Prompt construction                                                        */
/* ========================================================================== */

function buildCompanyContext(args: {
  tenantName: string
  commercial: string
  federal: string
  reconciliation: string
  strategic: any
}) {
  const { tenantName, commercial, federal, reconciliation, strategic } = args

  let ctx = `COMPANY: ${tenantName}\n\n`
  ctx += `## COMMERCIAL PROFILE\n${commercial}\n\n`

  if (federal) {
    ctx += `## FEDERAL PROFILE\n${federal}\n\n`
  }

  if (reconciliation) {
    ctx += `## STRATEGIC RECONCILIATION / FRAMEWORK\n${reconciliation}\n\n`
  }

  if (strategic) {
    ctx += `## ACTIVE STRATEGIC PROFILE: ${strategic.name}\n`
    if (strategic.description) ctx += `${strategic.description}\n`
    if (strategic.positioning) ctx += `\nPositioning: ${strategic.positioning}\n`
    if (strategic.target_agencies?.length) ctx += `Target agencies: ${strategic.target_agencies.join(', ')}\n`
    if (strategic.target_naics?.length) ctx += `Target NAICS: ${strategic.target_naics.join(', ')}\n`
    if (strategic.target_psc?.length) ctx += `Target PSC: ${strategic.target_psc.join(', ')}\n`
    ctx += '\n'
  }

  return ctx
}

function formatRecord(rec: any): string {
  const lines: string[] = []
  if (rec.awardee) lines.push(`Awardee: ${rec.awardee}`)
  if (rec.agency) lines.push(`Agency: ${rec.agency}`)
  if (rec.obligated !== null && rec.obligated !== undefined) {
    lines.push(`Obligated: $${Number(rec.obligated).toLocaleString()}`)
  }
  if (rec.naics_code) lines.push(`NAICS: ${rec.naics_code}`)
  if (rec.psc_code) lines.push(`PSC: ${rec.psc_code}`)
  if (rec.contract_number) lines.push(`Contract: ${rec.contract_number}`)
  if (rec.description) lines.push(`Description: ${rec.description}`)
  if (rec.period_of_performance_start) lines.push(`PoP start: ${rec.period_of_performance_start}`)
  if (rec.period_of_performance_end) lines.push(`PoP end: ${rec.period_of_performance_end}`)
  return lines.join('\n')
}

function buildEnrichmentPrompt(companyContext: string, recordSummary: string): string {
  return `You are a federal market intelligence analyst evaluating whether a specific government opportunity is a strategic fit for a client company.

${companyContext}

## OPPORTUNITY RECORD
${recordSummary}

## YOUR TASK
Evaluate this opportunity for strategic fit with the client. Score it 0-100 and explain your reasoning.

SCORING RUBRIC:
- 90-100: Exceptional fit — direct capability match, exact target agency, clear teaming/capture path
- 70-89: Strong fit — strong capability overlap, plausible approach, reasonable competitive position
- 50-69: Moderate fit — partial capability match, plausible but requires stretch or teaming
- 30-49: Weak fit — tangentially related, would need substantial pivot
- 0-29: Poor fit — not aligned with capabilities, wrong market, or competitive disadvantage

Consider:
- Does the opportunity's scope align with the client's commercial capabilities?
- Is the awardee a competitor, a potential partner, or a historical incumbent we need to displace?
- Does the agency align with the client's federal strategy?
- Does the NAICS/PSC match target codes?
- Does the dollar value fit the client's target sweet spot?
- Are there strategic signals (subcontracting opps, IP relevance, mission alignment)?

Return ONLY valid JSON in a \`\`\`json block, no other text:

\`\`\`json
{
  "fit_score": 75,
  "fit_tier": "strong",
  "summary": "One sentence on whether this opportunity matters and why.",
  "alignment_points": [
    "Specific reason this is a fit — cite the record field and the client capability it matches"
  ],
  "concerns": [
    "Specific risk, gap, or reason this might NOT be a fit"
  ],
  "recommended_action": "pursue_direct | pursue_partner | monitor | pass",
  "action_rationale": "One sentence explaining the recommended action.",
  "strategic_angle": "If this matters, the one strategic insight — e.g., incumbent analysis, agency relationship, displacement opportunity. Leave empty string if none."
}
\`\`\``
}

/* ========================================================================== */
/* Record detail modal                                                        */
/* ========================================================================== */

function RecordDetailModal({ record, onClose }: { record: RecordRow; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const result = record.enrichment_result
  const structured = result?.structured || {}

  return (
    <div
      role="dialog"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '40px 20px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--color-bg-primary)',
          borderRadius: 'var(--radius-modal)',
          maxWidth: '840px',
          width: '100%',
          maxHeight: '90vh',
          overflow: 'auto',
          padding: '32px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', gap: '16px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ fontSize: '22px', fontWeight: 600, margin: 0, letterSpacing: '-0.01em' }}>
              {record.awardee || 'Unknown awardee'}
            </h2>
            <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
              {record.agency || 'Unknown agency'}
              {record.obligated ? ` · $${record.obligated.toLocaleString()}` : ''}
              {record.contract_number ? ` · ${record.contract_number}` : ''}
            </div>
          </div>
          <FitScoreBadge score={record.fit_score} />
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: '20px',
              cursor: 'pointer',
              color: 'var(--color-text-tertiary)',
              padding: '4px 8px',
            }}
          >
            ×
          </button>
        </div>

        {record.description && (
          <div style={{ marginBottom: '20px', paddingBottom: '16px', borderBottom: '1px solid var(--color-hairline)' }}>
            <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '4px' }}>
              Description
            </div>
            <div style={{ fontSize: '13px', color: 'var(--color-text-primary)', lineHeight: 1.6 }}>
              {record.description}
            </div>
          </div>
        )}

        {structured.summary && (
          <Field label="Summary" value={structured.summary} />
        )}

        {structured.recommended_action && (
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '4px' }}>
              Recommended action
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <ActionBadge action={structured.recommended_action} />
              {structured.action_rationale && (
                <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                  {structured.action_rationale}
                </span>
              )}
            </div>
          </div>
        )}

        {structured.alignment_points?.length > 0 && (
          <BulletField label="Alignment" items={structured.alignment_points} tone="success" />
        )}

        {structured.concerns?.length > 0 && (
          <BulletField label="Concerns" items={structured.concerns} tone="warning" />
        )}

        {structured.strategic_angle && (
          <Field label="Strategic angle" value={structured.strategic_angle} />
        )}

        {result?.error && (
          <div style={{ marginTop: '16px', padding: '12px', background: 'rgba(255,59,48,0.08)', borderRadius: 'var(--radius-input)', fontSize: '12px', color: 'var(--color-danger)' }}>
            {result.error}
          </div>
        )}
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ marginBottom: '16px' }}>
      <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '4px' }}>
        {label}
      </div>
      <div style={{ fontSize: '14px', color: 'var(--color-text-primary)', lineHeight: 1.6 }}>
        {value}
      </div>
    </div>
  )
}

function BulletField({ label, items, tone }: { label: string; items: string[]; tone: 'success' | 'warning' }) {
  const dotColor = tone === 'success' ? 'var(--color-success)' : 'var(--color-warning)'
  return (
    <div style={{ marginBottom: '16px' }}>
      <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '6px' }}>
        {label}
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {items.map((item, i) => (
          <li key={i} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', marginBottom: '6px', fontSize: '13px', lineHeight: 1.5 }}>
            <span style={{ color: dotColor, flexShrink: 0, marginTop: '1px' }}>●</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ActionBadge({ action }: { action: string }) {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    pursue_direct: { label: 'Pursue direct', color: '#34C759', bg: 'rgba(52,199,89,0.12)' },
    pursue_partner: { label: 'Pursue via partner', color: '#007AFF', bg: 'rgba(0,122,255,0.12)' },
    monitor: { label: 'Monitor', color: '#D4920A', bg: 'rgba(212,146,10,0.12)' },
    pass: { label: 'Pass', color: '#86868B', bg: 'rgba(134,134,139,0.15)' },
  }
  const m = map[action] || { label: action, color: '#86868B', bg: 'rgba(134,134,139,0.15)' }
  return (
    <span
      style={{
        padding: '4px 10px',
        background: m.bg,
        color: m.color,
        borderRadius: '6px',
        fontSize: '12px',
        fontWeight: 500,
      }}
    >
      {m.label}
    </span>
  )
}

function FitScoreBadge({ score }: { score: number | null }) {
  if (score === null || score === undefined) {
    return (
      <span
        style={{
          padding: '2px 8px',
          background: 'var(--color-bg-subtle)',
          color: 'var(--color-text-tertiary)',
          borderRadius: '6px',
          fontSize: '11px',
          fontFamily: 'var(--font-mono)',
          fontWeight: 500,
        }}
      >
        —
      </span>
    )
  }
  const color = score >= 80 ? '#34C759' : score >= 60 ? '#007AFF' : score >= 40 ? '#D4920A' : '#86868B'
  const bg = score >= 80 ? 'rgba(52,199,89,0.15)' : score >= 60 ? 'rgba(0,122,255,0.15)' : score >= 40 ? 'rgba(212,146,10,0.15)' : 'rgba(134,134,139,0.15)'
  return (
    <span
      style={{
        padding: '2px 8px',
        background: bg,
        color,
        borderRadius: '6px',
        fontSize: '13px',
        fontFamily: 'var(--font-mono)',
        fontWeight: 600,
        textAlign: 'center',
      }}
    >
      {score}
    </span>
  )
}

function RecordStatusPill({ status }: { status: string | null }) {
  const s = status || 'pending'
  const colors: Record<string, { bg: string; fg: string }> = {
    pending: { bg: 'rgba(134, 134, 139, 0.15)', fg: '#6E6E73' },
    active: { bg: 'rgba(212, 146, 10, 0.15)', fg: '#D4920A' },
    complete: { bg: 'rgba(52, 199, 89, 0.15)', fg: '#34C759' },
    error: { bg: 'rgba(255, 59, 48, 0.15)', fg: '#FF3B30' },
  }
  const c = colors[s] || colors.pending
  return (
    <span
      style={{
        padding: '3px 8px',
        background: c.bg,
        color: c.fg,
        borderRadius: '6px',
        fontSize: '10px',
        fontWeight: 500,
        textTransform: 'uppercase',
        letterSpacing: '0.015em',
        textAlign: 'center',
      }}
    >
      {s}
    </span>
  )
}
