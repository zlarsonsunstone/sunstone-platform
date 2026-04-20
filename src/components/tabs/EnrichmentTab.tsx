import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useStore } from '@/store/useStore'
import { parseCsv, mapCsvRowToRecord } from '@/lib/csv'
import { renderPrompt } from '@/lib/prompt'
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
  enrichment_status: string | null
}

export function EnrichmentTab() {
  const tenant = useStore((s) => s.activeTenant)
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [activeSession, setActiveSession] = useState<SessionRow | null>(null)
  const [records, setRecords] = useState<RecordRow[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [enriching, setEnriching] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
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
      .select('id, awardee, agency, obligated, enrichment_status')
      .eq('session_id', session.session_id)
      .is('deleted_at', null)
      .limit(200)
      .order('obligated', { ascending: false })
    setRecords((data as RecordRow[]) || [])
  }

  useEffect(() => {
    if (!tenant) return
    loadSessions()
  }, [tenant?.id])

  const maxIteration = sessions.reduce((m, s) => Math.max(m, s.iteration), 0)
  const nextIteration = maxIteration + 1

  const handleFileChosen = async (file: File) => {
    if (!tenant) return
    setError(null)
    setUploading(true)

    try {
      const text = await file.text()
      const rows = parseCsv(text)
      const mapped = rows.map(mapCsvRowToRecord)

      // Pre-enrichment filter: Turn 1 = obligated > tenant.value_threshold
      const filtered = mapped.filter((r: any) => {
        const v = typeof r.obligated === 'number' ? r.obligated : null
        return v !== null && v >= tenant.value_threshold
      })

      if (filtered.length === 0) {
        setError(
          `CSV parsed ${rows.length} rows but none passed the value threshold ($${tenant.value_threshold.toLocaleString()}). ` +
          `Adjust the threshold in Admin or upload a different export.`
        )
        setUploading(false)
        return
      }

      // Create the session
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

      // Insert records in batches of 100
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
    setError(null)
    setEnriching(true)

    try {
      // Fetch tenant profile
      const { data: profile } = await supabase
        .from('onboarding_sessions')
        .select('*')
        .eq('tenant_id', tenant.id)
        .maybeSingle()

      // Fetch enrichment prompt variant
      const { data: variant } = await supabase
        .from('prompt_variants')
        .select('*')
        .eq('id', tenant.prompt_variant_enrichment)
        .single()

      if (!variant) throw new Error('Enrichment prompt variant not found')

      // Fetch pending records
      const { data: pending } = await supabase
        .from('enrichment_records')
        .select('*')
        .eq('session_id', activeSession.session_id)
        .eq('enrichment_status', 'pending')
        .is('deleted_at', null)
        .limit(tenant.batch_size)

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

      // Process sequentially to avoid rate limits
      for (let i = 0; i < pending.length; i++) {
        const rec = pending[i]

        const context = {
          client_name: profile?.company_name || tenant.name,
          client_description: profile?.core_description || '',
          client_naics: (profile?.naics_codes || []).join(', '),
          client_certifications: (profile?.certifications || []).join(', '),
          client_website: profile?.website || '',
          awardee: rec.awardee || 'Unknown',
          agency: rec.agency || 'Unknown',
          obligated: rec.obligated ? `$${rec.obligated.toLocaleString()}` : 'Unknown',
          naics_code: rec.naics_code || 'Unknown',
          description: rec.description || '',
          contract_number: rec.contract_number || '',
        }

        let renderedPrompt: string
        try {
          renderedPrompt = renderPrompt(variant.prompt_template, context)
        } catch (renderErr: any) {
          await supabase
            .from('enrichment_records')
            .update({
              enrichment_status: 'error',
              enrichment_result: { error: renderErr.message },
            })
            .eq('id', rec.id)
          setProgress({ done: i + 1, total: pending.length })
          continue
        }

        try {
          const response = await fetch('/.netlify/functions/claude-enrich', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ prompt: renderedPrompt }),
          })

          const data = await response.json()

          if (!response.ok) {
            await supabase
              .from('enrichment_records')
              .update({
                enrichment_status: 'error',
                enrichment_result: { error: data.error || 'API error' },
              })
              .eq('id', rec.id)
          } else {
            await supabase
              .from('enrichment_records')
              .update({
                enrichment_status: 'complete',
                enrichment_result: { text: data.text, usage: data.usage },
                variant_id_used: variant.id,
              })
              .eq('id', rec.id)
          }
        } catch (apiErr: any) {
          await supabase
            .from('enrichment_records')
            .update({
              enrichment_status: 'error',
              enrichment_result: { error: apiErr.message },
            })
            .eq('id', rec.id)
        }

        setProgress({ done: i + 1, total: pending.length })
      }

      await supabase
        .from('enrichment_sessions')
        .update({ status: 'complete' })
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
      eyebrow={`Turn ${Math.min(nextIteration, tenant.turn_count)} of ${tenant.turn_count}`}
      title="Enrichment"
      description={
        `Drop a SAM.gov or HigherGov export. Records with obligated value above $${tenant.value_threshold.toLocaleString()} ` +
        `will be enriched using the ${tenant.prompt_variant_enrichment} variant.`
      }
      actions={
        activeSession && activeSession.status !== 'complete' && !enriching ? (
          <Button onClick={runEnrichment}>Run enrichment</Button>
        ) : null
      }
    >
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
          CSV file from SAM.gov, HigherGov, or USASpending
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

      {/* Progress */}
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

      {/* Sessions */}
      {!loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 2fr)', gap: '24px' }}>
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
                  </div>
                </button>
              ))
            )}
          </Card>

          <Card padding="large">
            <h3
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: '20px',
                fontWeight: 600,
                letterSpacing: '-0.008em',
                marginBottom: '16px',
              }}
            >
              {activeSession ? `Records — Turn ${activeSession.iteration}` : 'No session selected'}
            </h3>

            {activeSession && records.length === 0 && (
              <p style={{ color: 'var(--color-text-tertiary)', fontSize: '14px' }}>No records in this session.</p>
            )}

            {records.map((r) => (
              <div
                key={r.id}
                style={{
                  padding: '12px 0',
                  borderBottom: '0.5px solid var(--color-hairline)',
                  display: 'grid',
                  gridTemplateColumns: '1fr 110px 90px',
                  gap: '12px',
                  alignItems: 'center',
                }}
              >
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
            ))}
          </Card>
        </div>
      )}
    </TabPage>
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
