// Shared Supabase admin client for Netlify Functions
// Uses SUPABASE_SERVICE_ROLE_KEY which bypasses RLS — only safe server-side.

import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

export function getSupabaseAdmin() {
  if (!url) throw new Error('SUPABASE_URL or VITE_SUPABASE_URL not configured')
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured')
  return createClient(url, serviceKey, {
    db: { schema: 'v2' },
    auth: { persistSession: false },
  })
}
