// merge-batches.mjs
// Takes all batch partials and produces the FINAL commercial or federal profile.
// Input is already compressed (batch partials ~400 words each), so this fits
// well under the 10-second sync function timeout.
//
// Request: {
//   tenant_name: string,
//   tenant_website?: string,
//   partials: string[],           // array of batch partial analyses
//   prompt_template: string,
//   bucket: 'commercial' | 'federal'
// }
// Response: { narrative, structured, raw_text }

import { extractJsonBlock, json } from './_shared-claude.mjs'

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })

  let payload
  try {
    payload = JSON.parse(event.body || '{}')
  } catch {
    return json(400, { error: 'Invalid JSON' })
  }

  const { tenant_name, tenant_website, partials = [], prompt_template, bucket } = payload
  if (!tenant_name) return json(400, { error: 'tenant_name required' })
  if (!prompt_template) return json(400, { error: 'prompt_template required' })
  if (partials.length === 0) return json(400, { error: 'partials required' })

  // Assemble all partials into the sources blob
  const combined_blob = partials
    .map((p, i) => `## Partial ${i + 1}\n${p}`)
    .join('\n\n')

  // Use the existing prompt template (commercial_profile_v1 or federal_profile_v1)
  // Feed it the merged partials as if they were the sources
  const placeholderKey = bucket === 'federal' ? 'federal_sources' : 'commercial_sources'

  let prompt = prompt_template
    .replace(/\{\{tenant_name\}\}/g, tenant_name)
    .replace(new RegExp(`\\{\\{${placeholderKey}\\}\\}`, 'g'), combined_blob)
  if (bucket === 'commercial') {
    prompt = prompt.replace(/\{\{tenant_website\}\}/g, tenant_website || '(not provided)')
  }

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
        max_tokens: 2048, // capped — partials already condensed the data
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '')
      return json(502, { error: `Anthropic ${resp.status}: ${errText.slice(0, 500)}` })
    }

    const data = await resp.json()
    const text = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')

    const structured = extractJsonBlock(text)
    const narrative = text.replace(/```json[\s\S]*?```/i, '').trim()

    return json(200, { narrative, structured, raw_text: text })
  } catch (err) {
    return json(500, { error: err.message || 'Merge failed' })
  }
}
