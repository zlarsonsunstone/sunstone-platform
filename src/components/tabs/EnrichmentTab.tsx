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
  source_scope_id?: string | null
  source_scope_ids?: string[] | null
  source_scope_tags?: string[] | null
  market_analysis?: any
  market_analysis_at?: string | null
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
  const searchScopes = useStore((s) => s.searchScopes)
  const loadProfileData = useStore((s) => s.loadProfileData)

  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [activeSession, setActiveSession] = useState<SessionRow | null>(null)
  const [records, setRecords] = useState<RecordRow[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [enriching, setEnriching] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [viewingRecord, setViewingRecord] = useState<RecordRow | null>(null)
  const [pendingUpload, setPendingUpload] = useState<File | null>(null)
  const [selectedScopeId, setSelectedScopeId] = useState<string>('')
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

  const handleFileChosen = (file: File) => {
    // Stage 1: user picked a file. Show the scope picker modal before parsing.
    setError(null)
    setPendingUpload(file)
    setSelectedScopeId('')
  }

  const submitUpload = async () => {
    if (!tenant || !pendingUpload) return
    const file = pendingUpload
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
        setPendingUpload(null)
        return
      }

      // Resolve the selected scope (may be empty string = "not from a scope")
      const scope = searchScopes.find((s) => s.id === selectedScopeId) || null

      const { data: sessionData, error: sessionError } = await supabase
        .from('enrichment_sessions')
        .insert({
          tenant_id: tenant.id,
          iteration: nextIteration,
          file_name: file.name,
          record_count: filtered.length,
          status: 'pending',
          source_scope_ids: scope ? [scope.id] : [],
          source_scope_tags: scope ? [scope.scope_tag] : [],
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
          source_scope_id: scope?.id || null,
          source_scope_tag: scope?.scope_tag || null,
        }))

        const { error: insertError } = await supabase
          .from('enrichment_records')
          .insert(batch)

        if (insertError) {
          throw new Error(`Row insert failed: ${insertError.message}`)
        }
      }

      // Backfill actual counts on the scope (if one was selected)
      if (scope) {
        const totalDollars = filtered.reduce((sum: number, r: any) => {
          return sum + (typeof r.obligated === 'number' ? r.obligated : 0)
        }, 0)
        await supabase
          .from('search_scopes')
          .update({
            actual_award_count: filtered.length,
            actual_dollar_volume: Math.round(totalDollars),
            last_imported_at: new Date().toISOString(),
          })
          .eq('id', scope.id)
        // Reload scopes so the Onboard tab reflects calibration
        if (tenant) await loadProfileData(tenant.id)
      }

      await loadSessions()
      await loadRecordsForSession(session)
      setUploading(false)
      setPendingUpload(null)
      setSelectedScopeId('')

      // Auto-trigger market analysis for the new session
      runMarketAnalysis(session)
    } catch (err: any) {
      setError(err?.message || 'Upload failed')
      setUploading(false)
      setPendingUpload(null)
    }
  }

  const cancelUpload = () => {
    setPendingUpload(null)
    setSelectedScopeId('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const runMarketAnalysis = async (session: SessionRow) => {
    if (!tenant) return
    setAnalyzing(true)
    setError(null)
    try {
      const { data: allRecords } = await supabase
        .from('enrichment_records')
        .select('awardee, agency, obligated, description, naics_code, contract_number')
        .eq('session_id', session.session_id)
        .is('deleted_at', null)

      if (!allRecords || allRecords.length === 0) {
        setError('No records found in session.')
        setAnalyzing(false)
        return
      }

      // Prepare the corpus. If it's huge, truncate each description to 400 chars
      // so we fit inside a sensible prompt budget.
      const lines: string[] = allRecords.map((r: any) => {
        const desc = (r.description || '').slice(0, 400)
        const val = typeof r.obligated === 'number' ? r.obligated : 0
        return `[$${val.toLocaleString()}] agency=${r.agency || '?'} | awardee=${r.awardee || '?'} | NAICS=${r.naics_code || '?'} :: ${desc}`
      })

      // Compute total + top-level stats in JS (cheaper, more accurate)
      const totalDollars = allRecords.reduce((sum: number, r: any) => {
        return sum + (typeof r.obligated === 'number' ? r.obligated : 0)
      }, 0)

      // Vendor and agency concentration (computed in JS for accuracy)
      const vendorMap: Record<string, { count: number; dollars: number }> = {}
      const agencyMap: Record<string, { count: number; dollars: number }> = {}
      const naicsMap: Record<string, { count: number; dollars: number }> = {}
      for (const r of allRecords as any[]) {
        const v = typeof r.obligated === 'number' ? r.obligated : 0
        if (r.awardee) {
          const key = r.awardee.trim()
          if (!vendorMap[key]) vendorMap[key] = { count: 0, dollars: 0 }
          vendorMap[key].count += 1
          vendorMap[key].dollars += v
        }
        if (r.agency) {
          const key = r.agency.trim()
          if (!agencyMap[key]) agencyMap[key] = { count: 0, dollars: 0 }
          agencyMap[key].count += 1
          agencyMap[key].dollars += v
        }
        if (r.naics_code) {
          const key = String(r.naics_code).trim()
          if (!naicsMap[key]) naicsMap[key] = { count: 0, dollars: 0 }
          naicsMap[key].count += 1
          naicsMap[key].dollars += v
        }
      }

      const topVendors = Object.entries(vendorMap)
        .map(([name, s]) => ({ name, count: s.count, dollars: s.dollars }))
        .sort((a, b) => b.dollars - a.dollars)
        .slice(0, 25)

      const topAgencies = Object.entries(agencyMap)
        .map(([name, s]) => ({ name, count: s.count, dollars: s.dollars }))
        .sort((a, b) => b.dollars - a.dollars)
        .slice(0, 15)

      const topNaics = Object.entries(naicsMap)
        .map(([code, s]) => ({ code, count: s.count, dollars: s.dollars }))
        .sort((a, b) => b.dollars - a.dollars)
        .slice(0, 12)

      // Claude call: value-weighted phrase extraction
      const corpusSample = lines.slice(0, 400).join('\n')  // cap at 400 records to keep prompt bounded

      const prompt = `You are analyzing a federal contract dataset for market intelligence. The goal is to surface the vocabulary and concentration patterns that a federal contracting officer or capture manager would find useful — in the language those officers actually use in SOWs.

DATASET: ${allRecords.length} contract records. Total obligated: $${totalDollars.toLocaleString()}.
${lines.length > 400 ? `(Analyzing first 400 records; same distribution applies.)` : ''}

Each line below is one contract: [dollar value] agency | awardee | NAICS :: description

${corpusSample}

EXTRACT VALUE-WEIGHTED PHRASES from the contract descriptions. Phrases should be:
- 1-3 words each, in the language contracting officers used (not marketing language)
- Specific enough to be useful as Round 2 search terms
- NOT generic filler ("services", "support", "contract")
- NOT vendor or agency names
- NOT PSC labels or NAICS labels

For each phrase, estimate:
- dollar_volume: approximate total contract dollars associated with records containing this phrase
- count: approximate number of contracts containing this phrase
- avg_contract: dollar_volume / count
- context: 1 short sentence on what kind of work this phrase signals

Return 20-30 phrases ranked by dollar_volume descending.

Also provide:
- headline_insight: 2-3 sentences summarizing the key takeaway from the dataset — where the money is flowing, what's surprising, what stands out
- market_shape: 1-2 sentences on concentration — is this a few giant contracts or many small ones? Is it vendor-concentrated or fragmented?

Return ONLY valid JSON in a \`\`\`json block, no other text:

\`\`\`json
{
  "headline_insight": "...",
  "market_shape": "...",
  "phrases": [
    {
      "phrase": "...",
      "dollar_volume": 12500000,
      "count": 15,
      "avg_contract": 833333,
      "context": "..."
    }
  ]
}
\`\`\``

      const { text } = await callClaudeBrowser(prompt, {
        model: 'claude-sonnet-4-5',
        maxTokens: 4000,
      })

      const parsed = extractJsonBlock(text)
      if (!parsed) throw new Error('Market analysis returned no parseable output')

      const analysis = {
        total_records: allRecords.length,
        total_dollars: totalDollars,
        headline_insight: parsed.headline_insight || '',
        market_shape: parsed.market_shape || '',
        phrases: Array.isArray(parsed.phrases) ? parsed.phrases : [],
        top_vendors: topVendors,
        top_agencies: topAgencies,
        top_naics: topNaics,
      }

      await supabase
        .from('enrichment_sessions')
        .update({
          market_analysis: analysis,
          market_analysis_at: new Date().toISOString(),
        })
        .eq('session_id', session.session_id)

      await loadSessions()
      // Reload active session's records so the UI picks up the new market_analysis
      const { data: updatedSession } = await supabase
        .from('enrichment_sessions')
        .select('*')
        .eq('session_id', session.session_id)
        .single()
      if (updatedSession) {
        setActiveSession(updatedSession as SessionRow)
      }
      setAnalyzing(false)
    } catch (err: any) {
      setError(err?.message || 'Market analysis failed')
      setAnalyzing(false)
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

      {/* Market Analysis panel */}
      {activeSession && (activeSession.market_analysis || analyzing) && (
        <MarketAnalysisPanel
          session={activeSession}
          analyzing={analyzing}
          onRerun={() => runMarketAnalysis(activeSession)}
        />
      )}

      {activeSession && !activeSession.market_analysis && !analyzing && (
        <div
          style={{
            background: 'var(--color-bg-elevated)',
            borderRadius: 'var(--radius-card)',
            padding: '20px 24px',
            marginBottom: '24px',
            boxShadow: 'var(--shadow-card)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px',
          }}
        >
          <div>
            <div style={{ fontSize: '14px', fontWeight: 500, marginBottom: '4px' }}>
              Market analysis not run yet
            </div>
            <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
              Extract value-weighted phrases, top vendors, top agencies, and NAICS distribution from this dataset.
            </div>
          </div>
          <Button size="small" onClick={() => runMarketAnalysis(activeSession)}>
            Run market analysis
          </Button>
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

      {pendingUpload && (
        <ScopePickerModal
          fileName={pendingUpload.name}
          scopes={searchScopes.filter((s) => !s.archived)}
          selectedScopeId={selectedScopeId}
          onSelectScope={setSelectedScopeId}
          onCancel={cancelUpload}
          onConfirm={submitUpload}
          uploading={uploading}
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

/* ========================================================================== */
/* Scope Picker Modal                                                         */
/* ========================================================================== */

function ScopePickerModal({
  fileName,
  scopes,
  selectedScopeId,
  onSelectScope,
  onCancel,
  onConfirm,
  uploading,
}: {
  fileName: string
  scopes: any[]
  selectedScopeId: string
  onSelectScope: (id: string) => void
  onCancel: () => void
  onConfirm: () => void
  uploading: boolean
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !uploading) onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel, uploading])

  return (
    <div
      role="dialog"
      onClick={() => !uploading && onCancel()}
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
          maxWidth: '640px',
          width: '100%',
          padding: '32px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
        }}
      >
        <h2 style={{ fontSize: '22px', fontWeight: 600, marginTop: 0, marginBottom: '4px' }}>
          Tag this upload
        </h2>
        <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', marginBottom: '20px' }}>
          Which search scope did <strong>{fileName}</strong> come from? This tags every record for provenance so you can trace analysis back to the original scope.
        </p>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            maxHeight: '400px',
            overflowY: 'auto',
            marginBottom: '20px',
            padding: '4px',
          }}
        >
          <ScopeOption
            id=""
            active={selectedScopeId === ''}
            onClick={() => onSelectScope('')}
            title="Not from a scope"
            subtitle="Ad-hoc upload, no provenance tag"
          />
          {scopes.map((s) => (
            <ScopeOption
              key={s.id}
              id={s.id}
              active={selectedScopeId === s.id}
              onClick={() => onSelectScope(s.id)}
              title={s.name}
              subtitle={`#${s.scope_tag} · NAICS ${s.naics_codes.join(', ') || '—'} · PSC ${s.psc_prefixes.join(', ') || '—'}`}
              correlation={s.correlation_score}
            />
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <Button variant="secondary" onClick={onCancel} disabled={uploading}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={uploading}>
            {uploading ? 'Uploading…' : 'Upload & tag'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function ScopeOption({
  active,
  onClick,
  title,
  subtitle,
  correlation,
}: {
  id: string
  active: boolean
  onClick: () => void
  title: string
  subtitle: string
  correlation?: number | null
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '10px 12px',
        background: active ? 'var(--color-bg-subtle)' : 'transparent',
        border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-hairline)'}`,
        borderRadius: 'var(--radius-input)',
        cursor: 'pointer',
        textAlign: 'left',
        fontFamily: 'inherit',
        width: '100%',
      }}
    >
      <div
        style={{
          width: '16px',
          height: '16px',
          borderRadius: '50%',
          border: `2px solid ${active ? 'var(--color-accent)' : 'var(--color-hairline)'}`,
          background: active ? 'var(--color-accent)' : 'transparent',
          flexShrink: 0,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--color-text-primary)', marginBottom: '2px' }}>
          {title}
        </div>
        <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {subtitle}
        </div>
      </div>
      {correlation !== undefined && correlation !== null && (
        <span
          style={{
            fontSize: '11px',
            fontFamily: 'var(--font-mono)',
            color: correlation >= 7 ? '#34C759' : correlation >= 5 ? '#007AFF' : '#D4920A',
            padding: '2px 6px',
            background: correlation >= 7 ? 'rgba(52,199,89,0.12)' : correlation >= 5 ? 'rgba(0,122,255,0.12)' : 'rgba(212,146,10,0.12)',
            borderRadius: '4px',
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          {correlation}/10
        </span>
      )}
    </button>
  )
}

/* ========================================================================== */
/* Market Analysis Panel                                                      */
/* ========================================================================== */

function MarketAnalysisPanel({
  session,
  analyzing,
  onRerun,
}: {
  session: SessionRow
  analyzing: boolean
  onRerun: () => void
}) {
  const analysis = session.market_analysis

  if (analyzing) {
    return (
      <div
        style={{
          background: 'var(--color-bg-elevated)',
          borderRadius: 'var(--radius-card)',
          padding: '32px 24px',
          marginBottom: '24px',
          boxShadow: 'var(--shadow-card)',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: '14px', fontWeight: 500, marginBottom: '6px' }}>
          Running market analysis…
        </div>
        <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
          Extracting value-weighted phrases, ranking vendors and agencies, computing NAICS distribution. ~30 seconds.
        </div>
      </div>
    )
  }

  if (!analysis) return null

  return (
    <div style={{ marginBottom: '32px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '16px', marginBottom: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <h2 style={{ fontSize: '22px', fontWeight: 600, margin: 0 }}>Market analysis</h2>
            {session.source_scope_tags && session.source_scope_tags.length > 0 && (
              <code style={{ fontSize: '11px', padding: '2px 8px', background: 'var(--color-bg-subtle)', borderRadius: '4px', fontFamily: 'var(--font-mono)', color: 'var(--color-text-secondary)' }}>
                #{session.source_scope_tags[0]}
              </code>
            )}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
            {analysis.total_records?.toLocaleString() || '?'} records · ${(analysis.total_dollars || 0).toLocaleString()} total obligated
            {session.market_analysis_at && ` · Analyzed ${new Date(session.market_analysis_at).toLocaleString()}`}
          </div>
        </div>
        <Button variant="secondary" size="small" onClick={onRerun}>
          Re-run
        </Button>
      </div>

      {/* Headline insight + market shape */}
      {(analysis.headline_insight || analysis.market_shape) && (
        <Card padding="large">
          {analysis.headline_insight && (
            <div style={{ marginBottom: analysis.market_shape ? '12px' : 0 }}>
              <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '6px' }}>
                Headline insight
              </div>
              <div style={{ fontSize: '14px', color: 'var(--color-text-primary)', lineHeight: 1.6 }}>
                {analysis.headline_insight}
              </div>
            </div>
          )}
          {analysis.market_shape && (
            <div>
              <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '6px' }}>
                Market shape
              </div>
              <div style={{ fontSize: '14px', color: 'var(--color-text-primary)', lineHeight: 1.6 }}>
                {analysis.market_shape}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Two-column grid: phrases + (vendors / agencies / naics stacked) */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px', marginTop: '16px' }}>
        <PhraseTable phrases={analysis.phrases || []} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <ConcentrationList
            title="Top vendors"
            items={(analysis.top_vendors || []).slice(0, 15)}
            keyField="name"
          />
          <ConcentrationList
            title="Top agencies"
            items={(analysis.top_agencies || []).slice(0, 10)}
            keyField="name"
          />
          <ConcentrationList
            title="Top NAICS"
            items={(analysis.top_naics || []).slice(0, 10)}
            keyField="code"
            mono
          />
        </div>
      </div>
    </div>
  )
}

function PhraseTable({ phrases }: { phrases: any[] }) {
  const [sortKey, setSortKey] = useState<'dollars' | 'count' | 'avg'>('dollars')

  const sorted = [...phrases].sort((a, b) => {
    switch (sortKey) {
      case 'dollars':
        return (b.dollar_volume || 0) - (a.dollar_volume || 0)
      case 'count':
        return (b.count || 0) - (a.count || 0)
      case 'avg':
        return (b.avg_contract || 0) - (a.avg_contract || 0)
    }
  })

  return (
    <Card padding="large">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '12px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>Value-weighted phrases</h3>
        <div style={{ display: 'flex', gap: '4px' }}>
          <SortMini active={sortKey === 'dollars'} onClick={() => setSortKey('dollars')}>$</SortMini>
          <SortMini active={sortKey === 'count'} onClick={() => setSortKey('count')}>Count</SortMini>
          <SortMini active={sortKey === 'avg'} onClick={() => setSortKey('avg')}>Avg</SortMini>
        </div>
      </div>

      <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', marginBottom: '8px', display: 'grid', gridTemplateColumns: '2.5fr 1fr 0.8fr 1fr', gap: '8px', padding: '0 4px' }}>
        <span>Phrase</span>
        <span style={{ textAlign: 'right' }}>$ volume</span>
        <span style={{ textAlign: 'right' }}>Count</span>
        <span style={{ textAlign: 'right' }}>Avg</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {sorted.map((p, i) => (
          <div
            key={i}
            style={{
              display: 'grid',
              gridTemplateColumns: '2.5fr 1fr 0.8fr 1fr',
              gap: '8px',
              padding: '8px 4px',
              borderBottom: '0.5px solid var(--color-hairline)',
              alignItems: 'baseline',
              fontSize: '13px',
            }}
            title={p.context || ''}
          >
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-primary)', fontWeight: 500 }}>
              {p.phrase}
            </span>
            <span style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--color-text-secondary)' }}>
              {formatDollarsBrief(p.dollar_volume)}
            </span>
            <span style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--color-text-secondary)' }}>
              {p.count?.toLocaleString() || '—'}
            </span>
            <span style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--color-text-tertiary)' }}>
              {formatDollarsBrief(p.avg_contract)}
            </span>
          </div>
        ))}
      </div>
    </Card>
  )
}

function ConcentrationList({
  title,
  items,
  keyField,
  mono,
}: {
  title: string
  items: Array<{ name?: string; code?: string; count: number; dollars: number }>
  keyField: 'name' | 'code'
  mono?: boolean
}) {
  if (!items || items.length === 0) {
    return (
      <Card padding="standard">
        <h4 style={{ fontSize: '14px', fontWeight: 600, margin: '0 0 8px 0' }}>{title}</h4>
        <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}>—</div>
      </Card>
    )
  }
  const totalDollars = items.reduce((sum, i) => sum + (i.dollars || 0), 0)

  return (
    <Card padding="standard">
      <h4 style={{ fontSize: '14px', fontWeight: 600, margin: '0 0 10px 0' }}>{title}</h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {items.map((item, i) => {
          const pct = totalDollars > 0 ? (item.dollars / totalDollars) * 100 : 0
          const label = item[keyField] || '?'
          return (
            <div key={i} style={{ fontSize: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', marginBottom: '2px' }}>
                <span
                  style={{
                    fontFamily: mono ? 'var(--font-mono)' : 'inherit',
                    color: 'var(--color-text-primary)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    flex: 1,
                  }}
                  title={label}
                >
                  {label}
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-secondary)', flexShrink: 0 }}>
                  {formatDollarsBrief(item.dollars)}
                </span>
              </div>
              <div style={{ background: 'var(--color-bg-subtle)', height: '3px', borderRadius: '2px', overflow: 'hidden' }}>
                <div style={{ background: 'var(--color-accent)', height: '100%', width: `${pct}%` }} />
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function SortMini({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: '11px',
        padding: '3px 8px',
        border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-hairline)'}`,
        borderRadius: '4px',
        background: active ? 'var(--color-accent)' : 'transparent',
        color: active ? 'white' : 'var(--color-text-secondary)',
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {children}
    </button>
  )
}

function formatDollarsBrief(n: number | null | undefined): string {
  if (n === null || n === undefined || n === 0) return '—'
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n}`
}
