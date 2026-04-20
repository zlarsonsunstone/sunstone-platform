// Shared helper: call Anthropic Claude API
// Usage: import { callClaude } from './_shared-claude.mjs'

export async function callClaude(prompt, { maxTokens = 4096, model = 'claude-sonnet-4-5' } = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!resp.ok) {
    const txt = await resp.text()
    throw new Error(`Anthropic API ${resp.status}: ${txt}`)
  }

  const data = await resp.json()
  const text = (data.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')
  return { text, raw: data }
}

export function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

export function extractJsonBlock(text) {
  // Extract ```json ... ``` block from Claude response
  const match = text.match(/```json\s*([\s\S]*?)```/i)
  if (!match) return null
  try {
    return JSON.parse(match[1])
  } catch {
    return null
  }
}
