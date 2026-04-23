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
  round_number: number
  turn_number: number | null
  status: string
  record_count: number
  file_name: string | null
  display_name: string | null
  methodology: any | null
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
  const [_enriching, setEnriching] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [viewingRecord, setViewingRecord] = useState<RecordRow | null>(null)
  const [pendingUpload, setPendingUpload] = useState<File | null>(null)
  const [selectedScopeId, setSelectedScopeId] = useState<string>('')
  const [uploadThreshold, setUploadThreshold] = useState<number>(0)
  const [parsedRowCount, setParsedRowCount] = useState<number | null>(null)

  // Session methodology form state (required at upload time)
  const [methodNaicsCodes, setMethodNaicsCodes] = useState<string[]>([])
  const [methodNaicsRationale, setMethodNaicsRationale] = useState('')
  const [methodPscPrefixes, setMethodPscPrefixes] = useState<string[]>([])
  const [methodPscRationale, setMethodPscRationale] = useState('')
  const [methodDateStart, setMethodDateStart] = useState('')
  const [methodDateEnd, setMethodDateEnd] = useState('')
  const [methodDateRationale, setMethodDateRationale] = useState('')
  const [methodThresholdRationale, setMethodThresholdRationale] = useState('')
  const [methodDisplayName, setMethodDisplayName] = useState('')

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

  const currentRound = tenant?.current_round || 1

  // Sessions within the current round
  const currentRoundSessions = sessions.filter((s) => (s.round_number || 1) === currentRound)
  const maxTurnInRound = currentRoundSessions.reduce(
    (m, s) => Math.max(m, s.turn_number || 0),
    0
  )
  const nextTurnInRound = maxTurnInRound + 1

  // Legacy iteration counter (still used by the insert below as a fallback)
  const maxIteration = sessions.reduce((m, s) => Math.max(m, s.iteration), 0)
  const nextIteration = maxIteration + 1

  const hasProfile = !!commercialProfile?.synthesized_text

  const handleFileChosen = async (file: File) => {
    // Stage 1: user picked a file. Parse the row count so the scope picker can
    // show how many records will be ingested. Methodology fields are set by the
    // user in the modal; rationales required before upload.
    setError(null)
    setPendingUpload(file)
    setSelectedScopeId('')
    setUploadThreshold(0)
    setParsedRowCount(null)
    setMethodNaicsCodes([])
    setMethodNaicsRationale('')
    setMethodPscPrefixes([])
    setMethodPscRationale('')
    setMethodDateStart('')
    setMethodDateEnd('')
    setMethodDateRationale('')
    setMethodThresholdRationale('')
    setMethodDisplayName('')
    try {
      const text = await file.text()
      const rows = parseCsv(text)
      setParsedRowCount(rows.length)
    } catch {
      setParsedRowCount(null)
    }
  }

  const submitUpload = async () => {
    if (!tenant || !pendingUpload) return
    const file = pendingUpload
    setUploading(true)

    try {
      const text = await file.text()
      const rows = parseCsv(text)
      const mapped = rows.map(mapCsvRowToRecord)

      // Apply the per-upload threshold (user-controlled, not a system setting).
      // Default = 0 = keep all records. Keep records with value >= threshold.
      // If a record has no dollar value at all but threshold is 0, still keep it.
      const withValues = mapped.filter((r: any) => typeof r.obligated === 'number')
      const filtered = mapped.filter((r: any) => {
        const v = typeof r.obligated === 'number' ? r.obligated : null
        if (uploadThreshold === 0) return true  // keep everything at threshold 0
        return v !== null && v >= uploadThreshold
      })

      if (filtered.length === 0) {
        if (withValues.length === 0) {
          setError(
            `CSV parsed ${rows.length} rows but no recognizable dollar-value column was found. ` +
            `Expected one of: total_obligated_amount, obligated_amount, obligated, current_total_value_of_award, award_amount. ` +
            `Open the CSV and check the column headers.`
          )
        } else {
          setError(
            `CSV parsed ${rows.length} rows and ${withValues.length} had dollar values, but none were >= $${uploadThreshold.toLocaleString()}. ` +
            `Lower the threshold (set to $0 to keep all) or upload a different export.`
          )
        }
        setUploading(false)
        setPendingUpload(null)
        return
      }

      // Resolve the selected scope (may be empty string = "not from a scope")
      const scope = searchScopes.find((s) => s.id === selectedScopeId) || null

      // === DEDUPE AGAINST EXISTING TENANT RECORDS ===
      // Key: (tenant_id, contract_number, contract_award_unique_key).
      // contract_number is the PIID (USASpending award_id_piid).
      // contract_award_unique_key is the full composite ID.
      // A record is a true dupe only if BOTH match. Otherwise it's a distinct row.

      // Build a set of lookup keys from the incoming file (only for rows with a PIID)
      const candidateKeys = new Set<string>()
      for (const r of filtered as any[]) {
        if (r.contract_number) {
          candidateKeys.add(`${r.contract_number}::${r.contract_award_unique_key || ''}`)
        }
      }

      // Fetch existing records for this tenant matching any of those PIIDs
      const piids = Array.from(new Set(filtered.map((r: any) => r.contract_number).filter(Boolean)))
      const existingByKey = new Map<string, any>()
      if (piids.length > 0) {
        // Chunked IN query (Supabase has practical URL length limits around ~2000 PIIDs)
        const chunkSize = 500
        for (let i = 0; i < piids.length; i += chunkSize) {
          const chunk = piids.slice(i, i + chunkSize)
          const { data: existing } = await supabase
            .from('enrichment_records')
            .select('id, contract_number, contract_award_unique_key, source_scope_tags, source_scope_ids, source_session_ids, obligated')
            .eq('tenant_id', tenant.id)
            .in('contract_number', chunk)
          for (const e of (existing as any[]) || []) {
            existingByKey.set(`${e.contract_number}::${e.contract_award_unique_key || ''}`, e)
          }
        }
      }

      // Partition the incoming rows
      const newRecords: any[] = []
      const existingToRetag: any[] = []
      const trueDupes: any[] = []
      for (const r of filtered as any[]) {
        if (!r.contract_number) {
          newRecords.push(r)  // no PIID, can't dedupe — keep as new
          continue
        }
        const key = `${r.contract_number}::${r.contract_award_unique_key || ''}`
        const existing = existingByKey.get(key)
        if (existing) {
          // Both PIID and unique key match. If the scope is already in this record's
          // tags, this is a true duplicate and should be discarded entirely.
          const alreadyTagged = scope && existing.source_scope_tags?.includes(scope.scope_tag)
          if (alreadyTagged) {
            trueDupes.push(existing)
          } else {
            existingToRetag.push({ existing, incoming: r })
          }
        } else {
          newRecords.push(r)
        }
      }

      // Create the session. Record count = new + re-tagged (not true dupes).
      const effectiveCount = newRecords.length + existingToRetag.length

      if (effectiveCount === 0) {
        setError(
          `All ${filtered.length} records in this CSV are already in the database and already tagged to the selected scope. No new contracts to add.`
        )
        setUploading(false)
        setPendingUpload(null)
        return
      }

      const methodology = {
        naics_codes: methodNaicsCodes,
        naics_rationale: methodNaicsRationale,
        psc_prefixes: methodPscPrefixes,
        psc_rationale: methodPscRationale,
        date_range_start: methodDateStart || null,
        date_range_end: methodDateEnd || null,
        date_range_rationale: methodDateRationale,
        min_dollar_value: uploadThreshold,
        min_dollar_rationale: methodThresholdRationale,
      }

      const finalDisplayName = methodDisplayName.trim() || computedDisplayName

      const { data: sessionData, error: sessionError } = await supabase
        .from('enrichment_sessions')
        .insert({
          tenant_id: tenant.id,
          iteration: nextIteration,
          round_number: currentRound,
          turn_number: nextTurnInRound,
          file_name: file.name,
          display_name: finalDisplayName,
          methodology,
          record_count: effectiveCount,
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

      // Insert NEW records with scope provenance arrays
      const batchSize = 100
      for (let i = 0; i < newRecords.length; i += batchSize) {
        const batch = newRecords.slice(i, i + batchSize).map((r: any) => ({
          ...r,
          session_id: session.session_id,
          tenant_id: tenant.id,
          iteration: session.iteration,
          enrichment_status: 'pending',
          source_scope_id: scope?.id || null,
          source_scope_tag: scope?.scope_tag || null,
          source_scope_tags: scope ? [scope.scope_tag] : [],
          source_scope_ids: scope ? [scope.id] : [],
          source_session_ids: [session.session_id],
        }))

        const { error: insertError } = await supabase
          .from('enrichment_records')
          .insert(batch)

        if (insertError) {
          throw new Error(`Row insert failed: ${insertError.message}`)
        }
      }

      // Append scope + session to EXISTING records that were re-tagged
      if (scope && existingToRetag.length > 0) {
        for (const pair of existingToRetag) {
          const e = pair.existing
          const newTags = Array.from(new Set([...(e.source_scope_tags || []), scope.scope_tag]))
          const newIds = Array.from(new Set([...(e.source_scope_ids || []), scope.id]))
          const newSessionIds = Array.from(
            new Set([...(e.source_session_ids || []), session.session_id])
          )
          await supabase
            .from('enrichment_records')
            .update({
              source_scope_tags: newTags,
              source_scope_ids: newIds,
              source_session_ids: newSessionIds,
            })
            .eq('id', e.id)
        }
      }

      // Backfill actual counts on the scope (new + retagged, since both surface under this scope)
      if (scope) {
        const allTaggedObligated =
          newRecords.reduce((sum: number, r: any) => sum + (typeof r.obligated === 'number' ? r.obligated : 0), 0) +
          existingToRetag.reduce((sum: number, p: any) => sum + (typeof p.existing.obligated === 'number' ? p.existing.obligated : 0), 0)

        // Actual count = all records for this tenant carrying this scope tag (after our update)
        const { count: scopeRecordCount } = await supabase
          .from('enrichment_records')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenant.id)
          .contains('source_scope_tags', [scope.scope_tag])

        await supabase
          .from('search_scopes')
          .update({
            actual_award_count: scopeRecordCount ?? effectiveCount,
            actual_dollar_volume: Math.round(allTaggedObligated),
            last_imported_at: new Date().toISOString(),
          })
          .eq('id', scope.id)
        if (tenant) await loadProfileData(tenant.id)
      }

      // User-facing summary of what happened
      if (existingToRetag.length > 0 || trueDupes.length > 0) {
        const msg = `Imported ${newRecords.length} new contracts. ${existingToRetag.length} already existed from other scopes — re-tagged with #${scope?.scope_tag || 'no_scope'}. ${trueDupes.length} exact duplicates discarded.`
        console.log(msg)
      }

      await loadSessions()
      await loadRecordsForSession(session)
      setUploading(false)
      setPendingUpload(null)
      setSelectedScopeId('')

      // Auto-trigger keyword analysis
      runKeywordAnalysis(session)
    } catch (err: any) {
      setError(err?.message || 'Upload failed')
      setUploading(false)
      setPendingUpload(null)
    }
  }

  const cancelUpload = () => {
    setPendingUpload(null)
    setSelectedScopeId('')
    setUploadThreshold(0)
    setParsedRowCount(null)
    setMethodNaicsCodes([])
    setMethodNaicsRationale('')
    setMethodPscPrefixes([])
    setMethodPscRationale('')
    setMethodDateStart('')
    setMethodDateEnd('')
    setMethodDateRationale('')
    setMethodThresholdRationale('')
    setMethodDisplayName('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // Called when user picks a scope in the modal — prefills NAICS, PSC, and
  // rationales from the scope (user can edit).
  const handleScopeSelected = (scopeId: string) => {
    setSelectedScopeId(scopeId)
    const scope = searchScopes.find((s) => s.id === scopeId)
    if (scope) {
      // Only prefill empty fields — don't overwrite user edits
      if (methodNaicsCodes.length === 0) setMethodNaicsCodes(scope.naics_codes || [])
      if (methodPscPrefixes.length === 0) setMethodPscPrefixes(scope.psc_prefixes || [])
      if (!methodNaicsRationale && scope.rationale) setMethodNaicsRationale(scope.rationale)
      if (!methodPscRationale && scope.rationale) setMethodPscRationale(scope.rationale)
    } else {
      // Cleared scope — allow user to enter NAICS/PSC manually
      if (methodNaicsCodes.length === 0) setMethodNaicsCodes([])
      if (methodPscPrefixes.length === 0) setMethodPscPrefixes([])
    }
  }

  // Auto-generate a display name from the current methodology fields
  const computedDisplayName = (() => {
    const parts: string[] = []
    if (methodNaicsCodes.length > 0) {
      parts.push(`NAICS ${methodNaicsCodes.join(', ')}`)
    }
    if (methodPscPrefixes.length > 0) {
      parts.push(`PSC ${methodPscPrefixes.join(', ')}`)
    }
    if (methodDateStart || methodDateEnd) {
      if (methodDateStart && methodDateEnd) {
        parts.push(`${methodDateStart} to ${methodDateEnd}`)
      } else if (methodDateStart) {
        parts.push(`${methodDateStart}+`)
      } else if (methodDateEnd) {
        parts.push(`through ${methodDateEnd}`)
      }
    }
    if (uploadThreshold > 0) {
      parts.push(`$${uploadThreshold.toLocaleString()}+`)
    }
    return parts.join(' · ') || 'Untagged session'
  })()

  // Form validation: all four "why" rationales required
  const methodologyValid =
    methodNaicsCodes.length > 0 &&
    methodNaicsRationale.trim().length >= 10 &&
    methodPscPrefixes.length > 0 &&
    methodPscRationale.trim().length >= 10 &&
    methodDateRationale.trim().length >= 10 &&
    methodThresholdRationale.trim().length >= 10

  const runKeywordAnalysis = async (session: SessionRow) => {
    if (!tenant) return
    if (!commercialProfile?.synthesized_text) {
      setError('Build the commercial profile on the Onboard tab before running keyword analysis.')
      return
    }
    setAnalyzing(true)
    setError(null)
    try {
      const { data: allRecords } = await supabase
        .from('enrichment_records')
        .select('obligated, description')
        .eq('session_id', session.session_id)
        .is('deleted_at', null)

      if (!allRecords || allRecords.length === 0) {
        setError('No records found in session.')
        setAnalyzing(false)
        return
      }

      // Compute total dollars in JS for the prompt header
      const totalDollars = allRecords.reduce((sum: number, r: any) => {
        return sum + (typeof r.obligated === 'number' ? r.obligated : 0)
      }, 0)

      // Prepare the corpus — truncate long descriptions to keep prompt bounded
      const lines: string[] = allRecords.map((r: any) => {
        const desc = (r.description || '').slice(0, 500)
        const val = typeof r.obligated === 'number' ? r.obligated : 0
        return `[$${val.toLocaleString()}] ${desc}`
      })

      // If dataset is large, cap at 600 records in the prompt. We're asking Claude
      // to extract phrase frequency patterns, not parse every row — a representative
      // sample works fine and keeps us well under context limits.
      const sampleSize = Math.min(lines.length, 600)
      const corpusSample = lines.slice(0, sampleSize).join('\n')

      const prompt = `You are analyzing a federal contract dataset to extract candidate Round 1 search keywords for ${tenant.name}.

## ABOUT ${tenant.name.toUpperCase()}
${commercialProfile.synthesized_text}

## DATASET
${allRecords.length.toLocaleString()} contract records. Total obligated: $${totalDollars.toLocaleString()}.
${lines.length > sampleSize ? `(Showing ${sampleSize.toLocaleString()} representative records — phrase frequency patterns are consistent across the full dataset.)` : ''}

Each line below is one contract: [dollar value] description

${corpusSample}

## TASK
Extract candidate search keywords from the contract descriptions — phrases a contracting officer would use in SOW language. For each phrase, provide:

1. **Value-weighted frequency data:**
   - \`dollar_volume\`: total contract dollars across records containing this phrase
   - \`count\`: number of contracts containing this phrase
   - \`avg_contract\`: dollar_volume / count
   - \`context\`: 1 short sentence on what kind of work this phrase signals

2. **Relevance score to ${tenant.name} (1-10):**
   - 10 = perfect capability match, direct bullseye
   - 8-9 = strong match, core capability applies
   - 6-7 = clear adjacent application
   - 4-5 = tangentially relevant, would need positioning work
   - 1-3 = weak match, unlikely fit
   - Include a \`relevance_rationale\`: 1 sentence on why this score

Rules:
- Phrases must be 1-3 words
- Use contracting-officer language from the actual descriptions, not marketing terms
- NO vendor names, agency names, NAICS/PSC labels, or generic filler ("services", "support")
- Return 30-50 phrases so the user has a strong list to pick from
- Score relevance honestly — low scores are fine and informative, don't inflate

Return ONLY valid JSON in a \`\`\`json block, no other text:

\`\`\`json
{
  "phrases": [
    {
      "phrase": "...",
      "dollar_volume": 12500000,
      "count": 15,
      "avg_contract": 833333,
      "context": "...",
      "relevance_score": 8,
      "relevance_rationale": "..."
    }
  ]
}
\`\`\``

      const { text } = await callClaudeBrowser(prompt, {
        model: 'claude-sonnet-4-5',
        maxTokens: 6000,
      })

      const parsed = extractJsonBlock(text)
      if (!parsed || !Array.isArray(parsed.phrases)) {
        throw new Error('Keyword analysis returned no parseable output')
      }

      // Normalize and clamp each phrase
      const normalized = parsed.phrases.map((p: any) => ({
        phrase: String(p.phrase || '').trim(),
        dollar_volume: typeof p.dollar_volume === 'number' ? p.dollar_volume : 0,
        count: typeof p.count === 'number' ? p.count : 0,
        avg_contract: typeof p.avg_contract === 'number' ? p.avg_contract : 0,
        context: p.context || '',
        relevance_score:
          typeof p.relevance_score === 'number'
            ? Math.max(1, Math.min(10, Math.round(p.relevance_score)))
            : null,
        relevance_rationale: p.relevance_rationale || '',
      })).filter((p: any) => p.phrase.length > 0)

      const analysis = {
        total_records: allRecords.length,
        total_dollars: totalDollars,
        phrases: normalized,
      }

      await supabase
        .from('enrichment_sessions')
        .update({
          market_analysis: analysis,
          market_analysis_at: new Date().toISOString(),
        })
        .eq('session_id', session.session_id)

      await loadSessions()
      // Reload active session to pick up the new analysis
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
      setError(err?.message || 'Keyword analysis failed')
      setAnalyzing(false)
    }
  }

  async function saveKeywordsToBank(phrases: any[], session: SessionRow) {
    if (!tenant || phrases.length === 0) return
    const scopeId = (session.source_scope_ids && session.source_scope_ids[0]) || null
    const scopeTag = (session.source_scope_tags && session.source_scope_tags[0]) || null

    const inserts = phrases.map((p: any) => ({
      tenant_id: tenant.id,
      phrase: p.phrase,
      dollar_volume: p.dollar_volume || null,
      award_count: p.count || null,
      avg_contract: p.avg_contract || null,
      relevance_score: p.relevance_score || null,
      relevance_rationale: p.relevance_rationale || null,
      claude_context: p.context || null,
      source_scope_id: scopeId,
      source_scope_tag: scopeTag,
      source_session_id: session.session_id,
    }))

    // Use upsert-style insert with onConflict on (tenant_id, phrase)
    // If a keyword already picked, silently skip (user can see it in bank anyway)
    const { error: insertError } = await supabase
      .from('round_1_keywords')
      .upsert(inserts, { onConflict: 'tenant_id,phrase', ignoreDuplicates: true })

    if (insertError) {
      setError(`Failed to save keywords: ${insertError.message}`)
      return
    }
  }

  // @ts-expect-error kept for future round 2+ fit scoring reinstatement
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

  const roundMetaMap: Record<number, { label: string; subtitle: string }> = {
    1: {
      label: 'Round 1 — Discovery',
      subtitle: `Stack NAICS/PSC scope uploads. Each upload becomes a turn within Round 1. Keywords accumulate in the bank until you advance to Round 2.`,
    },
    2: {
      label: 'Round 2 — Targeted',
      subtitle: `Upload datasets built from your curated Round 1 keywords. Records get fit-scored against ${tenant.name}'s profile.`,
    },
    3: {
      label: 'Round 3 — Vendor intelligence',
      subtitle: `Upload vendor-focused datasets to deep-dive on specific awardees, primes, or teaming candidates.`,
    },
  }
  const roundMeta = roundMetaMap[currentRound] || {
    label: `Round ${currentRound}`,
    subtitle: 'Continue adding turns within this round.',
  }

  const advanceRound = async () => {
    if (!tenant) return
    const nextRound = currentRound + 1
    if (!confirm(`Move to Round ${nextRound}? You can always return to Round ${currentRound} later.`)) return
    await supabase.from('tenants').update({ current_round: nextRound }).eq('id', tenant.id)
    await useStore.getState().setActiveTenant(tenant.id)
  }

  const returnToPreviousRound = async () => {
    if (!tenant || currentRound <= 1) return
    const prevRound = currentRound - 1
    if (!confirm(`Return to Round ${prevRound}? You'll be able to add more turns to that round.`)) return
    await supabase.from('tenants').update({ current_round: prevRound }).eq('id', tenant.id)
    await useStore.getState().setActiveTenant(tenant.id)
  }

  return (
    <TabPage
      eyebrow={`${roundMeta.label} · Turn ${nextTurnInRound} incoming`}
      title="Enrichment"
      description={roundMeta.subtitle}
      actions={
        <div style={{ display: 'flex', gap: '8px' }}>
          {currentRound > 1 && (
            <Button variant="secondary" size="small" onClick={returnToPreviousRound}>
              ← Return to Round {currentRound - 1}
            </Button>
          )}
          <Button size="small" onClick={advanceRound}>
            Move to Enrichment Round {currentRound + 1}
          </Button>
        </div>
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
          Drop Round {currentRound} · Turn {nextTurnInRound} export here
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

      {/* Keyword Analysis panel */}
      {activeSession && (activeSession.market_analysis || analyzing) && (
        <KeywordAnalysisPanel
          session={activeSession}
          analyzing={analyzing}
          onRerun={() => runKeywordAnalysis(activeSession)}
          onSaveKeywords={(phrases) => saveKeywordsToBank(phrases, activeSession)}
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
              Keyword analysis not run yet
            </div>
            <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
              Extract candidate Round 1 keywords from the contract descriptions, weighted by dollar volume and scored for relevance to {tenant.name}.
            </div>
          </div>
          <Button size="small" onClick={() => runKeywordAnalysis(activeSession)}>
            Run keyword analysis
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
                  <div style={{ fontSize: '14px', fontWeight: 500 }}>
                    Round {s.round_number || 1} · Turn {s.turn_number || s.iteration}
                  </div>
                  {s.display_name && (
                    <div style={{ fontSize: '13px', color: 'var(--color-text-primary)', marginTop: '3px', fontWeight: 500 }}>
                      {s.display_name}
                    </div>
                  )}
                  <div
                    style={{
                      fontSize: '11px',
                      color: 'var(--color-text-secondary)',
                      marginTop: '3px',
                    }}
                  >
                    {s.record_count} records · {s.status}
                    {s.source_scope_tags && s.source_scope_tags.length > 0 && (
                      <> · #{s.source_scope_tags[0]}</>
                    )}
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
                {activeSession
                  ? activeSession.display_name
                    ? `${activeSession.display_name} — Round ${activeSession.round_number || 1} · Turn ${activeSession.turn_number || activeSession.iteration}`
                    : `Records — Round ${activeSession.round_number || 1} · Turn ${activeSession.turn_number || activeSession.iteration}`
                  : 'No session selected'}
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
          rowCount={parsedRowCount}
          threshold={uploadThreshold}
          onChangeThreshold={setUploadThreshold}
          scopes={searchScopes.filter((s) => !s.archived)}
          selectedScopeId={selectedScopeId}
          onSelectScope={handleScopeSelected}
          // Methodology fields
          naicsCodes={methodNaicsCodes}
          onChangeNaics={setMethodNaicsCodes}
          naicsRationale={methodNaicsRationale}
          onChangeNaicsRationale={setMethodNaicsRationale}
          pscPrefixes={methodPscPrefixes}
          onChangePsc={setMethodPscPrefixes}
          pscRationale={methodPscRationale}
          onChangePscRationale={setMethodPscRationale}
          dateStart={methodDateStart}
          onChangeDateStart={setMethodDateStart}
          dateEnd={methodDateEnd}
          onChangeDateEnd={setMethodDateEnd}
          dateRationale={methodDateRationale}
          onChangeDateRationale={setMethodDateRationale}
          thresholdRationale={methodThresholdRationale}
          onChangeThresholdRationale={setMethodThresholdRationale}
          displayName={methodDisplayName}
          onChangeDisplayName={setMethodDisplayName}
          computedDisplayName={computedDisplayName}
          methodologyValid={methodologyValid}
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
  rowCount,
  threshold,
  onChangeThreshold,
  scopes,
  selectedScopeId,
  onSelectScope,
  naicsCodes,
  onChangeNaics,
  naicsRationale,
  onChangeNaicsRationale,
  pscPrefixes,
  onChangePsc,
  pscRationale,
  onChangePscRationale,
  dateStart,
  onChangeDateStart,
  dateEnd,
  onChangeDateEnd,
  dateRationale,
  onChangeDateRationale,
  thresholdRationale,
  onChangeThresholdRationale,
  displayName,
  onChangeDisplayName,
  computedDisplayName,
  methodologyValid,
  onCancel,
  onConfirm,
  uploading,
}: {
  fileName: string
  rowCount: number | null
  threshold: number
  onChangeThreshold: (n: number) => void
  scopes: any[]
  selectedScopeId: string
  onSelectScope: (id: string) => void
  naicsCodes: string[]
  onChangeNaics: (codes: string[]) => void
  naicsRationale: string
  onChangeNaicsRationale: (v: string) => void
  pscPrefixes: string[]
  onChangePsc: (codes: string[]) => void
  pscRationale: string
  onChangePscRationale: (v: string) => void
  dateStart: string
  onChangeDateStart: (v: string) => void
  dateEnd: string
  onChangeDateEnd: (v: string) => void
  dateRationale: string
  onChangeDateRationale: (v: string) => void
  thresholdRationale: string
  onChangeThresholdRationale: (v: string) => void
  displayName: string
  onChangeDisplayName: (v: string) => void
  computedDisplayName: string
  methodologyValid: boolean
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
          maxWidth: '720px',
          width: '100%',
          maxHeight: '92vh',
          overflowY: 'auto',
          padding: '32px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
        }}
      >
        <h2 style={{ fontSize: '22px', fontWeight: 600, marginTop: 0, marginBottom: '4px' }}>
          Confirm upload & capture methodology
        </h2>
        <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', marginBottom: '20px' }}>
          <strong>{fileName}</strong>
          {rowCount !== null && (
            <> · <span style={{ fontFamily: 'var(--font-mono)' }}>{rowCount.toLocaleString()}</span> rows parsed</>
          )}
          <br />
          <span style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
            Every field below is captured in the methodology report so the client sees exactly why we pulled what we pulled.
          </span>
        </p>

        {/* Scope picker */}
        <FieldSection
          label="Which scope did this come from?"
          hint="Prefills NAICS and PSC below; you can still edit them."
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '260px', overflowY: 'auto', padding: '4px' }}>
            <ScopeOption
              id=""
              active={selectedScopeId === ''}
              onClick={() => onSelectScope('')}
              title="Not from a scope"
              subtitle="Ad-hoc upload — manual NAICS/PSC entry required"
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
        </FieldSection>

        {/* NAICS */}
        <FieldSection label="NAICS codes" required hint="Comma-separated 6-digit codes, e.g. 541513, 518210">
          <ChipInput values={naicsCodes} onChange={onChangeNaics} placeholder="541513" />
          <TextareaInput
            value={naicsRationale}
            onChange={onChangeNaicsRationale}
            placeholder="Why these NAICS codes? (min 10 chars) — e.g. 'Targeting computer-systems-design and hosting codes where Manifold's compute infrastructure maps to federal buying patterns.'"
            minRows={2}
          />
        </FieldSection>

        {/* PSC */}
        <FieldSection label="PSC prefixes" required hint="Comma-separated PSC prefixes, e.g. D3, R-, A-">
          <ChipInput values={pscPrefixes} onChange={onChangePsc} placeholder="D3" uppercase />
          <TextareaInput
            value={pscRationale}
            onChange={onChangePscRationale}
            placeholder="Why these PSC prefixes? (min 10 chars) — e.g. 'D3 is the federal IT services prefix. Excluded R- (support, too broad) and 70 (IT equipment, Manifold isn't a hardware vendor).'"
            minRows={2}
          />
        </FieldSection>

        {/* Date range */}
        <FieldSection label="Date range (external pre-filter)" required hint="What date range did you filter on in USASpending/HigherGov?">
          <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
            <input
              type="date"
              value={dateStart}
              onChange={(e) => onChangeDateStart(e.target.value)}
              style={inputStyle}
              placeholder="Start"
            />
            <span style={{ alignSelf: 'center', color: 'var(--color-text-tertiary)', fontSize: '13px' }}>to</span>
            <input
              type="date"
              value={dateEnd}
              onChange={(e) => onChangeDateEnd(e.target.value)}
              style={inputStyle}
              placeholder="End (blank = present)"
            />
          </div>
          <TextareaInput
            value={dateRationale}
            onChange={onChangeDateRationale}
            placeholder="Why this date range? (min 10 chars) — e.g. 'Trump admin took office Jan 2025 and reshaped federal procurement. Pre-2025 awards are largely noise for the forward market.'"
            minRows={2}
          />
        </FieldSection>

        {/* Threshold */}
        <FieldSection label="Minimum obligated value" required>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <span style={{ fontSize: '14px', color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)' }}>$</span>
            <input
              type="number"
              min={0}
              step={1000}
              value={threshold}
              onChange={(e) => onChangeThreshold(Math.max(0, parseInt(e.target.value || '0', 10)))}
              style={{ ...inputStyle, flex: 1 }}
            />
            <Button variant="secondary" size="small" onClick={() => onChangeThreshold(0)}>
              $0 (keep all)
            </Button>
          </div>
          <TextareaInput
            value={thresholdRationale}
            onChange={onChangeThresholdRationale}
            placeholder="Why this threshold? (min 10 chars) — e.g. 'Zero threshold intentional — need full dataset for phrase frequency. Filtering applies at keyword-picking stage.'"
            minRows={2}
          />
        </FieldSection>

        {/* Session display name */}
        <FieldSection label="Session name" hint="Auto-generated from your metadata above. Edit to override.">
          <input
            type="text"
            value={displayName || computedDisplayName}
            onChange={(e) => onChangeDisplayName(e.target.value)}
            placeholder={computedDisplayName}
            style={inputStyle}
          />
        </FieldSection>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '8px',
            marginTop: '24px',
            paddingTop: '16px',
            borderTop: '1px solid var(--color-hairline)',
          }}
        >
          <div style={{ fontSize: '12px', color: methodologyValid ? 'var(--color-success)' : 'var(--color-text-tertiary)' }}>
            {methodologyValid ? '✓ All rationales provided' : 'All four rationales (≥10 chars each) required'}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button variant="secondary" onClick={onCancel} disabled={uploading}>
              Cancel
            </Button>
            <Button onClick={onConfirm} disabled={uploading || !methodologyValid}>
              {uploading ? 'Uploading…' : 'Upload & tag'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  fontSize: '13px',
  padding: '8px 10px',
  border: '1px solid var(--color-hairline)',
  borderRadius: 'var(--radius-input)',
  background: 'var(--color-bg-primary)',
  color: 'var(--color-text-primary)',
  fontFamily: 'inherit',
  width: '100%',
  boxSizing: 'border-box',
}

function FieldSection({
  label,
  required,
  hint,
  children,
}: {
  label: string
  required?: boolean
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div style={{ marginBottom: '18px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '6px' }}>
        <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-primary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {label}{required && <span style={{ color: 'var(--color-danger)', marginLeft: '3px' }}>*</span>}
        </label>
        {hint && <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>{hint}</span>}
      </div>
      {children}
    </div>
  )
}

function ChipInput({
  values,
  onChange,
  placeholder,
  uppercase,
}: {
  values: string[]
  onChange: (v: string[]) => void
  placeholder?: string
  uppercase?: boolean
}) {
  const [input, setInput] = useState('')

  const commit = () => {
    const cleaned = (uppercase ? input.toUpperCase() : input).trim()
    if (cleaned && !values.includes(cleaned)) {
      onChange([...values, cleaned])
    }
    setInput('')
  }

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '6px',
        padding: '6px',
        border: '1px solid var(--color-hairline)',
        borderRadius: 'var(--radius-input)',
        background: 'var(--color-bg-primary)',
        minHeight: '36px',
        alignItems: 'center',
        marginBottom: '8px',
      }}
    >
      {values.map((v, i) => (
        <span
          key={i}
          style={{
            fontSize: '12px',
            padding: '3px 8px',
            background: 'var(--color-bg-subtle)',
            border: '1px solid var(--color-hairline)',
            borderRadius: '4px',
            fontFamily: 'var(--font-mono)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          {v}
          <button
            onClick={() => onChange(values.filter((_, j) => j !== i))}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--color-text-tertiary)',
              cursor: 'pointer',
              padding: 0,
              fontSize: '14px',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </span>
      ))}
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(uppercase ? e.target.value.toUpperCase() : e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab') {
            e.preventDefault()
            commit()
          }
        }}
        onBlur={commit}
        placeholder={values.length === 0 ? placeholder : ''}
        style={{
          border: 'none',
          background: 'transparent',
          outline: 'none',
          fontSize: '13px',
          fontFamily: 'var(--font-mono)',
          minWidth: '80px',
          flex: 1,
          padding: '2px 4px',
        }}
      />
    </div>
  )
}

function TextareaInput({
  value,
  onChange,
  placeholder,
  minRows = 2,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  minRows?: number
}) {
  const tooShort = value.trim().length > 0 && value.trim().length < 10
  return (
    <div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={minRows}
        style={{
          ...inputStyle,
          resize: 'vertical',
          fontFamily: 'inherit',
          lineHeight: 1.5,
          borderColor: tooShort ? 'var(--color-warning)' : 'var(--color-hairline)',
        }}
      />
      {tooShort && (
        <div style={{ fontSize: '11px', color: 'var(--color-warning)', marginTop: '2px' }}>
          {10 - value.trim().length} more characters needed
        </div>
      )}
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

/* ========================================================================== */
/* Keyword Analysis Panel                                                     */
/* ========================================================================== */

interface KeywordPhrase {
  phrase: string
  dollar_volume: number
  count: number
  avg_contract: number
  context: string
  relevance_score: number | null
  relevance_rationale: string
}

type KeywordSortKey = 'relevance' | 'dollars' | 'count' | 'avg' | 'phrase'

function KeywordAnalysisPanel({
  session,
  analyzing,
  onRerun,
  onSaveKeywords,
}: {
  session: SessionRow
  analyzing: boolean
  onRerun: () => void
  onSaveKeywords: (phrases: KeywordPhrase[]) => Promise<void>
}) {
  const analysis = session.market_analysis
  const allPhrases: KeywordPhrase[] = analysis?.phrases || []

  const [sortKey, setSortKey] = useState<KeywordSortKey>('relevance')
  const [sortDesc, setSortDesc] = useState(true)
  const [selectedPhrases, setSelectedPhrases] = useState<Set<string>>(new Set())
  const [minRelevance, setMinRelevance] = useState<number>(1)
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)

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
          Analyzing dataset…
        </div>
        <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
          Reading contract descriptions, weighting by dollar value, scoring relevance. ~30-60 seconds.
        </div>
      </div>
    )
  }

  if (!analysis) return null

  // Apply filters and sort
  const filtered = allPhrases.filter((p) => (p.relevance_score ?? 0) >= minRelevance)
  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0
    switch (sortKey) {
      case 'relevance':
        cmp = (a.relevance_score ?? 0) - (b.relevance_score ?? 0)
        break
      case 'dollars':
        cmp = (a.dollar_volume || 0) - (b.dollar_volume || 0)
        break
      case 'count':
        cmp = (a.count || 0) - (b.count || 0)
        break
      case 'avg':
        cmp = (a.avg_contract || 0) - (b.avg_contract || 0)
        break
      case 'phrase':
        cmp = a.phrase.localeCompare(b.phrase)
        break
    }
    return sortDesc ? -cmp : cmp
  })

  const toggleSort = (key: KeywordSortKey) => {
    if (sortKey === key) {
      setSortDesc(!sortDesc)
    } else {
      setSortKey(key)
      setSortDesc(true)
    }
  }

  const togglePhrase = (phrase: string) => {
    const next = new Set(selectedPhrases)
    if (next.has(phrase)) next.delete(phrase)
    else next.add(phrase)
    setSelectedPhrases(next)
  }

  const selectAllVisible = () => {
    setSelectedPhrases(new Set(sorted.map((p) => p.phrase)))
  }

  const clearSelection = () => setSelectedPhrases(new Set())

  const handleSave = async () => {
    setSaving(true)
    setSaveMessage(null)
    const toSave = sorted.filter((p) => selectedPhrases.has(p.phrase))
    try {
      await onSaveKeywords(toSave)
      setSaveMessage(`Saved ${toSave.length} keyword${toSave.length === 1 ? '' : 's'} to Round 1 bank`)
      setSelectedPhrases(new Set())
      setTimeout(() => setSaveMessage(null), 4000)
    } catch (err: any) {
      setSaveMessage(`Error: ${err.message || 'save failed'}`)
    }
    setSaving(false)
  }

  const selectedCount = selectedPhrases.size

  return (
    <div style={{ marginBottom: '32px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '16px', marginBottom: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: '22px', fontWeight: 600, margin: 0 }}>Round 1 keyword candidates</h2>
            {session.source_scope_tags && session.source_scope_tags.length > 0 && (
              <code style={{ fontSize: '11px', padding: '2px 8px', background: 'var(--color-bg-subtle)', borderRadius: '4px', fontFamily: 'var(--font-mono)', color: 'var(--color-text-secondary)' }}>
                #{session.source_scope_tags[0]}
              </code>
            )}
          </div>
          {session.display_name && (
            <div style={{ fontSize: '13px', color: 'var(--color-text-primary)', fontWeight: 500, marginBottom: '4px' }}>
              {session.display_name}
            </div>
          )}
          <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
            Extracted from {analysis.total_records?.toLocaleString() || '?'} records · ${(analysis.total_dollars || 0).toLocaleString()} total · {allPhrases.length} candidate phrases
            {session.market_analysis_at && ` · ${new Date(session.market_analysis_at).toLocaleString()}`}
          </div>
        </div>
        <Button variant="secondary" size="small" onClick={onRerun}>
          Re-analyze
        </Button>
      </div>

      {/* Controls */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          marginBottom: '12px',
          flexWrap: 'wrap',
          padding: '12px 16px',
          background: 'var(--color-bg-elevated)',
          borderRadius: 'var(--radius-card)',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '12px', color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Min relevance
          </span>
          <select
            value={minRelevance}
            onChange={(e) => setMinRelevance(parseInt(e.target.value, 10))}
            style={{
              fontSize: '13px',
              padding: '4px 8px',
              border: '1px solid var(--color-hairline)',
              borderRadius: 'var(--radius-input)',
              background: 'var(--color-bg-primary)',
              color: 'var(--color-text-primary)',
              fontFamily: 'inherit',
              cursor: 'pointer',
            }}
          >
            {[1, 3, 5, 7, 8, 9].map((n) => (
              <option key={n} value={n}>
                ≥ {n}
              </option>
            ))}
          </select>
        </div>

        <div style={{ flex: 1 }} />

        {selectedCount > 0 && (
          <span style={{ fontSize: '12px', color: 'var(--color-accent)', fontWeight: 500 }}>
            {selectedCount} selected
          </span>
        )}

        <Button variant="secondary" size="small" onClick={selectAllVisible} disabled={sorted.length === 0}>
          Select all visible
        </Button>
        <Button variant="secondary" size="small" onClick={clearSelection} disabled={selectedCount === 0}>
          Clear
        </Button>
        <Button size="small" onClick={handleSave} disabled={selectedCount === 0 || saving}>
          {saving ? 'Saving…' : `Add ${selectedCount || ''} to Round 1`.trim()}
        </Button>
      </div>

      {saveMessage && (
        <div
          style={{
            fontSize: '12px',
            color: 'var(--color-success)',
            padding: '8px 14px',
            marginBottom: '12px',
            background: 'rgba(52,199,89,0.08)',
            borderRadius: 'var(--radius-input)',
            border: '1px solid rgba(52,199,89,0.2)',
          }}
        >
          ✓ {saveMessage}
        </div>
      )}

      {/* Keyword table */}
      <Card padding="standard">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '32px 2.2fr 90px 110px 80px 90px',
            gap: '8px',
            padding: '10px 12px',
            fontSize: '11px',
            color: 'var(--color-text-tertiary)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            borderBottom: '1px solid var(--color-hairline)',
            alignItems: 'center',
          }}
        >
          <span></span>
          <SortHeader active={sortKey === 'phrase'} desc={sortDesc} onClick={() => toggleSort('phrase')}>
            Phrase
          </SortHeader>
          <SortHeader active={sortKey === 'relevance'} desc={sortDesc} onClick={() => toggleSort('relevance')} align="right">
            Relevance
          </SortHeader>
          <SortHeader active={sortKey === 'dollars'} desc={sortDesc} onClick={() => toggleSort('dollars')} align="right">
            $ volume
          </SortHeader>
          <SortHeader active={sortKey === 'count'} desc={sortDesc} onClick={() => toggleSort('count')} align="right">
            Count
          </SortHeader>
          <SortHeader active={sortKey === 'avg'} desc={sortDesc} onClick={() => toggleSort('avg')} align="right">
            Avg
          </SortHeader>
        </div>

        {sorted.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', fontSize: '13px', color: 'var(--color-text-tertiary)' }}>
            No phrases meet the current filter.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {sorted.map((p, i) => (
              <KeywordRow
                key={`${p.phrase}-${i}`}
                phrase={p}
                selected={selectedPhrases.has(p.phrase)}
                onToggle={() => togglePhrase(p.phrase)}
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

function SortHeader({
  active,
  desc,
  onClick,
  align = 'left',
  children,
}: {
  active: boolean
  desc: boolean
  onClick: () => void
  align?: 'left' | 'right'
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'transparent',
        border: 'none',
        padding: 0,
        fontSize: '11px',
        fontFamily: 'inherit',
        color: active ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        fontWeight: active ? 600 : 400,
        textAlign: align,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '3px',
        justifyContent: align === 'right' ? 'flex-end' : 'flex-start',
      }}
    >
      {children}
      {active && <span style={{ fontSize: '9px' }}>{desc ? '▼' : '▲'}</span>}
    </button>
  )
}

function KeywordRow({
  phrase,
  selected,
  onToggle,
}: {
  phrase: KeywordPhrase
  selected: boolean
  onToggle: () => void
}) {
  const [expanded, setExpanded] = useState(false)

  const rs = phrase.relevance_score
  const relevanceColor = rs === null ? '#86868B' : rs >= 8 ? '#34C759' : rs >= 6 ? '#007AFF' : rs >= 4 ? '#D4920A' : '#FF3B30'
  const relevanceBg = rs === null ? 'rgba(134,134,139,0.12)' : rs >= 8 ? 'rgba(52,199,89,0.12)' : rs >= 6 ? 'rgba(0,122,255,0.12)' : rs >= 4 ? 'rgba(212,146,10,0.12)' : 'rgba(255,59,48,0.12)'

  return (
    <div
      style={{
        borderBottom: '0.5px solid var(--color-hairline)',
        background: selected ? 'rgba(var(--color-accent-rgb, 212, 146, 10), 0.04)' : 'transparent',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '32px 2.2fr 90px 110px 80px 90px',
          gap: '8px',
          padding: '10px 12px',
          alignItems: 'center',
          cursor: 'pointer',
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => {
            e.stopPropagation()
            onToggle()
          }}
          onClick={(e) => e.stopPropagation()}
          style={{ cursor: 'pointer', width: '16px', height: '16px' }}
        />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'var(--color-text-primary)', fontWeight: 500 }}>
          {phrase.phrase}
        </span>
        <div style={{ textAlign: 'right' }}>
          <span
            style={{
              display: 'inline-block',
              padding: '2px 8px',
              fontSize: '12px',
              fontFamily: 'var(--font-mono)',
              fontWeight: 600,
              color: relevanceColor,
              background: relevanceBg,
              borderRadius: '4px',
              minWidth: '36px',
              textAlign: 'center',
            }}
          >
            {rs !== null ? `${rs}/10` : '—'}
          </span>
        </div>
        <span style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
          {formatDollarsBrief(phrase.dollar_volume)}
        </span>
        <span style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
          {phrase.count?.toLocaleString() || '—'}
        </span>
        <span style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
          {formatDollarsBrief(phrase.avg_contract)}
        </span>
      </div>
      {expanded && (phrase.context || phrase.relevance_rationale) && (
        <div style={{ padding: '0 12px 12px 60px', fontSize: '12px', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
          {phrase.context && (
            <div style={{ marginBottom: phrase.relevance_rationale ? '6px' : 0 }}>
              <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 500 }}>Context:</span> {phrase.context}
            </div>
          )}
          {phrase.relevance_rationale && (
            <div>
              <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 500 }}>Why {phrase.relevance_score}/10:</span> {phrase.relevance_rationale}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function formatDollarsBrief(n: number | null | undefined): string {
  if (n === null || n === undefined || n === 0) return '—'
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n}`
}
