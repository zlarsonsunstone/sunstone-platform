/**
 * Browser-side Claude client.
 *
 * This module talks directly to the Anthropic API from the browser, bypassing
 * the Netlify function layer for any workflow that needs more than 30 seconds
 * of compute or that benefits from streaming UI feedback.
 *
 * Two key exports:
 *   - callClaudeBrowser: generic chat completion call
 *   - extractPdfTextBrowser: PDF text extraction via Claude's PDF support
 *
 * Plus helpers for the Stages 0-3 recommendation flow and tokenization.
 */

const API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY as string

if (!API_KEY) {
  console.warn('VITE_ANTHROPIC_API_KEY missing - browser-side Claude calls will fail')
}

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'

export interface ClaudeBrowserOptions {
  model?: string
  maxTokens?: number
  system?: string
  temperature?: number
  signal?: AbortSignal
}

export interface ClaudeBrowserResponse {
  text: string
  raw: any
}

const DEFAULT_MODEL = 'claude-sonnet-4-5'

/**
 * Call Claude directly from the browser. Bypasses Netlify function timeouts.
 *
 * Browser-side direct API call requires the 'anthropic-dangerous-direct-browser-access'
 * header. This is fine in our trust model: API key is in env, scoped to this app,
 * and we're not embedding it in user-shared content.
 */
export async function callClaudeBrowser(
  userMessage: string | Array<any>,
  options: ClaudeBrowserOptions = {}
): Promise<ClaudeBrowserResponse> {
  if (!API_KEY) {
    throw new Error(
      'Anthropic API key not configured. Set VITE_ANTHROPIC_API_KEY in your environment.'
    )
  }

  const messages = typeof userMessage === 'string'
    ? [{ role: 'user', content: userMessage }]
    : [{ role: 'user', content: userMessage }]

  const body: any = {
    model: options.model || DEFAULT_MODEL,
    max_tokens: options.maxTokens ?? 4096,
    messages,
  }
  if (options.system) body.system = options.system
  if (typeof options.temperature === 'number') body.temperature = options.temperature

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
    signal: options.signal,
  })

  if (!response.ok) {
    const errBody = await response.text().catch(() => '')
    throw new Error(`Claude API error ${response.status}: ${errBody.slice(0, 500)}`)
  }

  const data = await response.json()
  const text = (data?.content || [])
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('\n')
    .trim()

  return { text, raw: data }
}

/**
 * Extract a JSON block from Claude output. Returns null if no parseable JSON found.
 *
 * Looks for ```json ... ``` first, then bare JSON, then any { ... } block.
 */
export function extractJsonBlock(text: string): any | null {
  if (!text) return null

  // Try fenced json block
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fencedMatch && fencedMatch[1]) {
    try {
      return JSON.parse(fencedMatch[1].trim())
    } catch {
      // fall through
    }
  }

  // Try first {...} block
  const braceMatch = text.match(/\{[\s\S]*\}/)
  if (braceMatch) {
    try {
      return JSON.parse(braceMatch[0])
    } catch {
      // fall through
    }
  }

  return null
}

/**
 * Browser-side PDF text extraction via Claude.
 *
 * Reads the PDF as base64, sends it as a document content block, asks Claude
 * to extract all text. Bypasses Netlify function timeout limits because some
 * PDFs (especially large or poorly-OCR'd ones) take longer than 30 seconds.
 *
 * Returns the extracted text as a single string. Returns empty string on
 * failure (caller decides how to handle).
 */
export async function extractPdfTextBrowser(
  fileOrBlob: File | Blob,
  options: { maxTokens?: number; signal?: AbortSignal } = {}
): Promise<string> {
  const buffer = await fileOrBlob.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  const base64 = btoa(binary)

  const userBlocks = [
    {
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: base64,
      },
    },
    {
      type: 'text',
      text: `Extract ALL the text from this PDF, preserving structure (headings, lists, paragraphs, table contents).

Output ONLY the extracted text - no preamble, no commentary, no summary. Just the raw text content of the document, formatted for readability.

If the PDF has multiple sections, separate them with double newlines. Preserve the original order.`,
    },
  ]

  const { text } = await callClaudeBrowser(userBlocks as any, {
    model: 'claude-sonnet-4-5',
    maxTokens: options.maxTokens ?? 16384,
    signal: options.signal,
  })

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
  frame: 'lions' | 'lambs'
  reasoning: string
  confidence: 'high' | 'medium' | 'low'
  signals_for_lions: string[]
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
 * Recommend whether the engagement should run in lions frame
 * (competing) or lambs frame (disrupting).
 */
export async function recommendAnalyticalFrame(
  profile: ProfileSnapshot
): Promise<FrameRecommendation> {
  const system = `You are a federal market analyst for Sunstone Advisory Group.

Your job: read the prospect's reconciled profile and recommend whether their recon should run in LIONS frame (competing) or LAMBS frame (disrupting).

LIONS frame is correct when:
- The market exists, vendors exist, the prospect wants to compete on the same territory
- Picture lions on the Serengeti: established prides have territory, the prospect wants to take some
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
- Lions signals: established capability, mature NAICS, prior contracting under primes, certification stack, "we want to win contracts our peers win"
- Lambs signals: novel technology, paradigm shift language, statutory/policy change, "we will displace [incumbent type]", emerging or recently-legislated market

Return ONLY a JSON block in this exact shape, no preamble:

\`\`\`json
{
  "frame": "lions|lambs",
  "reasoning": "2-3 sentence explanation of why this frame fits",
  "confidence": "high|medium|low",
  "signals_for_lions": ["specific evidence from the profile that suggests lions"],
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
  frame: 'lions' | 'lambs'
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
  frame: 'lions' | 'lambs',
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
