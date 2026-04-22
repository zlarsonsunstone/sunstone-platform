// build-commercial-profile-background.mjs
// Netlify Background Function — up to 15 minutes execution, returns 202 immediately.

import { extractJsonBlock } from './_shared-claude.mjs'
import { dbUpdate, dbUpsert } from './_supabase-admin.mjs'

export const handler = async (event) => {
  console.log('=== build-commercial-profile-background START ===')
  console.log('body length:', event.body?.length)
  let payload
  try {
    payload = JSON.parse(event.body || '{}')
  } catch (e) {
    console.error('Invalid JSON body', e)
    return { statusCode: 400 }
  }

  const { job_id, tenant_id, tenant_name, tenant_website, sources = [], prompt_template } = payload

  if (!job_id || !tenant_id || !tenant_name || !prompt_template) {
    console.error('Missing required fields')
    return { statusCode: 400 }
  }

  try {
    await dbUpdate('build_jobs', 'id', job_id, {
      status: 'running',
      started_at: new Date().toISOString(),
    })

    const textBlob = sources
      .map((s, i) => {
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
        max_tokens: 8192,
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
    const narrative = text.replace(/```json[\s\S]*?```/i, '').trim()

    await dbUpsert(
      'commercial_profile',
      {
        tenant_id,
        synthesized_text: narrative,
        structured_data: structured,
        source_count: sources.length,
        last_built_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      'tenant_id'
    )

    await dbUpdate('build_jobs', 'id', job_id, {
      status: 'done',
      result: { narrative, structured, source_count: sources.length },
      finished_at: new Date().toISOString(),
    })

    console.log(`Job ${job_id} done`)
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
    } catch (e) {
      console.error('Failed to record error state:', e?.message)
    }
    return { statusCode: 500 }
  }
}
