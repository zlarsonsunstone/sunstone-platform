// build-federal-profile: synthesize federal profile from text + PDF sources
// Request: {
//   tenant_name,
//   sources: [{label, source_type, extracted_text?, raw_content?}],
//   documents: [{label, pdf_base64}],
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

  const { tenant_name, sources = [], documents = [], prompt_template } = payload
  if (!tenant_name) return json(400, { error: 'tenant_name required' })
  if (!prompt_template) return json(400, { error: 'prompt_template required' })

  const textBlob = sources
    .map((s, i) => {
      return `### Source ${i + 1}: ${s.label} (${s.source_type})\n${s.extracted_text || s.raw_content || '(no content)'}`
    })
    .join('\n\n---\n\n')

  const docNote = documents.length > 0
    ? `\n\nNOTE: ${documents.length} document(s) are attached directly. Treat them as primary input alongside the text sources above.`
    : ''

  const prompt = prompt_template
    .replace(/\{\{tenant_name\}\}/g, tenant_name)
    .replace(/\{\{federal_sources\}\}/g, (textBlob || '(no federal text sources provided)') + docNote)

  const content = []
  for (const doc of documents) {
    if (!doc.pdf_base64) continue
    content.push({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: doc.pdf_base64 },
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
        max_tokens: 8192,
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
    const narrative = text.replace(/```json[\s\S]*?```/i, '').trim()

    return json(200, { narrative, structured, raw_text: text, document_count: documents.length })
  } catch (err) {
    return json(500, { error: err.message || 'Synthesis failed' })
  }
}
