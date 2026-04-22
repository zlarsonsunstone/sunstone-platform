// build-commercial-profile: synthesize commercial profile from digested sources
// Preferred input: digested sources (fast, compressed). Falls back to raw if no digest.
// Request: {
//   tenant_name, tenant_website?,
//   sources: [{label, source_type, digest_text?, extracted_text?, raw_content?}],
//   prompt_template
// }

import { extractJsonBlock, json } from './_shared-claude.mjs'

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })

  let payload
  try {
    payload = JSON.parse(event.body || '{}')
  } catch {
    return json(400, { error: 'Invalid JSON' })
  }

  const { tenant_name, tenant_website, sources = [], prompt_template } = payload
  if (!tenant_name) return json(400, { error: 'tenant_name required' })
  if (!prompt_template) return json(400, { error: 'prompt_template required' })

  const textBlob = sources
    .map((s, i) => {
      // Prefer digest; fall back to extracted/raw; truncate raw to 2000 chars as last resort
      const content =
        s.digest_text ||
        s.extracted_text ||
        (s.raw_content ? s.raw_content.slice(0, 2000) : '(no content)')
      return `### Source ${i + 1}: ${s.label} (${s.source_type})\n${content}`
    })
    .join('\n\n---\n\n')

  const prompt = prompt_template
    .replace(/\{\{tenant_name\}\}/g, tenant_name)
    .replace(/\{\{tenant_website\}\}/g, tenant_website || '(not provided)')
    .replace(/\{\{commercial_sources\}\}/g, textBlob || '(no sources provided)')

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return json(500, { error: 'ANTHROPIC_API_KEY not configured' })

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 8192,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '')
      return json(502, { error: `Anthropic ${resp.status}: ${errText.slice(0, 500) || 'no body'}` })
    }

    const data = await resp.json()
    const text = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')

    const structured = extractJsonBlock(text)
    const narrative = text.replace(/```json[\s\S]*?```/i, '').trim()

    return json(200, { narrative, structured, raw_text: text, source_count: sources.length })
  } catch (err) {
    return json(500, { error: err.message || 'Synthesis failed' })
  }
}
