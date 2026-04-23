import { supabase } from '@/lib/supabase'
import { callClaudeBrowser, extractJsonBlock } from '@/lib/claude'
import { getOrCreateVendorIntel } from '@/lib/vendorIntel'

/**
 * PIID Analysis Service (Lazy mode)
 *
 * Runs a forensic analysis of every contract (PIID) that matched a keyword phrase.
 * Each PIID analysis is a single Haiku call producing:
 *   - System interpretation of the contract description
 *   - NAICS alignment score 0-10 + rationale
 *   - PSC alignment score 0-10 + rationale
 *   - Per-PIID relevance to the tenant 0-10 + rationale
 *
 * Results cached in piid_analysis, keyed by (session_id, piid, matched_phrase).
 * Vendor intel fetched via getOrCreateVendorIntel — cached per vendor and
 * shared across all PIIDs for the same vendor.
 */

export interface AnalyzePhraseArgs {
  tenantId: string
  tenantName: string
  tenantProfileText: string
  sessionId: string
  roundNumber: number
  turnNumber: number
  phrase: string
  onProgress?: (done: number, total: number, label?: string) => void
}

export interface AnalyzedPiid {
  id: string
  piid: string
  contract_description: string | null
  obligated: number | null
  awardee: string | null
  agency: string | null
  naics_code: string | null
  psc_code: string | null
  system_interpretation: string | null
  naics_alignment_score: number | null
  naics_alignment_rationale: string | null
  psc_alignment_score: number | null
  psc_alignment_rationale: string | null
  per_piid_relevance_score: number | null
  per_piid_relevance_rationale: string | null
  vendor_intel_id: string | null
  vendor_name: string | null
  vendor_similarity_score: number | null
  vendor_description: string | null
  analyzed_at: string
}

/**
 * Get analyzed PIIDs for a phrase. If none cached, run the analysis pipeline.
 */
export async function analyzePhrasePiids(
  args: AnalyzePhraseArgs
): Promise<AnalyzedPiid[]> {
  const { tenantId, tenantName, tenantProfileText, sessionId, phrase, onProgress } = args

  // 1. Return cache if present
  const cached = await loadCachedAnalyses(sessionId, phrase)
  if (cached.length > 0) {
    onProgress?.(cached.length, cached.length, 'Loaded from cache')
    return cached
  }

  // 2. Fetch all records in session whose description contains the phrase
  //    (case-insensitive partial match)
  const matchingRecords = await fetchMatchingRecords(sessionId, phrase)
  if (matchingRecords.length === 0) {
    return []
  }

  onProgress?.(0, matchingRecords.length, `Analyzing ${matchingRecords.length} PIIDs for "${phrase}"…`)

  // 3. Dedupe by PIID — one record per contract, highest-dollar wins
  const byPiid = new Map<string, any>()
  for (const r of matchingRecords) {
    const key = r.contract_number || r.contract_award_unique_key
    if (!key) continue
    const existing = byPiid.get(key)
    if (!existing || (r.obligated || 0) > (existing.obligated || 0)) {
      byPiid.set(key, r)
    }
  }
  const uniqueRecords = Array.from(byPiid.values())

  // 4. Run PIID analyses in batches of 8 concurrent
  const CONCURRENCY = 8
  let completed = 0
  const results: AnalyzedPiid[] = []

  for (let waveStart = 0; waveStart < uniqueRecords.length; waveStart += CONCURRENCY) {
    const waveEnd = Math.min(waveStart + CONCURRENCY, uniqueRecords.length)
    const wavePromises: Promise<AnalyzedPiid | null>[] = []

    for (let idx = waveStart; idx < waveEnd; idx++) {
      wavePromises.push(
        analyzeSinglePiid({
          tenantId,
          tenantName,
          tenantProfileText,
          sessionId,
          roundNumber: args.roundNumber,
          turnNumber: args.turnNumber,
          phrase,
          record: uniqueRecords[idx],
        })
          .then((r) => {
            completed++
            onProgress?.(completed, uniqueRecords.length, `Analyzed ${completed}/${uniqueRecords.length} PIIDs`)
            return r
          })
          .catch((err) => {
            completed++
            console.warn(`[piid_analysis] failed for phrase "${phrase}" PIID ${uniqueRecords[idx].contract_number}:`, err?.message)
            return null
          })
      )
    }

    const waveResults = await Promise.all(wavePromises)
    for (const r of waveResults) {
      if (r) results.push(r)
    }
  }

  // 5. Sort by per_piid_relevance_score desc, then obligated desc
  results.sort((a, b) => {
    const scoreCmp = (b.per_piid_relevance_score || 0) - (a.per_piid_relevance_score || 0)
    if (scoreCmp !== 0) return scoreCmp
    return (b.obligated || 0) - (a.obligated || 0)
  })

  return results
}

async function loadCachedAnalyses(sessionId: string, phrase: string): Promise<AnalyzedPiid[]> {
  const all: any[] = []
  const PAGE = 1000
  let offset = 0
  while (true) {
    const { data, error } = await supabase
      .from('piid_analysis')
      .select(`
        id, piid, contract_description, obligated, awardee, agency, naics_code, psc_code,
        system_interpretation, naics_alignment_score, naics_alignment_rationale,
        psc_alignment_score, psc_alignment_rationale,
        per_piid_relevance_score, per_piid_relevance_rationale,
        vendor_intel_id, analyzed_at,
        vendor_intel:vendor_intel_id ( legal_business_name, similarity_score, description )
      `)
      .eq('session_id', sessionId)
      .eq('matched_phrase', phrase)
      .order('per_piid_relevance_score', { ascending: false, nullsFirst: false })
      .order('obligated', { ascending: false, nullsFirst: false })
      .range(offset, offset + PAGE - 1)
    if (error) break
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE) break
    offset += PAGE
  }

  return all.map((r) => ({
    id: r.id,
    piid: r.piid,
    contract_description: r.contract_description,
    obligated: r.obligated,
    awardee: r.awardee,
    agency: r.agency,
    naics_code: r.naics_code,
    psc_code: r.psc_code,
    system_interpretation: r.system_interpretation,
    naics_alignment_score: r.naics_alignment_score,
    naics_alignment_rationale: r.naics_alignment_rationale,
    psc_alignment_score: r.psc_alignment_score,
    psc_alignment_rationale: r.psc_alignment_rationale,
    per_piid_relevance_score: r.per_piid_relevance_score,
    per_piid_relevance_rationale: r.per_piid_relevance_rationale,
    vendor_intel_id: r.vendor_intel_id,
    vendor_name: r.vendor_intel?.legal_business_name || null,
    vendor_similarity_score: r.vendor_intel?.similarity_score ?? null,
    vendor_description: r.vendor_intel?.description || null,
    analyzed_at: r.analyzed_at,
  }))
}

async function fetchMatchingRecords(sessionId: string, phrase: string): Promise<any[]> {
  const all: any[] = []
  const PAGE = 1000
  let offset = 0
  // ilike for case-insensitive partial match. Claude extracted phrases are
  // 1-3 words so this will match most instances in contract descriptions.
  const pattern = `%${phrase.toLowerCase()}%`
  while (true) {
    const { data, error } = await supabase
      .from('enrichment_records')
      .select('id, contract_number, contract_award_unique_key, description, obligated, awardee, agency, naics_code, psc_code, uei')
      .eq('session_id', sessionId)
      .is('deleted_at', null)
      .ilike('description', pattern)
      .range(offset, offset + PAGE - 1)
    if (error) throw new Error(`Record fetch failed: ${error.message}`)
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE) break
    offset += PAGE
  }
  return all
}

async function analyzeSinglePiid(args: {
  tenantId: string
  tenantName: string
  tenantProfileText: string
  sessionId: string
  roundNumber: number
  turnNumber: number
  phrase: string
  record: any
}): Promise<AnalyzedPiid> {
  const { tenantId, tenantName, tenantProfileText, sessionId, phrase, record } = args

  // 1. Get/build vendor intel first — shared across all PIIDs for this vendor
  let vendorIntelId: string | null = null
  let vendorName: string | null = null
  let vendorSimilarity: number | null = null
  let vendorDescription: string | null = null

  if (record.awardee) {
    try {
      const vendor = await getOrCreateVendorIntel({
        tenantId,
        tenantName,
        tenantProfileText,
        vendor: {
          uei: record.uei || null,
          legal_name: record.awardee,
        },
      })
      vendorIntelId = vendor.id
      vendorName = vendor.legal_business_name
      vendorSimilarity = vendor.similarity_score
      vendorDescription = vendor.description
    } catch (err: any) {
      console.warn(`[piid_analysis] vendor intel failed for ${record.awardee}:`, err?.message)
    }
  }

  // 2. Run PIID analysis prompt
  const prompt = buildPiidPrompt({
    tenantName,
    tenantProfileText,
    phrase,
    record,
    vendorDescription,
  })

  const { text } = await callClaudeBrowser(prompt, {
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 1500,
  })

  const parsed = extractJsonBlock(text) || {}

  // 3. Insert into piid_analysis (race-safe via UNIQUE constraint)
  const insertRow = {
    tenant_id: tenantId,
    session_id: sessionId,
    round_number: args.roundNumber,
    turn_number: args.turnNumber,
    record_id: record.id,
    piid: record.contract_number,
    contract_award_unique_key: record.contract_award_unique_key,
    matched_phrase: phrase,
    contract_description: record.description,
    obligated: record.obligated,
    awardee: record.awardee,
    agency: record.agency,
    naics_code: record.naics_code,
    psc_code: record.psc_code,
    system_interpretation: parsed.system_interpretation || null,
    naics_alignment_score: clampScore(parsed.naics_alignment_score),
    naics_alignment_rationale: parsed.naics_alignment_rationale || null,
    psc_alignment_score: clampScore(parsed.psc_alignment_score),
    psc_alignment_rationale: parsed.psc_alignment_rationale || null,
    per_piid_relevance_score: clampScore(parsed.per_piid_relevance_score),
    per_piid_relevance_rationale: parsed.per_piid_relevance_rationale || null,
    vendor_intel_id: vendorIntelId,
    analyzed_by_model: 'claude-haiku-4-5-20251001',
    prompt_chars: prompt.length,
  }

  const { data: inserted, error } = await supabase
    .from('piid_analysis')
    .upsert(insertRow, { onConflict: 'session_id,piid,matched_phrase', ignoreDuplicates: false })
    .select()
    .single()

  if (error || !inserted) {
    throw new Error(`piid_analysis insert failed: ${error?.message || 'unknown'}`)
  }

  return {
    id: inserted.id,
    piid: inserted.piid,
    contract_description: inserted.contract_description,
    obligated: inserted.obligated,
    awardee: inserted.awardee,
    agency: inserted.agency,
    naics_code: inserted.naics_code,
    psc_code: inserted.psc_code,
    system_interpretation: inserted.system_interpretation,
    naics_alignment_score: inserted.naics_alignment_score,
    naics_alignment_rationale: inserted.naics_alignment_rationale,
    psc_alignment_score: inserted.psc_alignment_score,
    psc_alignment_rationale: inserted.psc_alignment_rationale,
    per_piid_relevance_score: inserted.per_piid_relevance_score,
    per_piid_relevance_rationale: inserted.per_piid_relevance_rationale,
    vendor_intel_id: inserted.vendor_intel_id,
    vendor_name: vendorName,
    vendor_similarity_score: vendorSimilarity,
    vendor_description: vendorDescription,
    analyzed_at: inserted.analyzed_at,
  }
}

function clampScore(v: any): number | null {
  if (typeof v !== 'number') return null
  return Math.max(0, Math.min(10, Math.round(v)))
}

function buildPiidPrompt(args: {
  tenantName: string
  tenantProfileText: string
  phrase: string
  record: any
  vendorDescription: string | null
}): string {
  const { tenantName, tenantProfileText, phrase, record, vendorDescription } = args
  return `You are performing forensic analysis of a single federal contract to determine its true relevance to ${tenantName}.

## ABOUT ${tenantName.toUpperCase()}
${tenantProfileText.slice(0, 2000)}

## THE MATCHED KEYWORD
The phrase "${phrase}" appeared in the contract description. We're asking: does this contract actually represent work ${tenantName} could do, or is the phrase just a surface-level match?

## THE CONTRACT
- PIID: ${record.contract_number || '(unknown)'}
- Dollar obligated: $${(record.obligated || 0).toLocaleString()}
- Awarded to: ${record.awardee || '(unknown)'}
- Agency: ${record.agency || '(unknown)'}
- NAICS: ${record.naics_code || '(unknown)'}
- PSC: ${record.psc_code || '(unknown)'}
- Description: ${record.description || '(no description)'}
${vendorDescription ? `\n## VENDOR CONTEXT\n${vendorDescription}` : ''}

## TASK

1. **System interpretation** — In 1-2 sentences, what is this contract ACTUALLY for (beyond the dollar volume and buzzwords)? What is the awardee delivering?

2. **NAICS alignment (0-10)** — Is the NAICS code \`${record.naics_code || '(missing)'}\` appropriate for the described work? 10 = perfect match. 5 = technically valid but loose. 0 = mismatch (tribal language case — the work is really something else).

3. **PSC alignment (0-10)** — Is the PSC code \`${record.psc_code || '(missing)'}\` appropriate for the described work? Same 0-10 scale.

4. **Per-PIID relevance to ${tenantName} (0-10)** — Given the contract description (NOT the keyword match), how genuinely relevant is this work to ${tenantName}'s actual capability? 10 = core capability bullseye. 5 = adjacent, needs positioning. 0 = keyword matched but work is unrelated.

Return ONLY JSON:

\`\`\`json
{
  "system_interpretation": "1-2 sentences on what this contract is actually for",
  "naics_alignment_score": 8,
  "naics_alignment_rationale": "...",
  "psc_alignment_score": 7,
  "psc_alignment_rationale": "...",
  "per_piid_relevance_score": 9,
  "per_piid_relevance_rationale": "1-2 sentences on why this score"
}
\`\`\``
}
