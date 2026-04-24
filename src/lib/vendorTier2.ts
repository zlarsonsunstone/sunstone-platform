import { supabase } from '@/lib/supabase'
import { callClaudeBrowser, extractJsonBlock } from '@/lib/claude'
import { logMethodology } from '@/lib/methodologyLog'

/**
 * Tier 2 Vendor Analysis Pipeline
 *
 * For each vendor in the target set, fetches their website, sends it to Haiku
 * with the tenant's commercial profile, and produces a dual-axis analysis:
 *
 *   Axis 1: capability_score 0-10 — how similar are stated capabilities to tenant's
 *   Axis 2: evidence_score 0-10 — how well-proven are the claims (case studies,
 *           federal past performance, testimonials, certifications, team credentials)
 *
 * Results stored in v2.vendor_capability_analysis with tier=2.
 *
 * Scope: this tier is the quick-scan. Later Tier 3 does deeper analysis on the
 * capability ≥ 5 survivors.
 */

export interface Tier2RunOptions {
  tenantId: string
  tenantName: string
  tenantProfileText: string
  /** Override the target vendor set. If not provided, uses all vendors with
   * has_capability_signal=true and no existing tier-2 row for this tenant. */
  targetUeis?: string[]
  /** Max concurrent fetch+analyze pairs. Default 10. */
  concurrency?: number
  /** Re-analyze vendors that already have a tier-2 row (default false). */
  reanalyze?: boolean
  /** Progress callback. */
  onProgress?: (done: number, total: number, label?: string) => void
}

export interface Tier2RunResult {
  attempted: number
  succeeded: number
  failed: number
  errors: { uei: string; error: string }[]
  elapsedMs: number
}

export async function runTier2Analysis(opts: Tier2RunOptions): Promise<Tier2RunResult> {
  const { tenantId, tenantName, tenantProfileText, onProgress } = opts
  const concurrency = opts.concurrency ?? 10
  const started = Date.now()

  // 1. Build the vendor target set
  const targetVendors = await resolveTargetVendors({
    tenantId,
    targetUeis: opts.targetUeis,
    reanalyze: opts.reanalyze ?? false,
  })

  if (targetVendors.length === 0) {
    return {
      attempted: 0,
      succeeded: 0,
      failed: 0,
      errors: [],
      elapsedMs: Date.now() - started,
    }
  }

  logMethodology({
    tenantId: tenantId,
    eventType: 'tier2_scan_start',
    summary: `Starting Tier 2 vendor analysis: ${targetVendors.length} vendors`,
    details: {
      target_count: targetVendors.length,
      concurrency,
      reanalyze: opts.reanalyze ?? false,
    },
  })

  // 2. Process in waves
  const errors: { uei: string; error: string }[] = []
  let succeeded = 0
  let failed = 0
  let done = 0

  onProgress?.(0, targetVendors.length, 'Starting Tier 2 analysis…')

  for (let waveStart = 0; waveStart < targetVendors.length; waveStart += concurrency) {
    const wave = targetVendors.slice(waveStart, waveStart + concurrency)
    await Promise.all(
      wave.map(async (vendor) => {
        try {
          await analyzeSingleVendor({
            tenantId,
            tenantName,
            tenantProfileText,
            vendor,
          })
          succeeded++
        } catch (err: any) {
          failed++
          const msg = err?.message || String(err)
          errors.push({ uei: vendor.uei, error: msg })
          console.warn(`[tier2] ${vendor.uei} (${vendor.legal_business_name}):`, msg)
        } finally {
          done++
          onProgress?.(done, targetVendors.length, `Analyzed ${done}/${targetVendors.length}`)
        }
      })
    )
  }

  const elapsedMs = Date.now() - started

  logMethodology({
    tenantId: tenantId,
    eventType: 'tier2_scan_complete',
    summary: `Completed Tier 2 scan: ${succeeded} succeeded, ${failed} failed (${((succeeded / targetVendors.length) * 100).toFixed(1)}% success)`,
    details: {
      attempted: targetVendors.length,
      succeeded,
      failed,
      elapsed_ms: elapsedMs,
      elapsed_minutes: +(elapsedMs / 60000).toFixed(1),
    },
  })

  return {
    attempted: targetVendors.length,
    succeeded,
    failed,
    errors,
    elapsedMs,
  }
}

// ============================================================================
// Target vendor resolution
// ============================================================================

interface TargetVendor {
  uei: string
  legal_business_name: string
  website: string | null
  primary_naics: string | null
  primary_naics_sector: string | null
}

async function resolveTargetVendors(args: {
  tenantId: string
  targetUeis?: string[]
  reanalyze: boolean
}): Promise<TargetVendor[]> {
  const { tenantId, targetUeis, reanalyze } = args

  // Fetch target universe
  const universe: TargetVendor[] = []
  const PAGE = 1000

  if (targetUeis && targetUeis.length > 0) {
    // Explicit UEI list — fetch in chunks
    for (let i = 0; i < targetUeis.length; i += 100) {
      const chunk = targetUeis.slice(i, i + 100)
      const { data, error } = await supabase
        .from('vendor_universe')
        .select('uei, legal_business_name, website, primary_naics, primary_naics_sector')
        .in('uei', chunk)
      if (error) throw new Error(`Fetch target vendors failed: ${error.message}`)
      if (data) universe.push(...(data as TargetVendor[]))
    }
  } else {
    // Default: all vendors with capability signal, with websites
    let offset = 0
    for (;;) {
      const { data, error } = await supabase
        .from('vendor_universe')
        .select('uei, legal_business_name, website, primary_naics, primary_naics_sector')
        .eq('has_capability_signal', true)
        .not('website', 'is', null)
        .range(offset, offset + PAGE - 1)
      if (error) throw new Error(`Fetch vendor universe failed: ${error.message}`)
      if (!data || data.length === 0) break
      universe.push(...(data as TargetVendor[]))
      if (data.length < PAGE) break
      offset += PAGE
    }
  }

  if (reanalyze) {
    return universe
  }

  // Filter out vendors that already have a tier-2 row for this tenant
  const existingUeis = new Set<string>()
  let offset = 0
  for (;;) {
    const { data, error } = await supabase
      .from('vendor_capability_analysis')
      .select('vendor_uei')
      .eq('tenant_id', tenantId)
      .eq('tier', 2)
      .range(offset, offset + PAGE - 1)
    if (error) break
    if (!data || data.length === 0) break
    for (const r of data) existingUeis.add((r as any).vendor_uei)
    if (data.length < PAGE) break
    offset += PAGE
  }

  return universe.filter((v) => !existingUeis.has(v.uei))
}

// ============================================================================
// Single vendor analysis
// ============================================================================

async function analyzeSingleVendor(args: {
  tenantId: string
  tenantName: string
  tenantProfileText: string
  vendor: TargetVendor
}): Promise<void> {
  const { tenantId, tenantName, tenantProfileText, vendor } = args

  if (!vendor.website) {
    // Record the fetch error so we don't keep retrying
    await supabase
      .from('vendor_capability_analysis')
      .upsert(
        {
          tenant_id: tenantId,
          vendor_uei: vendor.uei,
          tier: 2,
          capability_score: null,
          evidence_score: null,
          doppelganger_tier: 'inconclusive',
          fetch_error: 'No website on file',
          analyzed_by_model: 'claude-haiku-4-5-20251001',
          analyzed_at: new Date().toISOString(),
        },
        { onConflict: 'tenant_id,vendor_uei,tier', ignoreDuplicates: false }
      )
    return
  }

  // 1. Fetch website via our edge function
  let pageContent = ''
  let pagesFetched: string[] = []
  let fetchError: string | null = null

  try {
    const fetchResp = await fetch('/.netlify/functions/fetch-website', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: vendor.website }),
    })
    if (!fetchResp.ok) {
      const errBody = await fetchResp.text().catch(() => '')
      fetchError = `HTTP ${fetchResp.status}${errBody ? `: ${errBody.slice(0, 200)}` : ''}`
    } else {
      const data = await fetchResp.json()
      pageContent = data.text || ''
      pagesFetched = [data.url || vendor.website]
      if (pageContent.length < 200) {
        fetchError = `Content too short (${pageContent.length} chars) — likely a redirect page or empty homepage`
      }
    }
  } catch (err: any) {
    fetchError = err?.message || 'Unknown fetch error'
  }

  if (fetchError) {
    await supabase
      .from('vendor_capability_analysis')
      .upsert(
        {
          tenant_id: tenantId,
          vendor_uei: vendor.uei,
          tier: 2,
          website_url: vendor.website,
          capability_score: null,
          evidence_score: null,
          doppelganger_tier: 'inconclusive',
          fetch_error: fetchError,
          analyzed_by_model: 'claude-haiku-4-5-20251001',
          analyzed_at: new Date().toISOString(),
        },
        { onConflict: 'tenant_id,vendor_uei,tier', ignoreDuplicates: false }
      )
    return
  }

  // Truncate content — Haiku 4.5 has plenty of context but keeping scan cheap
  const contentForAnalysis = pageContent.slice(0, 12000)
  const contentChars = contentForAnalysis.length

  // 2. Run dual-axis Haiku analysis
  const prompt = buildTier2Prompt({
    tenantName,
    tenantProfileText,
    vendor,
    websiteContent: contentForAnalysis,
  })

  const { text } = await callClaudeBrowser(prompt, {
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 1500,
  })

  const parsed = extractJsonBlock(text) || {}

  const capabilityScore = clampScore(parsed.capability_score)
  const evidenceScore = clampScore(parsed.evidence_score)

  // 3. Derive doppelganger_tier from the matrix
  const doppelganger_tier = deriveDoppelgangerTier(capabilityScore, evidenceScore)

  // 4. Persist
  const { error } = await supabase
    .from('vendor_capability_analysis')
    .upsert(
      {
        tenant_id: tenantId,
        vendor_uei: vendor.uei,
        tier: 2,
        website_url: vendor.website,
        pages_fetched: pagesFetched,
        content_chars: contentChars,
        capability_score: capabilityScore,
        capability_rationale: parsed.capability_rationale || null,
        capability_keywords: Array.isArray(parsed.capability_keywords)
          ? parsed.capability_keywords.slice(0, 10)
          : null,
        evidence_score: evidenceScore,
        evidence_rationale: parsed.evidence_rationale || null,
        evidence_citations: Array.isArray(parsed.evidence_citations)
          ? parsed.evidence_citations.slice(0, 10)
          : null,
        evidence_markers: parsed.evidence_markers || null,
        doppelganger_tier,
        analyzed_by_model: 'claude-haiku-4-5-20251001',
        analyzed_at: new Date().toISOString(),
        analysis_cost_estimate: 0.002, // approx Haiku cost per call
      },
      { onConflict: 'tenant_id,vendor_uei,tier', ignoreDuplicates: false }
    )

  if (error) {
    throw new Error(`Persist failed: ${error.message}`)
  }
}

function clampScore(v: any): number | null {
  if (typeof v !== 'number') return null
  return Math.max(0, Math.min(10, Math.round(v)))
}

/**
 * Maps the (capability, evidence) pair to one of 7 doppelganger tiers.
 * See PLAYBOOK §3.I for the full matrix rationale.
 */
function deriveDoppelgangerTier(cap: number | null, ev: number | null): string {
  if (cap === null || ev === null) return 'inconclusive'
  if (cap < 5) return 'false_positive'
  if (cap >= 8 && ev >= 7) return 'true_doppelganger'
  if (cap >= 8 && ev >= 4) return 'unproven_doppelganger'
  if (cap >= 8 && ev < 4) return 'loud_claimant'
  if (cap >= 5 && cap < 8 && ev >= 7) return 'proven_adjacent'
  if (cap >= 5 && cap < 8) return 'adjacent_capability'
  return 'inconclusive'
}

// ============================================================================
// Prompt
// ============================================================================

function buildTier2Prompt(args: {
  tenantName: string
  tenantProfileText: string
  vendor: TargetVendor
  websiteContent: string
}): string {
  const { tenantName, tenantProfileText, vendor, websiteContent } = args

  return `You are analyzing a federal contractor's website to determine if they are a capability doppelganger of ${tenantName}.

## ABOUT ${tenantName.toUpperCase()}

${tenantProfileText.slice(0, 3500)}

## THE VENDOR BEING ANALYZED

- Legal name: ${vendor.legal_business_name}
- Website URL: ${vendor.website}
- Primary NAICS: ${vendor.primary_naics || '(unknown)'}

## WEBSITE CONTENT

${websiteContent}

## YOUR TASK

Produce a DUAL-AXIS analysis. The two axes are independent — a vendor can be perfectly capability-similar but unproven, or they can be well-proven but irrelevant. Score each separately.

### AXIS 1: Capability Match (0-10)

How similar are this vendor's stated capabilities to ${tenantName}?
- 10 = Same core product or capability, same approach, same target market
- 7-9 = Strong overlap in core capability
- 4-6 = Adjacent capability, serves related but different market
- 1-3 = Weak overlap, incidental similarity
- 0 = No meaningful similarity

### AXIS 2: Evidence Confidence (0-10)

How strongly does the page content PROVE their capabilities are real (not just marketing claims)?

Evidence markers to look for:
- Named case studies with specific outcomes, metrics, or customer names (+3 points available)
- Federal past performance explicitly named (specific agencies, contracts, programs) (+2)
- Third-party attestations: testimonials with real names/companies, industry certifications, analyst reports (+2)
- Team bios showing domain credentials (former agency SES, PhDs, named experts) (+1)
- Media coverage or industry recognition (awards, press, conference talks) (+1)
- Partnership disclosures (named primes, named technology partners, certifications like AWS Advanced Tier) (+1)

Scoring:
- 10 = Multiple strong evidence markers across several categories
- 7-9 = Clear proof markers, some specifics
- 4-6 = Some evidence, mostly general claims
- 1-3 = Marketing-only, no proof
- 0 = Empty page, placeholder site, or pure branding

### EVIDENCE CITATIONS

You MUST provide 2-5 direct quotes from the website content that support your evidence_score. These are the text snippets (verbatim, quoted) that justify the score. If you assign high evidence but can't cite direct quotes, lower the score — you're hallucinating.

## OUTPUT

Return ONLY JSON, wrapped in a \`\`\`json code block. Schema:

\`\`\`json
{
  "capability_score": 8,
  "capability_rationale": "1-2 sentences on why this capability score. Be specific about WHAT overlaps.",
  "capability_keywords": ["up to 5 short capability phrases this vendor claims"],
  "evidence_score": 6,
  "evidence_rationale": "1-2 sentences on evidence quality.",
  "evidence_citations": [
    "Direct quote #1 from the website content",
    "Direct quote #2 from the website content",
    "Direct quote #3 from the website content"
  ],
  "evidence_markers": {
    "case_studies": false,
    "federal_past_performance": true,
    "testimonials": false,
    "certifications": true,
    "team_credentials": true,
    "media_coverage": false,
    "partnerships": true
  }
}
\`\`\`

Be rigorous. Be honest. If capability is low, say so — this is forensic analysis, not marketing support.`
}
