// create-prospect: server-side prospect onboarding
// Creates: tenant + auth.user + v2.users + prospect_context + stage_content seed rows
// Returns: { tenant_id, user_id, temp_password, login_url, errors[] }
//
// Request body:
// {
//   tenant: {
//     name: "Wicked Bionic",
//     display_name: "Wicked Bionic, LLC",
//     client_color: "#7C2D6F",
//     intake_metadata: {
//       industry, revenue_band, headcount, uei, cage, year_founded, hq_city,
//       certifications: [], self_stated_capabilities, referral_source,
//       catalyst_quote, intake_mode
//     }
//   },
//   primary_contact: {
//     full_name: "Dana C. Arnett",
//     email: "dana@wickedbionic.com"
//   },
//   created_by: "admin|public",
//   send_email: false   // whether to send login email via Resend (not implemented yet)
// }

import { createClient } from '@supabase/supabase-js'
import { json } from './_shared-claude.mjs'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'tenant-' + Date.now().toString(36)
}

function genPassword() {
  // Memorable password: AdjectiveNounNumber (e.g. SilverCrane7421)
  const adj = ['Silver','Iron','Solar','River','Stone','Vivid','Lyric','Cobalt','Amber','Cedar','Quartz','Granite']
  const noun = ['Crane','Falcon','Compass','Beacon','Anchor','Lantern','Harbor','Saber','Forge','Summit','Vector','Hawk']
  const num = String(1000 + Math.floor(Math.random() * 9000))
  return adj[Math.floor(Math.random()*adj.length)] + noun[Math.floor(Math.random()*noun.length)] + num
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })
  if (!SERVICE_KEY || !SUPABASE_URL) return json(500, { error: 'Server not configured' })

  let body
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return json(400, { error: 'Invalid JSON' })
  }

  const { tenant: tin, primary_contact: pc, created_by = 'admin' } = body
  if (!tin?.name) return json(400, { error: 'tenant.name required' })
  if (!pc?.email) return json(400, { error: 'primary_contact.email required' })
  if (!pc?.full_name) return json(400, { error: 'primary_contact.full_name required' })

  // Service-role client (bypasses RLS for provisioning operations)
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Build the tenant slug
  let tenantId = slugify(tin.name)
  // Avoid collision with existing tenant slugs
  try {
    const { data: existing } = await admin
      .schema('v2')
      .from('tenants')
      .select('id')
      .eq('id', tenantId)
      .maybeSingle()
    if (existing) {
      tenantId = tenantId + '-' + Date.now().toString(36).slice(-4)
    }
  } catch {}

  const tempPassword = genPassword()
  const errors = []

  // 1. Insert tenant
  const intake = tin.intake_metadata || {}
  intake.primary_contact_name = pc.full_name
  intake.primary_contact_email = pc.email

  try {
    const { error: tErr } = await admin
      .schema('v2')
      .from('tenants')
      .insert({
        id: tenantId,
        name: tin.display_name || tin.name,
        status: 'active',
        client_color: tin.client_color || '#C5933A',
        intake_metadata: intake,
      })
    if (tErr) throw tErr
  } catch (e) {
    return json(500, { error: 'Tenant creation failed: ' + e.message })
  }

  // 2. Create auth user
  let authUserId = null
  try {
    const { data: au, error: aErr } = await admin.auth.admin.createUser({
      email: pc.email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { full_name: pc.full_name },
    })
    if (aErr) throw aErr
    authUserId = au.user.id
  } catch (e) {
    // Roll back tenant insert
    await admin.schema('v2').from('tenants').delete().eq('id', tenantId)
    return json(500, { error: 'Auth user creation failed: ' + e.message })
  }

  // 3. Insert v2.users row linked to auth user
  try {
    const { error: uErr } = await admin
      .schema('v2')
      .from('users')
      .insert({
        id: authUserId,
        email: pc.email,
        full_name: pc.full_name,
        role: 'user',
        home_tenant_id: tenantId,
        engagement_state: 'prospect',
      })
    if (uErr) throw uErr
  } catch (e) {
    errors.push('v2.users link failed: ' + e.message)
  }

  // 4. Seed prospect_context (minimal - rest will be filled by intake job)
  try {
    const { error: pErr } = await admin
      .schema('v2')
      .from('prospect_context')
      .insert({
        tenant_id: tenantId,
        primary_contact_name: pc.full_name,
        primary_contact_email: pc.email,
        referral_source: intake.referral_source || null,
        catalyst_quote: intake.catalyst_quote || null,
        intake_mode: intake.intake_mode || null,
        self_stated_capabilities: intake.self_stated_capabilities || null,
        active_stage: 1,
      })
    if (pErr && !String(pErr.message || '').toLowerCase().includes('duplicate')) throw pErr
  } catch (e) {
    errors.push('prospect_context seed failed: ' + e.message)
  }

  // 5. Seed stage_content rows for all 12 stages
  try {
    const rows = []
    for (let n = 1; n <= 12; n++) rows.push({ tenant_id: tenantId, stage_num: n })
    const { error: scErr } = await admin
      .schema('v2')
      .from('stage_content')
      .insert(rows)
    if (scErr && !String(scErr.message || '').toLowerCase().includes('duplicate')) throw scErr
  } catch (e) {
    errors.push('stage_content seed failed: ' + e.message)
  }

  // 6. Copy Stage 6 walkthrough video from default tenant (wicked-bionic-llc) if available
  try {
    const { data: wb } = await admin
      .schema('v2')
      .from('stage_content')
      .select('walkthrough_video_url, walkthrough_video_title, tips_title, tips_content')
      .eq('tenant_id', 'wicked-bionic-llc')
      .eq('stage_num', 6)
      .maybeSingle()
    if (wb && wb.walkthrough_video_url) {
      await admin
        .schema('v2')
        .from('stage_content')
        .update({
          walkthrough_video_url: wb.walkthrough_video_url,
          walkthrough_video_title: wb.walkthrough_video_title,
          tips_title: wb.tips_title,
          tips_content: wb.tips_content,
        })
        .eq('tenant_id', tenantId)
        .eq('stage_num', 6)
    }
  } catch (e) {
    errors.push('stage 6 default copy failed: ' + e.message)
  }

  return json(200, {
    tenant_id: tenantId,
    user_id: authUserId,
    email: pc.email,
    temp_password: tempPassword,
    login_url: 'https://sunstoneintel.com',
    created_by,
    errors,
  })
}
