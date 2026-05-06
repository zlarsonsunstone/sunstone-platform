// =============================================================================
// analyze-market-entry
// =============================================================================
//
// Posture-aware analysis edge function for Market Research entries.
//
// Reads a v2.market_research row, picks an analytical prompt based on the
// market_posture field (general/evidence/thesis/myth_bust), calls Claude,
// and writes the structured analysis back to the same row.
//
// Each posture produces a different output shape:
//
//   general    -> { summary, total_addressable_spend, key_players,
//                   vehicle_activity, anomalies, gaps }
//   evidence   -> { verdict (confirmed|contradicted|unclear), confidence,
//                   supporting_data, conflicting_data, citations }
//   thesis     -> { strength_of_support (strong|moderate|weak|none),
//                   best_supporting_data, gaps, counterevidence }
//   myth_bust  -> { conventional_wisdom, supporting_evidence,
//                   contradicting_evidence, verdict, dissonance_strength }
//
// Pattern matches analyze-corpus-entry: raw fetch (no SDK), pure ASCII,
// service-role Supabase, ~10s typical runtime, 26s Netlify Pro timeout.
// =============================================================================

import type { Handler } from '@netlify/functions'

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || process.env.VITE_ANTHROPIC_API_KEY
const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const MODEL = 'claude-sonnet-4-5'
const MAX_TOKENS = 4096

// -----------------------------------------------------------------------------
// Supabase REST helpers (service role - bypasses RLS)
// -----------------------------------------------------------------------------

async function supabaseSelect(table: string, query: string): Promise<any[]> {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${query}`
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY!,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Accept-Profile': 'v2',
    },
  })
  if (!res.ok) throw new Error(`Supabase select ${table} ${res.status}: ${await res.text()}`)
  return res.json()
}

async function supabaseUpdate(table: string, query: string, body: any): Promise<void> {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${query}`
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY!,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Profile': 'v2',
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Supabase update ${table} ${res.status}: ${await res.text()}`)
}

// -----------------------------------------------------------------------------
// Claude API call (raw fetch - no SDK)
// -----------------------------------------------------------------------------

async function callClaude(systemPrompt: string, userPrompt: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  })
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${await res.text()}`)
  const data = await res.json()
  const block = (data.content || []).find((b: any) => b.type === 'text')
  if (!block) throw new Error('No text block in Claude response')
  return block.text
}

function extractJson(text: string): any {
  const m = text.match(/```json\s*([\s\S]*?)```/)
  const raw = m ? m[1] : text
  try {
    return JSON.parse(raw.trim())
  } catch (e) {
    throw new Error(`Failed to parse JSON from Claude: ${(e as Error).message}`)
  }
}

// -----------------------------------------------------------------------------
// Posture-specific prompts
// -----------------------------------------------------------------------------

const POSTURE_PROMPTS: Record<string, { system: string; userTemplate: string }> = {
  general: {
    system: `You are a federal market analyst conducting GENERAL ANALYSIS of a market data artifact.

Your job: read the artifact and surface what the market looks like. No prior thesis to test, no specific claim to verify. Just: what is here, what patterns matter, what's missing.

Output structured JSON. Be specific with numbers, agencies, NAICS/PSC codes when present. Flag anomalies and data gaps explicitly.`,
    userTemplate: `MARKET ARTIFACT TITLE: {{title}}
SOURCE: {{source}}
CONSULTANT CONTEXT: {{user_context}}

ARTIFACT CONTENT:
{{content}}

Return ONLY a JSON block in this exact shape:

\`\`\`json
{
  "posture": "general",
  "summary": "2-3 sentence read of what this artifact shows about the market",
  "total_addressable_spend": "dollar figure with period if present, otherwise null",
  "key_players": ["array of top vendors/competitors with role"],
  "vehicle_activity": ["array of IDIQs/contracts/vehicles with brief notes"],
  "naics_psc_observed": ["array of NAICS/PSC codes seen with frequency or volume"],
  "trends": ["array of YoY or directional patterns"],
  "anomalies": ["array of things that look unusual or worth flagging"],
  "gaps": ["array of what this artifact does NOT cover that a brief would need"],
  "confidence": "high|medium|low - how confident the read is"
}
\`\`\``,
  },

  evidence: {
    system: `You are a federal market analyst conducting EVIDENCE HUNTING against a specific claim.

The consultant has a claim they need to test. Your job: read the artifact and determine whether it CONFIRMS, CONTRADICTS, or is INCONCLUSIVE for the specific claim. Cite specific data points. Surface conflicting data even if the dominant signal supports the claim.

Output structured JSON. Do not soften the verdict - if the data contradicts, say so.`,
    userTemplate: `CLAIM BEING TESTED: {{posture_context}}

MARKET ARTIFACT TITLE: {{title}}
SOURCE: {{source}}
CONSULTANT CONTEXT: {{user_context}}

ARTIFACT CONTENT:
{{content}}

Return ONLY a JSON block in this exact shape:

\`\`\`json
{
  "posture": "evidence",
  "claim_tested": "verbatim restatement of the claim",
  "verdict": "confirmed|contradicted|inconclusive",
  "confidence": "high|medium|low",
  "supporting_data": ["array of specific data points that support the claim"],
  "conflicting_data": ["array of specific data points that conflict with the claim"],
  "citations": ["array of source-specific references (page, section, URL fragment)"],
  "verdict_rationale": "1-2 sentence explanation of why this verdict",
  "additional_research_needed": ["array of what would resolve any inconclusiveness"]
}
\`\`\``,
  },

  thesis: {
    system: `You are a federal market analyst conducting THESIS SUPPORT research.

The consultant has a position they want to argue. Your job: read the artifact and find what backs up the thesis. ALSO surface counterevidence honestly - thesis support is not advocacy, it's diagnostic. Note gaps where the thesis is weakest.

Output structured JSON. Rank support strength and call out where you'd want more data.`,
    userTemplate: `THESIS BEING SUPPORTED: {{posture_context}}

MARKET ARTIFACT TITLE: {{title}}
SOURCE: {{source}}
CONSULTANT CONTEXT: {{user_context}}

ARTIFACT CONTENT:
{{content}}

Return ONLY a JSON block in this exact shape:

\`\`\`json
{
  "posture": "thesis",
  "thesis_restated": "verbatim or close paraphrase of the thesis",
  "strength_of_support": "strong|moderate|weak|none",
  "best_supporting_data": ["array of strongest argument-grade data points with citations"],
  "supporting_pattern": "1-2 sentence narrative of how the data points combine to back the thesis",
  "counterevidence_found": ["array of data points that complicate or weaken the thesis"],
  "gaps": ["array of what's missing that would strengthen the argument"],
  "narrative_recommendation": "1-2 sentence advice on how to use this in the brief"
}
\`\`\``,
  },

  myth_bust: {
    system: `You are a federal market analyst conducting MYTH-BUSTING research.

The consultant suspects a piece of conventional wisdom is wrong. Your job: state the conventional wisdom precisely, then read the artifact for evidence both supporting and contradicting it. Render the side-by-side. The goal is high-impact reveal - if the data DOES contradict the myth, present the contradiction sharply.

Output structured JSON. Be ruthless about citations and data quality.`,
    userTemplate: `CONVENTIONAL WISDOM TO TEST: {{posture_context}}

MARKET ARTIFACT TITLE: {{title}}
SOURCE: {{source}}
CONSULTANT CONTEXT: {{user_context}}

ARTIFACT CONTENT:
{{content}}

Return ONLY a JSON block in this exact shape:

\`\`\`json
{
  "posture": "myth_bust",
  "conventional_wisdom": "precise statement of the belief being tested",
  "supporting_evidence": ["array of data points that uphold the conventional wisdom"],
  "contradicting_evidence": ["array of data points that contradict the conventional wisdom"],
  "verdict": "myth_confirmed|myth_busted|partial|inconclusive",
  "dissonance_strength": "high|medium|low - how compelling is the contradiction",
  "best_reveal": "the single sharpest contradiction to lead with in the brief, with citation",
  "caveats": ["array of qualifications - data limitations, edge cases, etc."]
}
\`\`\``,
  },
}

// -----------------------------------------------------------------------------
// Main handler
// -----------------------------------------------------------------------------

const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  if (!ANTHROPIC_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Missing env vars: ANTHROPIC_API_KEY, SUPABASE_URL, or SUPABASE_SERVICE_ROLE_KEY' }),
    }
  }

  let entry_id: string
  try {
    const body = JSON.parse(event.body || '{}')
    entry_id = body.entry_id
    if (!entry_id) throw new Error('entry_id required')
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: (e as Error).message }) }
  }

  try {
    // 1. Mark as analyzing
    await supabaseUpdate(
      'market_research',
      `id=eq.${entry_id}`,
      { analysis_status: 'analyzing', analysis_error: null }
    )

    // 2. Load the entry
    const rows = await supabaseSelect(
      'market_research',
      `id=eq.${entry_id}&select=id,title,source_label,source_url,raw_payload,extracted_text,user_context,market_posture,posture_context`
    )
    if (!rows.length) throw new Error(`Entry ${entry_id} not found`)
    const entry = rows[0]

    // 3. Pick posture prompt
    const promptSpec = POSTURE_PROMPTS[entry.market_posture]
    if (!promptSpec) throw new Error(`Unknown posture: ${entry.market_posture}`)

    // 4. Build the user prompt with substitutions
    const content = entry.extracted_text
      || (typeof entry.raw_payload === 'object' ? JSON.stringify(entry.raw_payload) : String(entry.raw_payload || ''))
      || '(no content)'

    const userPrompt = promptSpec.userTemplate
      .replace(/\{\{title\}\}/g, entry.title || '(no title)')
      .replace(/\{\{source\}\}/g, [entry.source_label, entry.source_url].filter(Boolean).join(' - ') || '(no source)')
      .replace(/\{\{user_context\}\}/g, entry.user_context || '(none)')
      .replace(/\{\{posture_context\}\}/g, entry.posture_context || '(no specific framing provided)')
      .replace(/\{\{content\}\}/g, content.slice(0, 80000))  // 80KB cap to stay in context

    // 5. Call Claude
    const text = await callClaude(promptSpec.system, userPrompt)
    const analysis = extractJson(text)

    // 6. Write back
    await supabaseUpdate(
      'market_research',
      `id=eq.${entry_id}`,
      {
        analysis,
        analysis_status: 'awaiting_review',
        analysis_error: null,
      }
    )

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, entry_id, posture: entry.market_posture }),
    }
  } catch (e) {
    const errorMessage = (e as Error).message
    try {
      await supabaseUpdate(
        'market_research',
        `id=eq.${entry_id}`,
        { analysis_status: 'error', analysis_error: errorMessage }
      )
    } catch {
      // best-effort
    }
    return { statusCode: 500, body: JSON.stringify({ error: errorMessage }) }
  }
}

export { handler }
