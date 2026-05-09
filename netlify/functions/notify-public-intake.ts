/**
 * notify-public-intake.ts
 *
 * Netlify function called after PublicIntakeForm submits.
 * Sends email to Zack with link to review the new submission.
 *
 * No secrets needed in client. Function has access to SUPABASE_SERVICE_ROLE_KEY
 * via Netlify env to read the just-submitted row and format the email.
 *
 * Email is sent via Resend (or whatever SMTP provider is configured).
 * For v1, we'll use a simple webhook to a notification service or just log to
 * the methodology table for Zack to see in the platform.
 */
import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'zack@sunstoneadvisory.co'
const RESEND_API_KEY = process.env.RESEND_API_KEY
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
  try {
    const body = JSON.parse(event.body || '{}')
    submissionId = body.submission_id || null
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }
  }

  if (!submissionId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'submission_id required' }) }
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  // Fetch the submission
  const { data: submission, error: fetchError } = await supabase
    .schema('v2')
    .from('public_intake_submission')
    .select('*')
    .eq('id', submissionId)
    .single()

  if (fetchError || !submission) {
    console.error('Failed to fetch submission:', fetchError)
    return { statusCode: 404, body: JSON.stringify({ error: 'Submission not found' }) }
  }

  // Format the email body
  const reviewUrl = `${PLATFORM_URL}/admin/intake-review/${submission.id}`
  const emailSubject = `New Sunstone intake: ${submission.full_name} (${submission.company_name || 'no company'})`
  const emailBody = formatNotificationEmail(submission, reviewUrl)

  // Send via Resend if configured, else log to console
  if (RESEND_API_KEY) {
    try {
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Sunstone Intake <intake@sunstoneadvisory.co>',
          to: [NOTIFY_EMAIL],
          subject: emailSubject,
          text: emailBody,
        }),
      })
      if (!resp.ok) {
        const t = await resp.text()
        console.error('Resend failed:', resp.status, t)
      }
    } catch (e: any) {
      console.error('Resend error:', e?.message)
    }
  } else {
    console.log('NOTIFICATION (no RESEND_API_KEY):')
    console.log(`To: ${NOTIFY_EMAIL}`)
    console.log(`Subject: ${emailSubject}`)
    console.log(emailBody)
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, submission_id: submissionId }),
  }
}

function formatNotificationEmail(s: any, reviewUrl: string): string {
  const lines: string[] = []
  lines.push('NEW PUBLIC INTAKE SUBMISSION')
  lines.push('='.repeat(40))
  lines.push('')
  lines.push(`Name:    ${s.full_name}`)
  lines.push(`Email:   ${s.email}`)
  if (s.phone) lines.push(`Phone:   ${s.phone}`)
  if (s.company_name) lines.push(`Company: ${s.company_name}`)
  if (s.company_website) lines.push(`Website: ${s.company_website}`)
  lines.push('')

  if (s.industry_sector) lines.push(`Industry sector:  ${s.industry_sector}`)
  if (s.referred_by) lines.push(`Referred by:      ${s.referred_by}`)
  lines.push('')

  if (s.catalyst) {
    lines.push('CATALYST:')
    lines.push(s.catalyst)
    lines.push('')
  }

  lines.push('--- COMMERCIAL ---')
  if (s.year_founded) lines.push(`Founded:   ${s.year_founded}`)
  if (s.headcount) lines.push(`Headcount: ${s.headcount}`)
  if (s.revenue_range) lines.push(`Revenue:   ${s.revenue_range}`)
  if (s.geographic_footprint && s.geographic_footprint.length > 0) {
    lines.push(`Footprint: ${s.geographic_footprint.join(', ')}`)
  }
  if (s.linkedin_url) lines.push(`LinkedIn:  ${s.linkedin_url}`)
  if (s.capabilities) {
    lines.push('')
    lines.push('Capabilities:')
    lines.push(s.capabilities)
  }
  if (s.customers) {
    lines.push('')
    lines.push('Top customers:')
    lines.push(s.customers)
  }
  if (s.differentiator) {
    lines.push('')
    lines.push('Differentiator:')
    lines.push(s.differentiator)
  }
  lines.push('')

  lines.push('--- FEDERAL POSTURE ---')
  lines.push(`Path: ${s.federal_path || '(not set)'}`)
  if (s.federal_answers) {
    Object.entries(s.federal_answers).forEach(([k, v]) => {
      const formatted = Array.isArray(v) ? v.join(', ') : String(v)
      lines.push(`  ${k}: ${formatted}`)
    })
  }
  lines.push('')

  lines.push('--- ACTION ---')
  lines.push(`Review at: ${reviewUrl}`)
  lines.push('')
  lines.push(`Submitted ${new Date(s.submitted_at).toLocaleString()}`)

  return lines.join('\n')
}
