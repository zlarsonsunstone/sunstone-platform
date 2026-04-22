/**
 * Browser-side Claude client.
 *
 * Calls Anthropic's API directly from the browser (bypassing Netlify functions)
 * so we aren't constrained by Netlify's 10-second sync function timeout.
 *
 * Requires: VITE_ANTHROPIC_API_KEY in the environment at build time.
 *
 * Security note: the API key IS visible to anyone who inspects the site's JS.
 * For this admin tool that's acceptable — the app is login-gated and the key
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
}

export interface CallClaudeResult {
  text: string
  usage?: { input_tokens: number; output_tokens: number }
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

  return { text, usage: data.usage }
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
