/**
 * convert-intake.ts
 *
 * Netlify function: converts a public_intake_submission into a strategic_profile.
 *
 * Triggered by admin clicking "Create Prelim CBP" on the AdminSubmissionsPage.
 *
 * What it does (idempotent - safe to re-run):
 *   1. Read the submission
 *   2. Derive tenant_id slug from company_name
 *   3. Create tenant if it doesn't exist (with safe defaults)
 *   4. Create strategic_profile with prelim_status='pending'
 *   5. Create empty federal_profile + commercial_profile stub rows
 *   6. Link the submission back to the new strategic_profile + mark converted_at
 *
 * Returns the new (or existing) strategic_profile_id so the UI can route to it.
 *
 * Idempotency: if the submission was already converted (strategic_profile_id
 * already set on it), the function returns the existing id without creating
 * duplicates. Tenant creation also uses upsert-style logic.
 */
import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
    body: JSON.stringify(body),
  }
}

/**
 * Slugify a company name into a tenant_id.
 *   - lowercase
 *   - non-alphanumerics -> hyphens
 *   - collapse runs of hyphens
 *   - trim leading/trailing hyphens
 *   - max 60 chars
 *   - empty input -> uuid-derived fallback
 */
function slugify(input: string | null | undefined, fallback: string): string {
  if (!input || !input.trim()) {
    return ('prospect-' + fallback.slice(0, 8)).toLowerCase()
  }
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')   // strip accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || ('prospect-' + fallback.slice(0, 8)).toLowerCase()
}

export const handler: Handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' }
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' })
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json(500, { error: 'Server misconfigured: missing Supabase env' })
  }

  let submissionId: string | null = null
  try {
    const body = JSON.parse(event.body || '{}')
    submissionId = body.submission_id || null
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }
  if (!submissionId) {
    return json(400, { error: 'submission_id required' })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  try {
    // --------------------------------------------------------------------
    // 1. Read the submission
    // --------------------------------------------------------------------
    const { data: submission, error: fetchErr } = await supabase
      .schema('v2')
      .from('public_intake_submission')
      .select('*')
      .eq('id', submissionId)
      .single()

    if (fetchErr || !submission) {
      return json(404, { error: 'Submission not found', detail: fetchErr?.message })
    }

    // Idempotency: already converted?
    if (submission.converted_strategic_profile_id) {
      return json(200, {
        ok: true,
        strategic_profile_id: submission.converted_strategic_profile_id,
        tenant_id: null,
        already_converted: true,
      })
    }

    // --------------------------------------------------------------------
    // 2. Derive tenant_id slug
    // --------------------------------------------------------------------
    const tenantId = slugify(submission.company_name, submission.id)

    // --------------------------------------------------------------------
    // 3. Create tenant if it doesn't exist
    // --------------------------------------------------------------------
    const { data: existingTenant, error: tenantSelErr } = await supabase
      .schema('v2')
      .from('tenants')
      .select('id, name')
      .eq('id', tenantId)
      .maybeSingle()

    if (tenantSelErr) {
      return json(500, { error: 'Tenant lookup failed', detail: tenantSelErr.message })
    }

    if (!existingTenant) {
      const tenantInsert = {
        id: tenantId,
        name: submission.company_name || tenantId,
        status: 'active',
        client_color: '#D4920A',
        // DOCTRINE: industry-neutral defaults. Organic, data-validated, never
        // pre-framed. The prelim CBP research will reveal what the prospect
        // actually is - we don't slot them into a hardcoded industry template.
        prompt_variant_enrichment: 'general_enrichment_v1',
        prompt_variant_dna: 'general_dna_v1',
        prompt_variant_gate: 'general_gate_v1',
        value_threshold: 1000000,
        federal_posture: 'unknown',
      }
      const { error: tenantInsErr } = await supabase
        .schema('v2')
        .from('tenants')
        .insert(tenantInsert)

      if (tenantInsErr) {
        return json(500, { error: 'Tenant creation failed', detail: tenantInsErr.message })
      }
    }

    // --------------------------------------------------------------------
    // 4. Create strategic_profile
    // --------------------------------------------------------------------
    // Engagement title is the company name + brief intent marker
    const engagementTitle = submission.company_name
      ? `${submission.company_name} - Federal Strategy`
      : `Engagement ${tenantId}`

    const description = [
      submission.industry_sector ? `Industry: ${submission.industry_sector}` : null,
      submission.headcount ? `Headcount: ${submission.headcount}` : null,
      submission.revenue_range ? `Revenue: ${submission.revenue_range}` : null,
      submission.year_founded ? `Founded: ${submission.year_founded}` : null,
      submission.referred_by ? `Referred by: ${submission.referred_by}` : null,
    ].filter(Boolean).join(' | ') || null

    const strategicProfileInsert = {
      tenant_id: tenantId,
      name: engagementTitle,
      description,
      is_default: true,
      engagement_stage: 'stage_0_initialized',
      client_status: 'prospect',
      engagement_title: engagementTitle,
      prelim_status: 'pending',
    }

    const { data: newSP, error: spErr } = await supabase
      .schema('v2')
      .from('strategic_profiles')
      .insert(strategicProfileInsert)
      .select('id')
      .single()

    if (spErr || !newSP) {
      return json(500, { error: 'Strategic profile creation failed', detail: spErr?.message })
    }
    const strategicProfileId = newSP.id

    // --------------------------------------------------------------------
    // 5. Create empty federal_profile + commercial_profile stub rows
    // --------------------------------------------------------------------
    // Check if they already exist for this tenant (tenant-scoped, not
    // strategic-profile-scoped). If yes, skip; if no, create.

    const { data: existingFederal } = await supabase
      .schema('v2')
      .from('federal_profile')
      .select('id')
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (!existingFederal) {
      const { error: fpErr } = await supabase
        .schema('v2')
        .from('federal_profile')
        .insert({
          tenant_id: tenantId,
          synthesized_text: null,
          structured_data: {},
          source_count: 0,
        })
      if (fpErr) {
        console.warn('federal_profile stub creation failed (non-fatal):', fpErr.message)
      }
    }

    const { data: existingCommercial } = await supabase
      .schema('v2')
      .from('commercial_profile')
      .select('id')
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (!existingCommercial) {
      const { error: cpErr } = await supabase
        .schema('v2')
        .from('commercial_profile')
        .insert({
          tenant_id: tenantId,
          synthesized_text: null,
          structured_data: {},
          source_count: 0,
        })
      if (cpErr) {
        console.warn('commercial_profile stub creation failed (non-fatal):', cpErr.message)
      }
    }

    // --------------------------------------------------------------------
    // 6. Link the submission back to the new strategic_profile
    // --------------------------------------------------------------------
    const { error: linkErr } = await supabase
      .schema('v2')
      .from('public_intake_submission')
      .update({
        converted_strategic_profile_id: strategicProfileId,
        converted_at: new Date().toISOString(),
        status: 'converted_to_profile',
      })
      .eq('id', submissionId)

    if (linkErr) {
      // Conversion succeeded but link failed. Strategic profile still exists.
      // Log and return success with a warning.
      console.error('Submission link-back failed:', linkErr.message)
      return json(200, {
        ok: true,
        strategic_profile_id: strategicProfileId,
        tenant_id: tenantId,
        warning: 'strategic_profile created but link-back to submission failed: ' + linkErr.message,
      })
    }

    return json(200, {
      ok: true,
      strategic_profile_id: strategicProfileId,
      tenant_id: tenantId,
      already_converted: false,
    })

  } catch (e: any) {
    console.error('convert-intake fatal:', e?.message, e?.stack)
    return json(500, { error: 'Unexpected error', detail: e?.message || String(e) })
  }
}
