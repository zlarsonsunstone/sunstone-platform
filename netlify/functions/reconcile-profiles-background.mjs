// reconcile-profiles-background.mjs
// Handles reconcile and framework modes.

import { extractJsonBlock } from './_shared-claude.mjs'
import { dbUpdate, dbInsert } from './_supabase-admin.mjs'

export const handler = async (event) => {
  let payload
  try {
    payload = JSON.parse(event.body || '{}')
  } catch {
    return { statusCode: 400 }
  }

  const {
    job_id,
    tenant_id,
    tenant_name,
    mode,
    commercial_profile_text,
    federal_profile_text,
    prompt_template,
    previous_version,
  } = payload

  if (!job_id || !tenant_id || !tenant_name || !prompt_template || !mode) {
    return { statusCode: 400 }
  }

  try {
    await dbUpdate('build_jobs', 'id', job_id, {
      status: 'running',
      started_at: new Date().toISOString(),
    })

    const prompt = prompt_template
      .replace(/\{\{tenant_name\}\}/g, tenant_name)
      .replace(/\{\{commercial_profile\}\}/g, commercial_profile_text || '(no commercial profile built yet)')
      .replace(
        /\{\{federal_profile\}\}/g,
        federal_profile_text || '(no federal profile built yet — company may not be federally registered)'
      )

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
        model: 'claude-sonnet-4-5',
        max_tokens: 8000,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '')
      throw new Error(`Anthropic ${resp.status}: ${errText.slice(0, 500) || 'no body'}`)
    }

    const data = await resp.json()
    const text = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')

    const structured = extractJsonBlock(text)
    const cleaned = text.replace(/```json[\s\S]*?```/i, '').trim()
    const sections = splitSections(cleaned)

    const isFramework = mode === 'framework'
    const nextVersion = (previous_version || 0) + 1

    await dbInsert('reconciliation', {
      tenant_id,
      mode: isFramework ? 'framework' : 'reconcile',
      alignment: isFramework ? null : sections.alignment || null,
      divergence: isFramework ? null : sections.divergence || null,
      suggestions: isFramework ? cleaned : sections.suggestions || null,
      structured_data: structured,
      version: nextVersion,
      last_built_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })

    await dbUpdate('build_jobs', 'id', job_id, {
      status: 'done',
      result: { ...sections, narrative: cleaned, structured, mode, version: nextVersion },
      finished_at: new Date().toISOString(),
    })

    return { statusCode: 200 }
  } catch (err) {
    const msg = err?.message || String(err)
    console.error(`Job ${job_id} failed:`, msg)
    try {
      await dbUpdate('build_jobs', 'id', job_id, {
        status: 'error',
        error: msg,
        finished_at: new Date().toISOString(),
      })
    } catch {}
    return { statusCode: 500 }
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
