// fetch-highergov: lookup company in HigherGov by UEI or name
// Returns entity profile + recent awards
// Request: { uei?: string, company_name?: string }
// Response: { entity, awards, opportunities, raw }

import { json } from './_shared-claude.mjs'

const HG_BASE = 'https://www.highergov.com/api-external'

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })

  const apiKey = process.env.HIGHERGOV_API_KEY
  if (!apiKey) return json(500, { error: 'HIGHERGOV_API_KEY not configured' })

  let payload
  try {
    payload = JSON.parse(event.body || '{}')
  } catch {
    return json(400, { error: 'Invalid JSON' })
  }

  const { uei, company_name } = payload
  if (!uei && !company_name) return json(400, { error: 'uei or company_name required' })

  try {
    const results = {
      entity: null,
      awards: [],
      opportunities: [],
      errors: [],
    }

    // Awards lookup - we search awards and derive entity info from them
    try {
      const awardsParams = new URLSearchParams({ api_key: apiKey, page_size: '50' })
      if (uei) awardsParams.set('awardee_uei', uei)
      else if (company_name) awardsParams.set('awardee_name', company_name)

      const awardsResp = await fetch(`${HG_BASE}/contract/?${awardsParams}`, {
        signal: AbortSignal.timeout(30000),
      })
      if (awardsResp.ok) {
        const awardsData = await awardsResp.json()
        results.awards = (awardsData.results || []).slice(0, 50)
      } else {
        results.errors.push(`awards: ${awardsResp.status}`)
      }
    } catch (e) {
      results.errors.push(`awards: ${e.message}`)
    }

    // Opportunity lookup for context
    try {
      const oppParams = new URLSearchParams({ api_key: apiKey, page_size: '10' })
      if (company_name) oppParams.set('awardee_name', company_name)
      else if (uei) oppParams.set('awardee_uei', uei)

      const oppResp = await fetch(`${HG_BASE}/opportunity/?${oppParams}`, {
        signal: AbortSignal.timeout(30000),
      })
      if (oppResp.ok) {
        const oppData = await oppResp.json()
        results.opportunities = (oppData.results || []).slice(0, 10)
      } else {
        results.errors.push(`opportunities: ${oppResp.status}`)
      }
    } catch (e) {
      results.errors.push(`opportunities: ${e.message}`)
    }

    // Synthesize an entity profile from award metadata
    if (results.awards.length > 0) {
      const first = results.awards[0]
      results.entity = {
        uei: first.awardee_uei || uei || null,
        name: first.awardee_name || company_name || null,
        cage: first.cage_code || null,
        naics_set: dedupe(results.awards.map(a => a.naics_code).filter(Boolean)),
        psc_set: dedupe(results.awards.map(a => a.product_or_service_code).filter(Boolean)),
        agencies: dedupe(results.awards.map(a => a.agency_name).filter(Boolean)).slice(0, 20),
        total_awards: results.awards.length,
      }
    }

    // Render a summary text blob for Claude consumption
    const summary = renderSummary(results)

    return json(200, {
      ...results,
      summary,
    })
  } catch (err) {
    return json(500, { error: err.message || 'HigherGov fetch failed' })
  }
}

function dedupe(arr) {
  return Array.from(new Set(arr))
}

function renderSummary(r) {
  const lines = []
  lines.push('# HigherGov federal data pull')
  if (r.entity) {
    lines.push(`\n## Entity`)
    lines.push(`- Name: ${r.entity.name || 'N/A'}`)
    lines.push(`- UEI: ${r.entity.uei || 'N/A'}`)
    lines.push(`- CAGE: ${r.entity.cage || 'N/A'}`)
    lines.push(`- NAICS seen: ${r.entity.naics_set.join(', ') || 'none'}`)
    lines.push(`- PSC seen: ${r.entity.psc_set.join(', ') || 'none'}`)
    lines.push(`- Agencies: ${r.entity.agencies.join(', ') || 'none'}`)
    lines.push(`- Award count: ${r.entity.total_awards}`)
  } else {
    lines.push(`\n(No entity data — no award history matched)`)
  }

  if (r.awards.length > 0) {
    lines.push(`\n## Recent awards (top 20 of ${r.awards.length})`)
    r.awards.slice(0, 20).forEach((a, i) => {
      lines.push(`${i + 1}. ${a.award_id || a.id || ''} | ${a.agency_name || ''} | ${a.naics_code || ''} | $${(a.current_total_value || a.award_amount || 0).toLocaleString()} | ${a.award_date || a.period_of_performance_start || ''}`)
      if (a.description) lines.push(`   Desc: ${String(a.description).slice(0, 200)}`)
    })
  }

  if (r.opportunities.length > 0) {
    lines.push(`\n## Opportunities (pursuits in progress or recent)`)
    r.opportunities.forEach((o, i) => {
      lines.push(`${i + 1}. ${o.title || ''} | ${o.agency_name || ''} | ${o.posted_date || ''}`)
    })
  }

  if (r.errors.length > 0) {
    lines.push(`\n## Errors during fetch`)
    r.errors.forEach(e => lines.push(`- ${e}`))
  }

  return lines.join('\n')
}
