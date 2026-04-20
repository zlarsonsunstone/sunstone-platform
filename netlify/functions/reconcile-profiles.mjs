// reconcile-profiles: compare commercial vs federal, produce alignment/divergence/suggestions
// Request: { tenant_name, commercial_profile_text, federal_profile_text, prompt_template }
// Response: { alignment, divergence, suggestions, structured, raw_text }

import { callClaude, json, extractJsonBlock } from './_shared-claude.mjs'

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })

  let payload
  try {
    payload = JSON.parse(event.body || '{}')
  } catch {
    return json(400, { error: 'Invalid JSON' })
  }

  const { tenant_name, commercial_profile_text, federal_profile_text, prompt_template } = payload
  if (!tenant_name) return json(400, { error: 'tenant_name required' })
  if (!prompt_template) return json(400, { error: 'prompt_template required' })

  const prompt = prompt_template
    .replace(/\{\{tenant_name\}\}/g, tenant_name)
    .replace(/\{\{commercial_profile\}\}/g, commercial_profile_text || '(no commercial profile built yet)')
    .replace(/\{\{federal_profile\}\}/g, federal_profile_text || '(no federal profile built yet — company may not be federally registered)')

  try {
    const { text } = await callClaude(prompt, { maxTokens: 8000 })
    const structured = extractJsonBlock(text)
    const cleaned = text.replace(/```json[\s\S]*?```/i, '').trim()

    // Parse sections by header
    const sections = splitSections(cleaned)

    // For framework mode, the standard reconcile sections won't all match,
    // so the full cleaned narrative is also returned for the UI to display.
    return json(200, {
      alignment: sections.alignment || '',
      divergence: sections.divergence || '',
      suggestions: sections.suggestions || '',
      narrative: cleaned,
      structured,
      raw_text: text,
    })
  } catch (err) {
    return json(500, { error: err.message || 'Reconciliation failed' })
  }
}

function splitSections(text) {
  const out = { alignment: '', divergence: '', suggestions: '' }
  const lines = text.split('\n')
  let current = null
  for (const line of lines) {
    const lower = line.toLowerCase().trim()
    if (/^#+\s*alignment/.test(lower)) { current = 'alignment'; continue }
    if (/^#+\s*divergence/.test(lower)) { current = 'divergence'; continue }
    if (/^#+\s*suggestions?/.test(lower)) { current = 'suggestions'; continue }
    if (current) out[current] += line + '\n'
  }
  out.alignment = out.alignment.trim()
  out.divergence = out.divergence.trim()
  out.suggestions = out.suggestions.trim()
  return out
}
