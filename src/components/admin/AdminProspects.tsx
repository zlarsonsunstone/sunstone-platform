import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { CreateProspectWizard } from './CreateProspectWizard'

interface ProspectRow {
  tenant_id: string
  tenant_name: string
  client_color: string
  primary_contact_name: string | null
  primary_contact_email: string | null
  active_stage: number
  discovery_awards_count: number | null
  created_at: string
  user_id: string | null
  user_email: string | null
}

export function AdminProspects() {
  const [rows, setRows] = useState<ProspectRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [latestCreated, setLatestCreated] = useState<{ email: string; password: string } | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      // Join tenants + prospect_context + first user
      const { data: tenants } = await supabase.from('tenants').select('id, name, client_color, created_at')
      const { data: contexts } = await supabase.from('prospect_context').select('*')
      const { data: users } = await supabase.from('users').select('id, email, home_tenant_id, engagement_state').eq('engagement_state', 'prospect')

      const ctxByTenant = new Map((contexts || []).map((c: any) => [c.tenant_id, c]))
      const userByTenant = new Map((users || []).map((u: any) => [u.home_tenant_id, u]))

      const merged: ProspectRow[] = (tenants || [])
        .filter((t: any) => ctxByTenant.has(t.id))   // only tenants that have prospect context (i.e. prospects, not full clients)
        .map((t: any) => {
          const c = ctxByTenant.get(t.id) as any
          const u = userByTenant.get(t.id) as any
          return {
            tenant_id: t.id,
            tenant_name: t.name,
            client_color: t.client_color,
            primary_contact_name: c.primary_contact_name || null,
            primary_contact_email: c.primary_contact_email || null,
            active_stage: c.active_stage || 1,
            discovery_awards_count: c.discovery_awards_count || null,
            created_at: t.created_at,
            user_id: u?.id || null,
            user_email: u?.email || null,
          }
        })
        .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))

      setRows(merged)
    } catch (e: any) {
      setError(e?.message || 'Failed to load prospects')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Prospects</h2>
          <p style={{ margin: '4px 0 0 0', fontSize: 12, color: '#666' }}>
            Companies currently in the Sunstone reconnaissance flow.
          </p>
        </div>
        <button onClick={() => setWizardOpen(true)} style={{ background: '#1F3A52', color: 'white', border: 'none', borderRadius: 6, padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          + Add new prospect
        </button>
      </div>

      {latestCreated && (
        <div style={{ background: '#FEF3C7', border: '1px solid #F6CE6A', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 13 }}>
          <strong>New prospect created.</strong> Login: {latestCreated.email} · Temporary password: <span style={{ fontFamily: 'monospace', background: 'white', padding: '2px 6px', borderRadius: 4 }}>{latestCreated.password}</span>
          <button onClick={() => setLatestCreated(null)} style={{ marginLeft: 12, background: 'transparent', border: 'none', cursor: 'pointer', color: '#666' }}>dismiss</button>
        </div>
      )}

      {error && <div style={{ background: '#FEEBEB', padding: 10, borderRadius: 6, marginBottom: 12, color: '#7A1F2A', fontSize: 13 }}>{error}</div>}

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#888', fontSize: 13 }}>Loading prospects...</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#888', fontSize: 13, border: '1px dashed #ddd', borderRadius: 8 }}>
          No prospects yet. Click "Add new prospect" to create one.
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #eee', textAlign: 'left' }}>
              <th style={th}>Company</th>
              <th style={th}>Primary contact</th>
              <th style={th}>Stage</th>
              <th style={th}>Awards</th>
              <th style={th}>Created</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.tenant_id} style={{ borderBottom: '1px solid #f5f5f5' }}>
                <td style={td}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: r.client_color, flexShrink: 0 }} />
                    <div>
                      <div style={{ fontWeight: 600 }}>{r.tenant_name}</div>
                      <div style={{ fontSize: 11, color: '#888', fontFamily: 'monospace' }}>{r.tenant_id}</div>
                    </div>
                  </div>
                </td>
                <td style={td}>
                  {r.primary_contact_name || '—'}
                  {r.primary_contact_email && <div style={{ fontSize: 11, color: '#888' }}>{r.primary_contact_email}</div>}
                </td>
                <td style={td}><Badge>Stage {r.active_stage}</Badge></td>
                <td style={td}>{r.discovery_awards_count ?? '—'}</td>
                <td style={td}><span style={{ fontSize: 11, color: '#888' }}>{new Date(r.created_at).toLocaleDateString()}</span></td>
                <td style={td}>
                  <a href={`/stages?tenant=${r.tenant_id}`} style={{ fontSize: 12, color: '#1F3A52', textDecoration: 'none' }}>View →</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {wizardOpen && (
        <CreateProspectWizard
          onClose={() => setWizardOpen(false)}
          onCreated={(r) => {
            setLatestCreated({ email: r.email, password: r.temp_password })
            setWizardOpen(false)
            load()
          }}
        />
      )}
    </div>
  )
}

const th: React.CSSProperties = { padding: '8px 12px', fontWeight: 600, color: '#666', fontSize: 11, letterSpacing: '0.04em', textTransform: 'uppercase' }
const td: React.CSSProperties = { padding: '10px 12px', verticalAlign: 'top' }

function Badge({ children }: { children: React.ReactNode }) {
  return <span style={{ background: '#F0EBE0', color: '#8C7233', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600 }}>{children}</span>
}
