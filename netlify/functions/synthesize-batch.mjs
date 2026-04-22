// synthesize-batch.mjs
// Takes a BATCH of digests and produces a partial analysis.
// Small enough to fit well under Netlify's 10-second sync function timeout.
//
// Request: {
//   tenant_name: string,
//   batch_index: number,     // 1-indexed for display
//   batch_total: number,
//   sources: [{label, source_type, digest_text}]
// }
// Response: { partial_analysis, batch_index, source_count }

import { json } from './_shared-claude.mjs'

const BATCH_PROMPT = `You are analyzing a BATCH of digested sources about {{tenant_name}}. This is batch {{batch_index}} of {{batch_total}}.

Your job: extract signal from THIS BATCH ONLY into a dense partial. A later merge step will combine all partials.

BATCH CONTENT:
{{sources_blob}}

Produce ~150 words of dense prose covering what this batch reveals. Structure loosely as: products/capabilities · customers/partners · traction signals · technical differentiators · federal signals (if any). Use narrative prose — no bullets, no headers other than the title below.

Format: start with "## Batch {{batch_index}} partial" as the only heading. Then the prose. No filler, no speculation, no padding.`

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })

  let payload
  try {
    payload = JSON.parse(event.body || '{}')
  } catch {
    return json(400, { error: 'Invalid JSON' })
  }

  const { tenant_name, batch_index, batch_total, sources = [] } = payload
  if (!tenant_name) return json(400, { error: 'tenant_name required' })
  if (sources.length === 0) return json(400, { error: 'sources required' })

  const sources_blob = sources
    .map((s, i) => `### Source ${i + 1}: ${s.label} (${s.source_type})\n${s.digest_text || '(no digest)'}`)
    .join('\n\n---\n\n')

  const prompt = BATCH_PROMPT
    .replace(/\{\{tenant_name\}\}/g, tenant_name)
    .replace(/\{\{batch_index\}\}/g, String(batch_index))
    .replace(/\{\{batch_total\}\}/g, String(batch_total))
    .replace(/\{\{sources_blob\}\}/g, sources_blob)

  try {
    const t0 = Date.now()
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return json(500, { error: 'ANTHROPIC_API_KEY not configured' })

    console.log(`[batch ${batch_index}/${batch_total}] starting Claude call, ${sources.length} sources, prompt len=${prompt.length}`)

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', // Haiku is fast; partial analysis doesn't need Sonnet-level quality
        max_tokens: 800,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    const t1 = Date.now()
    console.log(`[batch ${batch_index}/${batch_total}] Claude responded after ${t1 - t0}ms, status ${resp.status}`)

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '')
      return json(502, { error: `Anthropic ${resp.status}: ${errText.slice(0, 500)}` })
    }

    const data = await resp.json()
    const text = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')

    return json(200, {
      partial_analysis: text.trim(),
      batch_index,
      source_count: sources.length,
    })
  } catch (err) {
    return json(500, { error: err.message || 'Batch synthesis failed' })
  }
}
