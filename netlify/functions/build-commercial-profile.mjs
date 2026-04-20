// build-commercial-profile: synthesize commercial profile from sources
// Request: { tenant_name: string, tenant_website?: string, sources: [{label, source_type, extracted_text}] }
// Response: { narrative, structured, prompt_used }

import { callClaude, json, extractJsonBlock } from './_shared-claude.mjs'

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

  const blob = sources.map((s, i) => {
    return `### Source ${i + 1}: ${s.label} (${s.source_type})\n${s.extracted_text || s.raw_content || '(no content)'}`
  }).join('\n\n---\n\n')

  const prompt = prompt_template
    .replace(/\{\{tenant_name\}\}/g, tenant_name)
    .replace(/\{\{tenant_website\}\}/g, tenant_website || '(not provided)')
    .replace(/\{\{commercial_sources\}\}/g, blob || '(no sources provided)')

  try {
    const { text } = await callClaude(prompt, { maxTokens: 4096 })
    const structured = extractJsonBlock(text)
    // Narrative = everything outside the json block
    const narrative = text.replace(/```json[\s\S]*?```/i, '').trim()

    return json(200, {
      narrative,
      structured,
      raw_text: text,
    })
  } catch (err) {
    return json(500, { error: err.message || 'Synthesis failed' })
  }
}
