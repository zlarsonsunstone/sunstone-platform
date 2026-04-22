// build-federal-profile-background.mjs
// Same pattern as commercial — background function, writes result to build_jobs + federal_profile.

import { extractJsonBlock } from './_shared-claude.mjs'
import { getSupabaseAdmin } from './_supabase-admin.mjs'

export const handler = async (event) => {
  let payload
  try {
    payload = JSON.parse(event.body || '{}')
  } catch {
    return { statusCode: 400 }
  }

  const { job_id, tenant_id, tenant_name, sources = [], prompt_template } = payload
  if (!job_id || !tenant_id || !tenant_name || !prompt_template) {
    return { statusCode: 400 }
  }

  const supabase = getSupabaseAdmin()

  await supabase
    .from('build_jobs')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', job_id)

  try {
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
      .replace(/\{\{federal_sources\}\}/g, textBlob || '(no federal sources provided)')

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
    const s = structured || {}

    await supabase.from('federal_profile').upsert(
      {
        tenant_id,
        synthesized_text: narrative,
        structured_data: structured,
        naics_codes: s.naics_codes || null,
        certifications: s.certifications || null,
        psc_codes: s.psc_codes || null,
        uei: s.uei || null,
        cage: s.cage || null,
        source_count: sources.length,
        last_built_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id' }
    )

    await supabase
      .from('build_jobs')
      .update({
        status: 'done',
        result: { narrative, structured, source_count: sources.length },
        finished_at: new Date().toISOString(),
      })
      .eq('id', job_id)

    return { statusCode: 200 }
  } catch (err) {
    const msg = err?.message || String(err)
    console.error(`Job ${job_id} failed:`, msg)
    await supabase
      .from('build_jobs')
      .update({ status: 'error', error: msg, finished_at: new Date().toISOString() })
      .eq('id', job_id)
    return { statusCode: 500 }
  }
}
