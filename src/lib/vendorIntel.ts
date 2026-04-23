import { supabase } from '@/lib/supabase'
import { callClaudeBrowser, extractJsonBlock } from '@/lib/claude'

/**
 * Vendor Intel service
 *
 * Strategy per vendor (keyed by UEI when available, else legal_name):
 *   1. Check vendor_intel table — if cached, return it.
 *   2. Check sam_registry for UEI — if found, seed basic fields and synthesize
 *      a short Claude analysis without web search (cheaper).
 *   3. Else web_search via Claude to pull vendor details using name+city+state,
 *      then synthesize.
 *
 * Results cached in vendor_intel keyed by (tenant_id, uei or name).
 * Shared across all PIIDs for the same vendor.
 */

export interface VendorContext {
  uei?: string | null
  cage?: string | null
  legal_name: string
  city?: string | null
  state?: string | null
}

export interface VendorIntelRow {
  id: string
  tenant_id: string
  uei: string | null
  legal_business_name: string
  cage: string | null
  website: string | null
  city: string | null
  state: string | null
  source: 'sam_registry' | 'web_search' | 'manual' | 'usaspending' | null
  source_notes: string | null
  description: string | null
  business_model: string | null
  federal_posture: string | null
  similarity_score: number | null
  similarity_rationale: string | null
  key_capabilities: string[] | null
  analyzed_by_model: string | null
  analyzed_at: string | null
  web_search_cost_estimate: number | null
}

/**
 * Get or create the vendor_intel record for this vendor.
 * Returns existing cached row if available, otherwise runs analysis.
 */
export async function getOrCreateVendorIntel(args: {
  tenantId: string
  tenantName: string
  tenantProfileText: string
  vendor: VendorContext
}): Promise<VendorIntelRow> {
  const { tenantId, tenantName, tenantProfileText, vendor } = args

  // 1. Check cache by UEI
  if (vendor.uei) {
    const { data: existing } = await supabase
      .from('vendor_intel')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('uei', vendor.uei)
      .maybeSingle()
    if (existing) return existing as VendorIntelRow
  }

  // 2. SAM registry lookup if we have a UEI
  let samRow: any = null
  if (vendor.uei) {
    const { data } = await supabase
      .from('sam_registry')
      .select('*')
      .eq('uei', vendor.uei)
      .maybeSingle()
    samRow = data
  }

  // 3. Build the vendor analysis prompt
  let prompt: string
  let enableWebSearch: boolean
  let source: 'sam_registry' | 'web_search'

  if (samRow) {
    source = 'sam_registry'
    enableWebSearch = false
    prompt = buildVendorPromptFromSam({
      tenantName,
      tenantProfileText,
      sam: samRow,
      vendor,
    })
  } else {
    source = 'web_search'
    enableWebSearch = true
    prompt = buildVendorPromptWebSearch({
      tenantName,
      tenantProfileText,
      vendor,
    })
  }

  // 4. Call Claude
  const started = Date.now()
  const { text, webSearchesUsed } = await callClaudeBrowser(prompt, {
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 2000,
    enableWebSearch,
    maxWebSearches: 2,
  })

  const parsed = extractJsonBlock(text) || {}
  const elapsedMs = Date.now() - started

  // Cost estimate: web search is roughly $0.01 per search on server side
  const webSearchCost = (webSearchesUsed || 0) * 0.01

  const insertRow = {
    tenant_id: tenantId,
    uei: vendor.uei || null,
    legal_business_name: samRow?.legal_business_name || vendor.legal_name,
    cage: samRow?.cage || vendor.cage || null,
    website: samRow?.website || parsed.website || null,
    city: vendor.city || null,
    state: vendor.state || null,
    source,
    source_notes: webSearchesUsed
      ? `Web search used ${webSearchesUsed} time(s), ${elapsedMs}ms`
      : samRow
      ? 'SAM registry hit'
      : null,
    description: parsed.description || null,
    business_model: parsed.business_model || null,
    federal_posture: parsed.federal_posture || null,
    similarity_score:
      typeof parsed.similarity_score === 'number'
        ? Math.max(0, Math.min(10, Math.round(parsed.similarity_score)))
        : null,
    similarity_rationale: parsed.similarity_rationale || null,
    key_capabilities: Array.isArray(parsed.key_capabilities)
      ? parsed.key_capabilities.slice(0, 10)
      : null,
    analyzed_by_model: 'claude-haiku-4-5-20251001',
    analyzed_at: new Date().toISOString(),
    web_search_cost_estimate: webSearchCost || null,
  }

  // 5. Upsert — race-condition safe (another parallel PIID analysis may have
  // just created the same vendor row)
  const { data: upserted, error } = await supabase
    .from('vendor_intel')
    .upsert(insertRow, { onConflict: 'tenant_id,uei', ignoreDuplicates: false })
    .select()
    .single()

  if (error || !upserted) {
    // Fallback: try fetching in case of conflict-race
    if (vendor.uei) {
      const { data } = await supabase
        .from('vendor_intel')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('uei', vendor.uei)
        .maybeSingle()
      if (data) return data as VendorIntelRow
    }
    throw new Error(`vendor_intel insert failed: ${error?.message || 'unknown'}`)
  }

  return upserted as VendorIntelRow
}

function buildVendorPromptFromSam(args: {
  tenantName: string
  tenantProfileText: string
  sam: any
  vendor: VendorContext
}): string {
  const { tenantName, tenantProfileText, sam, vendor } = args
  return `You are researching a federal contractor to understand their business so we can compare them to ${tenantName}.

KNOWN INFORMATION (from SAM.gov public registry):
- Legal name: ${sam.legal_business_name}
- UEI: ${sam.uei}
- CAGE: ${sam.cage || '(none)'}
- DBA: ${sam.dba_name || '(none)'}
- Website: ${sam.website || '(none)'}
- Observed location: ${vendor.city || '?'}, ${vendor.state || '?'}

COMPANY WE'RE COMPARING THEM TO (${tenantName}):
${tenantProfileText.slice(0, 2000)}

Based on the known information only (no web search), answer:

1. Based on the legal name and website URL, what is your best inference about what this company does?
2. Business model: prime | subcontractor | federal-native | commercial-native | unknown
3. Federal posture: has_federal | no_federal | unknown | heavy_federal
4. Similarity to ${tenantName} (0-10): how similar are their core capabilities?
5. Key capabilities inferred (3-5 short phrases)

Return ONLY JSON:
\`\`\`json
{
  "description": "1-2 sentences on what this company does based on available information",
  "business_model": "...",
  "federal_posture": "...",
  "similarity_score": 5,
  "similarity_rationale": "1 sentence explaining the score",
  "key_capabilities": ["..."],
  "website": "${sam.website || ''}"
}
\`\`\``
}

function buildVendorPromptWebSearch(args: {
  tenantName: string
  tenantProfileText: string
  vendor: VendorContext
}): string {
  const { tenantName, tenantProfileText, vendor } = args
  const searchQuery = [vendor.legal_name, vendor.city, vendor.state].filter(Boolean).join(' ')

  return `You are researching a federal contractor to understand their business so we can compare them to ${tenantName}.

VENDOR TO RESEARCH:
- Legal name: ${vendor.legal_name}
- Observed location: ${vendor.city || '?'}, ${vendor.state || '?'}
- UEI: ${vendor.uei || '(not provided)'}

USE THE web_search TOOL to find the vendor's website, LinkedIn, or other profile. Use this search query first: "${searchQuery}"

If the first result doesn't clearly identify the company, try a more specific query with their city/state to disambiguate.

COMPANY WE'RE COMPARING THEM TO (${tenantName}):
${tenantProfileText.slice(0, 2000)}

After searching, answer:

1. Description: 1-2 sentences on what the vendor does (based on search results)
2. Business model: prime | subcontractor | federal-native | commercial-native | unknown
3. Federal posture: has_federal | no_federal | unknown | heavy_federal
4. Similarity to ${tenantName} (0-10): how similar are their core capabilities?
5. Key capabilities (3-5 short phrases)
6. Website URL you found (if any)

Return ONLY JSON at the end, no other text:
\`\`\`json
{
  "description": "...",
  "business_model": "...",
  "federal_posture": "...",
  "similarity_score": 5,
  "similarity_rationale": "...",
  "key_capabilities": ["..."],
  "website": "..."
}
\`\`\``
}
