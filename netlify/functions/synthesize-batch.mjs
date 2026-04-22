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

const BATCH_PROMPT = `You are analyzing a BATCH of digested sources about {{tenant_name}} as part of a larger profile synthesis. This is batch {{batch_index}} of {{batch_total}}.

Your job: extract and organize the signal from THIS BATCH ONLY. Don't try to write a final company profile — that happens in a later merge step. Just synthesize the batch content into a tight structured partial.

BATCH CONTENT:
{{sources_blob}}

Produce a concise analysis covering what THIS batch reveals about:
- Products, services, capabilities
- Customers, partners, markets
- Leadership, team
- Traction events (funding, launches, milestones)
- Technical differentiators, IP
- Federal/government signals (if any)
- Notable quotes or claims

Write it as ~400 words of dense prose under the heading "## Batch {{batch_index}} partial". Do NOT use markdown lists or tables — narrative prose only. Do NOT duplicate information. Do NOT speculate about things not in the batch. Do NOT pad with filler.`

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
        max_tokens: 2048, // small batches, small outputs
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

    return json(200, {
      partial_analysis: text.trim(),
      batch_index,
      source_count: sources.length,
    })
  } catch (err) {
    return json(500, { error: err.message || 'Batch synthesis failed' })
  }
}
