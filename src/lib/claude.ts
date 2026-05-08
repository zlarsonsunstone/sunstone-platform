/**
 * Browser-side Claude client.
 *
 * Calls Anthropic's API directly from the browser (bypassing Netlify functions)
 * so we aren't constrained by Netlify's 10-second sync function timeout.
 *
 * Requires: VITE_ANTHROPIC_API_KEY in the environment at build time.
 *
 * Security note: the API key IS visible to anyone who inspects the site's JS.
 * For this admin tool that's acceptable - the app is login-gated and the key
 * can be rotated if leaked. For a public-facing product we would route through
 * a proper auth-gated proxy.
 */

const API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY as string | undefined
const API_URL = 'https://api.anthropic.com/v1/messages'

export interface CallClaudeOptions {
  model?: string
  maxTokens?: number
  system?: string
  signal?: AbortSignal
  /** Enable web_search tool. Claude can choose to search the web before answering. */
  enableWebSearch?: boolean
  /** Max web searches per call (server-side limit). Default 5. */
  maxWebSearches?: number
}

export interface CallClaudeResult {
  text: string
  usage?: { input_tokens: number; output_tokens: number }
  /** Number of web searches actually performed during the call. */
  webSearchesUsed?: number
}

export async function callClaudeBrowser(
  prompt: string,
  options: CallClaudeOptions = {}
): Promise<CallClaudeResult> {
  if (!API_KEY) {
    throw new Error(
      'VITE_ANTHROPIC_API_KEY not configured. Add it to Netlify env vars and redeploy.'
    )
  }

  const body: any = {
    model: options.model || 'claude-sonnet-4-5',
    max_tokens: options.maxTokens || 4096,
    messages: [{ role: 'user', content: prompt }],
  }
  if (options.system) body.system = options.system

  // Server-side web search tool. Only attached when explicitly requested so
  // deterministic calls (keyword extraction, etc.) aren't accidentally paying
  // for search turns.
  if (options.enableWebSearch) {
    body.tools = [
      {
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: options.maxWebSearches || 5,
      },
    ]
  }

  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      // Required to allow browser-direct calls
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
    signal: options.signal,
  })

  if (!resp.ok) {
    let errBody = ''
    try {
      errBody = await resp.text()
    } catch {}
    throw new Error(`Anthropic API ${resp.status}: ${errBody.slice(0, 500) || 'no body'}`)
  }

  const data = await resp.json()
  const text = (data.content || [])
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('\n')

  // Count web_search_tool_result blocks to track actual usage
  const webSearchesUsed = (data.content || []).filter(
    (b: any) => b.type === 'web_search_tool_result'
  ).length

  return { text, usage: data.usage, webSearchesUsed: webSearchesUsed || undefined }
}

export function extractJsonBlock(text: string): any | null {
  const match = text.match(/```json\s*([\s\S]*?)```/i)
  if (!match) return null
  try {
    return JSON.parse(match[1].trim())
  } catch {
    return null
  }
}

/**
 * Extract text from a PDF directly in the browser via Anthropic's document API.
 *
 * Bypasses Netlify functions entirely - no timeout cap, no upload-roundtrip
 * to a serverless function. The browser sends the base64 PDF straight to
 * Anthropic and gets text back.
 *
 * @param pdfBase64 base64-encoded PDF bytes (no data: prefix)
 * @param filename optional filename for context
 * @returns extracted text
 */
export async function extractPdfTextBrowser(
  pdfBase64: string,
  filename?: string
): Promise<string> {
  if (!API_KEY) {
    throw new Error(
      'VITE_ANTHROPIC_API_KEY not configured. Add it to Netlify env vars and redeploy.'
    )
  }

  const body = {
    model: 'claude-sonnet-4-5',
    max_tokens: 8192,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: pdfBase64,
            },
          },
          {
            type: 'text',
            text: filename
              ? `Extract ALL text content from this PDF (${filename}). Preserve the structure with headings and sections. Output only the extracted text - no commentary, no meta-description, no summary. Just the text as it appears in the document.`
              : 'Extract ALL text content from this PDF. Preserve the structure with headings and sections. Output only the extracted text - no commentary, no meta-description, no summary. Just the text as it appears in the document.',
          },
        ],
      },
    ],
  }

  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  })

  if (!resp.ok) {
    let errBody = ''
    try {
      errBody = await resp.text()
    } catch {}
    throw new Error(`Anthropic API ${resp.status}: ${errBody.slice(0, 500) || 'no body'}`)
  }

  const data = await resp.json()
  const text = (data.content || [])
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('\n')

  if (!text || text.trim().length === 0) {
    throw new Error('Extraction returned no text')
  }

  return text
}

// =============================================================================
// STAGE-AWARE RECOMMENDATION HELPERS
// =============================================================================
//
// These helpers feed the consultant-recommends-client-confirms flow. Each one
// reads structured profile state and returns a recommendation with reasoning.
// The consultant reviews/edits, then sends to client for confirmation.
//
// All return shapes are JSON-typed so the UI can render the recommendation
// + reasoning + editable fields without re-parsing.
// =============================================================================

interface ProfileSnapshot {
  profile_name?: string
  reconciled_summary?: string  // pulled from commercial + federal + understanding
  claims?: Array<{ claim_text: string; status?: string; tier?: number }>
  evidence?: Array<{ evidence_text: string; tier?: number }>
  market_understanding?: any
  capability_narrative?: string
}

export interface FrameRecommendation {
  frame: 'doppelganger' | 'lambs'
  reasoning: string
  confidence: 'high' | 'medium' | 'low'
  signals_for_doppelganger: string[]
  signals_for_lambs: string[]
  what_we_would_show_client: string
}

export interface PersonaRecommendation {
  persona: string
  reasoning: string
  confidence: 'high' | 'medium' | 'low'
  signals: string[]
  what_we_would_show_client: string
  alternative_personas: Array<{ name: string; why_not_lead: string }>
}

export interface PurposeRecommendation {
  purpose: 'show_market_state' | 'convince' | 'educate' | 'show_market_demand'
  reasoning: string
  confidence: 'high' | 'medium' | 'low'
  what_we_would_show_client: string
}

const KNOWN_PERSONAS = [
  'Subcontractor Stuck in the Middle',
  'Successful and Skeptical',
  'Brand New',
  'Compliance-maintaining non-participant',
  'Recently Re-Energized',
  'Sub-Prime Plateau',
  'Disruptive Entrant',
  'Mature Player Pivoting',
  'Adjacent Market Crossover',
]

/**
 * Recommend whether the engagement should run in doppelganger frame
 * (competing) or lambs frame (disrupting).
 */
export async function recommendAnalyticalFrame(
  profile: ProfileSnapshot
): Promise<FrameRecommendation> {
  const system = `You are a federal market analyst for Sunstone Advisory Group.

Your job: read the prospect's reconciled profile and recommend whether their recon should run in DOPPELGANGER frame (competing) or LAMBS frame (disrupting).

DOPPELGANGER frame is correct when:
- The market exists, vendors exist, the prospect wants to compete on the same field
- Question: "Who else won this work, and how do I become them?"
- Bullseye = vendors who look like the prospect and won
- Persona fits: established companies, mature markets, "Successful and Skeptical", "Subcontractor Stuck in the Middle"

LAMBS frame is correct when:
- Incumbents exist BUT they are about to be obsoleted by structural change (tech shift, policy mandate, statutory requirement, security paradigm change)
- Lambs are NOT "no competitors" - they are obsolete competitors who have contracts today, won't tomorrow
- Question: "Who currently holds contracts that I will displace, and how do I take their territory?"
- Bullseye = vendors holding contracts the prospect's emerging capability will eat
- Persona fits: novel offerings, displacement thesis players, "Brand New", "Disruptive Entrant"

Look for these signals:
- Doppelganger signals: established capability, mature NAICS, prior contracting under primes, certification stack, "we want to win contracts our peers win"
- Lamb signals: novel technology, paradigm shift language, statutory/policy change, "we will displace [incumbent type]", emerging or recently-legislated market

Return ONLY a JSON block in this exact shape, no preamble:

\`\`\`json
{
  "frame": "doppelganger|lambs",
  "reasoning": "2-3 sentence explanation of why this frame fits",
  "confidence": "high|medium|low",
  "signals_for_doppelganger": ["specific evidence from the profile that suggests doppelganger"],
  "signals_for_lambs": ["specific evidence from the profile that suggests lambs"],
  "what_we_would_show_client": "1-2 sentence framing of how we'd present this recommendation to the client for their confirmation"
}
\`\`\``

  const userMessage = `PROSPECT: ${profile.profile_name || 'Unnamed'}

RECONCILED PROFILE SUMMARY:
${profile.reconciled_summary || '(not available)'}

CAPABILITY NARRATIVE:
${profile.capability_narrative || '(not available)'}

KEY CLAIMS:
${(profile.claims || []).slice(0, 20).map(c => `- "${c.claim_text}" [tier ${c.tier || '?'}, ${c.status || 'untested'}]`).join('\n') || '(none)'}

KEY EVIDENCE:
${(profile.evidence || []).slice(0, 20).map(e => `- "${e.evidence_text}" [tier ${e.tier || '?'}]`).join('\n') || '(none)'}

MARKET UNDERSTANDING:
${JSON.stringify(profile.market_understanding || {}, null, 2)}

Recommend the analytical frame.`

  const response = await callClaudeBrowser(userMessage, {
    system,
    maxTokens: 2048,
  })

  const parsed = extractJsonBlock(response.text)
  if (!parsed) {
    throw new Error('Could not parse frame recommendation JSON from Claude response')
  }
  return parsed as FrameRecommendation
}

/**
 * Recommend persona based on reconciled profile.
 */
export async function recommendPersona(
  profile: ProfileSnapshot,
  frame: 'doppelganger' | 'lambs'
): Promise<PersonaRecommendation> {
  const system = `You are a federal market analyst for Sunstone Advisory Group.

Your job: read the prospect's reconciled profile and recommend the most-fitting persona from the Sunstone Persona library.

Sunstone Persona library (pick from this list, do not invent new ones):
${KNOWN_PERSONAS.map(p => `- ${p}`).join('\n')}

Each persona implies different burden of proof for the brief:
- "Subcontractor Stuck in the Middle" - acknowledge the trap, surface why certification alone won't unlock prime
- "Successful and Skeptical" - don't pitch, show data, let them draw conclusions
- "Brand New" - educate before diagnose, surface level sufficient
- "Compliance-maintaining non-participant" - show what they have built but never deployed
- "Recently Re-Energized" - validate the new energy, show the path that earns the investment
- "Sub-Prime Plateau" - structural problem framing, prime path required
- "Disruptive Entrant" - displacement thesis, demand sizing for the new paradigm
- "Mature Player Pivoting" - bridge the legacy to the new
- "Adjacent Market Crossover" - federal vocabulary translation, vehicle access

Frame context: this is a ${frame} engagement.

Return ONLY a JSON block:

\`\`\`json
{
  "persona": "exact persona name from the list",
  "reasoning": "2-3 sentence explanation",
  "confidence": "high|medium|low",
  "signals": ["specific evidence from the profile"],
  "what_we_would_show_client": "1-2 sentence framing for client confirmation",
  "alternative_personas": [
    {"name": "alternative", "why_not_lead": "why this isn't the lead recommendation"}
  ]
}
\`\`\``

  const userMessage = `PROSPECT: ${profile.profile_name || 'Unnamed'}

RECONCILED PROFILE:
${profile.reconciled_summary || '(not available)'}

KEY CLAIMS:
${(profile.claims || []).slice(0, 20).map(c => `- "${c.claim_text}"`).join('\n') || '(none)'}

KEY EVIDENCE:
${(profile.evidence || []).slice(0, 20).map(e => `- "${e.evidence_text}"`).join('\n') || '(none)'}

Recommend the persona.`

  const response = await callClaudeBrowser(userMessage, {
    system,
    maxTokens: 2048,
  })

  const parsed = extractJsonBlock(response.text)
  if (!parsed) {
    throw new Error('Could not parse persona recommendation JSON')
  }
  return parsed as PersonaRecommendation
}

/**
 * Recommend brief purpose based on reconciled profile + frame + persona.
 */
export async function recommendPurpose(
  profile: ProfileSnapshot,
  frame: 'doppelganger' | 'lambs',
  persona: string
): Promise<PurposeRecommendation> {
  const system = `You are a federal market analyst for Sunstone Advisory Group.

Your job: recommend the editorial PURPOSE of the recon brief.

Four valid purposes:
- show_market_state: diagnostic mirror, no sales push, end with "here is what the data says"
- convince: there is a specific objection to overcome, name it, dismantle it
- educate: teach federal mechanics they need to understand before they can decide
- show_market_demand: prove the market exists at scale they doubted

Frame: ${frame}
Persona: ${persona}

Persona implications:
- "Brand New" usually pairs with educate
- "Successful and Skeptical" usually pairs with show_market_state or show_market_demand
- "Subcontractor Stuck in the Middle" or "Sub-Prime Plateau" usually pairs with convince
- "Disruptive Entrant" usually pairs with show_market_demand or convince
- "Compliance-maintaining non-participant" usually pairs with show_market_state

Return ONLY a JSON block:

\`\`\`json
{
  "purpose": "show_market_state|convince|educate|show_market_demand",
  "reasoning": "2-3 sentence explanation",
  "confidence": "high|medium|low",
  "what_we_would_show_client": "1-2 sentence framing for client confirmation"
}
\`\`\``

  const userMessage = `PROSPECT: ${profile.profile_name || 'Unnamed'}

RECONCILED PROFILE:
${profile.reconciled_summary || '(not available)'}

Recommend the purpose.`

  const response = await callClaudeBrowser(userMessage, {
    system,
    maxTokens: 1024,
  })

  const parsed = extractJsonBlock(response.text)
  if (!parsed) {
    throw new Error('Could not parse purpose recommendation JSON')
  }
  return parsed as PurposeRecommendation
}

// =============================================================================
// TOKEN GENERATION
// =============================================================================

/**
 * Generate a cryptographically-random tokenized URL slug for prospect-view links.
 * 32 bytes -> 43 chars base64url -> roughly 256 bits of entropy.
 */
export function generateProspectViewToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  // base64url encoding
  const b64 = btoa(String.fromCharCode(...bytes))
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
