// Zero-dependency Supabase REST client for Netlify background functions.
// Uses PostgREST over plain fetch — avoids bundling @supabase/supabase-js
// which has been unreliable in Netlify's function bundler.
//
// Schema: v2 (set via Accept-Profile / Content-Profile headers)

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

function assertConfig() {
  if (!url) throw new Error('SUPABASE_URL or VITE_SUPABASE_URL not configured')
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured')
}

function baseHeaders(extra = {}) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    'Accept-Profile': 'v2',
    'Content-Profile': 'v2',
    ...extra,
  }
}

// UPDATE table SET patch WHERE eq_col = eq_val
export async function dbUpdate(table, eqCol, eqVal, patch) {
  assertConfig()
  const endpoint = `${url}/rest/v1/${table}?${encodeURIComponent(eqCol)}=eq.${encodeURIComponent(eqVal)}`
  const resp = await fetch(endpoint, {
    method: 'PATCH',
    headers: baseHeaders({ Prefer: 'return=minimal' }),
    body: JSON.stringify(patch),
  })
  if (!resp.ok) {
    const t = await resp.text().catch(() => '')
    throw new Error(`DB update ${table} failed: ${resp.status} ${t.slice(0, 300)}`)
  }
}

// UPSERT into table on conflict column
export async function dbUpsert(table, row, onConflict) {
  assertConfig()
  const endpoint = `${url}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: baseHeaders({
      Prefer: 'resolution=merge-duplicates,return=minimal',
    }),
    body: JSON.stringify(row),
  })
  if (!resp.ok) {
    const t = await resp.text().catch(() => '')
    throw new Error(`DB upsert ${table} failed: ${resp.status} ${t.slice(0, 300)}`)
  }
}

// INSERT a new row
export async function dbInsert(table, row) {
  assertConfig()
  const endpoint = `${url}/rest/v1/${table}`
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: baseHeaders({ Prefer: 'return=minimal' }),
    body: JSON.stringify(row),
  })
  if (!resp.ok) {
    const t = await resp.text().catch(() => '')
    throw new Error(`DB insert ${table} failed: ${resp.status} ${t.slice(0, 300)}`)
  }
}
