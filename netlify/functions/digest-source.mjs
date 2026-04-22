// digest-source: process ONE source through Claude and return a 200-300 word digest
// Request: {
//   tenant_name, source_type, source_label, source_url?,
//   source_content?, pdf_base64?,
//   prompt_template
// }
// Response: { digest, structured, raw_text }

import { extractJsonBlock, json } from './_shared-claude.mjs'

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })

  let payload
  try {
    payload = JSON.parse(event.body || '{}')
  } catch {
    return json(400, { error: 'Invalid JSON' })
  }

  const {
    tenant_name,
    source_type,
    source_label,
    source_url,
    source_content,
    pdf_base64,
    prompt_template,
  } = payload

  if (!tenant_name) return json(400, { error: 'tenant_name required' })
  if (!prompt_template) return json(400, { error: 'prompt_template required' })
  if (!source_content && !pdf_base64) {
    return json(400, { error: 'source_content or pdf_base64 required' })
  }

  const urlLine = source_url ? `SOURCE URL: ${source_url}\n` : ''
  const contentPlaceholder = pdf_base64
    ? '(PDF document attached)'
    : source_content || '(empty)'

  const prompt = prompt_template
    .replace(/\{\{tenant_name\}\}/g, tenant_name)
    .replace(/\{\{source_type\}\}/g, source_type || 'unknown')
    .replace(/\{\{source_label\}\}/g, source_label || 'unlabeled')
    .replace(/\{\{#if source_url\}\}SOURCE URL: \{\{source_url\}\}\{\{\/if\}\}/g, urlLine.trim())
    .replace(/\{\{source_content\}\}/g, contentPlaceholder)

  const content = []
  if (pdf_base64) {
    content.push({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: pdf_base64 },
    })
  }
  content.push({ type: 'text', text: prompt })

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
        max_tokens: 2048,   // digests are small on purpose
        messages: [{ role: 'user', content }],
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
    const digest = text.replace(/```json[\s\S]*?```/i, '').trim()

    return json(200, { digest, structured, raw_text: text })
  } catch (err) {
    return json(500, { error: err.message || 'Digest failed' })
  }
}
