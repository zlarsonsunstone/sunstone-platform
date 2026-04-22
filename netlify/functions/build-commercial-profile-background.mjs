// build-commercial-profile-background.mjs
//
// Netlify routes functions with `-background` suffix to the background runtime
// which allows up to 15 minutes of execution time. Returns 202 immediately.
//
// Request: {
//   job_id: uuid,           -- pre-created build_jobs row to update
//   tenant_id: text,
//   tenant_name: text,
//   tenant_website?: text,
//   sources: [{label, source_type, digest_text?, extracted_text?, raw_content?}],
//   prompt_template: text
// }
//
// Writes to build_jobs.result on success, build_jobs.error on failure.
// The frontend polls the build_jobs row.

import { extractJsonBlock } from './_shared-claude.mjs'
import { getSupabaseAdmin } from './_supabase-admin.mjs'

export const handler = async (event) => {
  // Background functions return 202 immediately; actual work happens after.
  // We parse the body here, then do the heavy lifting.
  let payload
  try {
    payload = JSON.parse(event.body || '{}')
  } catch (e) {
    console.error('Invalid JSON body', e)
    return { statusCode: 400 }
  }

  const { job_id, tenant_id, tenant_name, tenant_website, sources = [], prompt_template } = payload

  if (!job_id || !tenant_id || !tenant_name || !prompt_template) {
    console.error('Missing required fields', { job_id, tenant_id, tenant_name })
    return { statusCode: 400 }
  }

  const supabase = getSupabaseAdmin()

  // Mark running
  await supabase
    .from('build_jobs')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', job_id)

  try {
    // Build the prompt
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

    // Call Claude (no timeout constraint — we're in background context)
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

    // Write the commercial_profile row directly (no need for frontend roundtrip)
    await supabase.from('commercial_profile').upsert(
      {
        tenant_id,
        synthesized_text: narrative,
        structured_data: structured,
        source_count: sources.length,
        last_built_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id' }
    )

    // Mark job done
    await supabase
      .from('build_jobs')
      .update({
        status: 'done',
        result: { narrative, structured, source_count: sources.length },
        finished_at: new Date().toISOString(),
      })
      .eq('id', job_id)

    console.log(`Job ${job_id} completed for tenant ${tenant_id}`)
    return { statusCode: 200 }
  } catch (err) {
    const msg = err?.message || String(err)
    console.error(`Job ${job_id} failed:`, msg)
    await supabase
      .from('build_jobs')
      .update({
        status: 'error',
        error: msg,
        finished_at: new Date().toISOString(),
      })
      .eq('id', job_id)
    return { statusCode: 500 }
  }
}
