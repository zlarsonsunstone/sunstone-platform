/**
 * notify-public-intake.ts
 *
 * Netlify function called after PublicIntakeForm submits.
 * Sends a Slack notification with the new submission details.
 *
 * Setup: Create a Slack Incoming Webhook in your workspace (one-time setup
 * at https://api.slack.com/apps) and set the URL as SLACK_WEBHOOK_URL in
 * Netlify project env. Webhook URL itself is the secret — keep it out of git.
 *
 * Accepts EITHER:
 *   { submission_id: "<uuid>" }   — preferred; direct lookup by row id
 *   { email: "<email>" }          — fallback; looks up most recent submission for that email
 *
 * The email fallback is necessary because PublicIntakeForm.tsx (current client)
 * does the insert without a returning SELECT — anon role doesn't have SELECT
 * permission on v2.public_intake_submission (intentional, per public-form RLS).
 * So the client can't pass the id back. Function uses service-role to look it up.
 */
import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL
const PLATFORM_URL = process.env.PLATFORM_URL || 'https://sunstoneplatform.netlify.app'

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' }
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing Supabase config')
    return { statusCode: 500, body: JSON.stringify({ error: 'Server misconfigured' }) }
  }

  let submissionId: string | null = null
  let email: string | null = null
  try {
    const body = JSON.parse(event.body || '{}')
    submissionId = body.submission_id || null
    email = (body.email || '').toString().trim().toLowerCase() || null
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }
  }

  if (!submissionId && !email) {
    return { statusCode: 400, body: JSON.stringify({ error: 'submission_id or email required' }) }
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  // Fetch the submission: prefer submission_id, fall back to most recent for this email.
  // Current PublicIntakeForm.tsx sends only `email`, so the email path is the active one.
  let submission: any = null
  let fetchError: any = null

  if (submissionId) {
    const r = await supabase
      .schema('v2')
      .from('public_intake_submission')
      .select('*')
      .eq('id', submissionId)
      .maybeSingle()
    submission = r.data
    fetchError = r.error
  } else if (email) {
    const r = await supabase
      .schema('v2')
      .from('public_intake_submission')
      .select('*')
      .eq('email', email)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    submission = r.data
    fetchError = r.error
  }

  if (fetchError || !submission) {
    console.error('Failed to fetch submission:', fetchError)
    return { statusCode: 404, body: JSON.stringify({ error: 'Submission not found' }) }
  }

  const reviewUrl = `${PLATFORM_URL}/admin/intake-review/${submission.id}`
  const slackMessage = formatSlackMessage(submission, reviewUrl)

  if (SLACK_WEBHOOK_URL) {
    try {
      const resp = await fetch(SLACK_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: slackMessage }),
      })
      if (!resp.ok) {
        const t = await resp.text()
        console.error('Slack webhook failed:', resp.status, t)
      }
    } catch (e: any) {
      console.error('Slack webhook error:', e?.message)
    }
  } else {
    console.log('NOTIFICATION (no SLACK_WEBHOOK_URL):')
    console.log(slackMessage)
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, submission_id: submission.id }),
  }
}

function formatSlackMessage(s: any, reviewUrl: string): string {
  const lines: string[] = []
  lines.push(`🔔 *New Public Intake Submission*`)
  lines.push('')
  lines.push(`*Name:* ${s.full_name}`)
  lines.push(`*Email:* ${s.email}`)
  if (s.phone) lines.push(`*Phone:* ${s.phone}`)
  if (s.company_name) lines.push(`*Company:* ${s.company_name}`)
  if (s.company_website) lines.push(`*Website:* ${s.company_website}`)
  if (s.industry_sector) lines.push(`*Industry:* ${s.industry_sector}`)
  if (s.referred_by) lines.push(`*Referred by:* ${s.referred_by}`)

  if (s.catalyst) {
    lines.push('')
    lines.push(`*Catalyst:*`)
    lines.push(`> ${String(s.catalyst).replace(/\n/g, '\n> ')}`)
  }

  const commercial: string[] = []
  if (s.year_founded) commercial.push(`Founded ${s.year_founded}`)
  if (s.headcount) commercial.push(`Headcount ${s.headcount}`)
  if (s.revenue_range) commercial.push(`Revenue ${s.revenue_range}`)
  if (s.geographic_footprint && s.geographic_footprint.length > 0) {
    commercial.push(`Footprint ${s.geographic_footprint.join(', ')}`)
  }
  if (commercial.length > 0) {
    lines.push('')
    lines.push(`*Commercial:* ${commercial.join(' · ')}`)
  }

  if (s.linkedin_url) lines.push(`*LinkedIn:* ${s.linkedin_url}`)

  if (s.capabilities) {
    lines.push('')
    lines.push(`*Capabilities:*`)
    lines.push(`> ${String(s.capabilities).replace(/\n/g, '\n> ')}`)
  }
  if (s.customers) {
    lines.push('')
    lines.push(`*Top customers:*`)
    lines.push(`> ${String(s.customers).replace(/\n/g, '\n> ')}`)
  }
  if (s.differentiator) {
    lines.push('')
    lines.push(`*Differentiator:*`)
    lines.push(`> ${String(s.differentiator).replace(/\n/g, '\n> ')}`)
  }

  lines.push('')
  lines.push(`*Federal path:* ${s.federal_path || '(not set)'}`)
  if (s.federal_answers && Object.keys(s.federal_answers).length > 0) {
    Object.entries(s.federal_answers).forEach(([k, v]) => {
      const formatted = Array.isArray(v) ? v.join(', ') : String(v)
      lines.push(`  • ${k}: ${formatted}`)
    })
  }

  lines.push('')
  lines.push(`<${reviewUrl}|Review submission →>`)
  lines.push(`_Submitted ${new Date(s.submitted_at).toLocaleString()}_`)

  return lines.join('\n')
}
