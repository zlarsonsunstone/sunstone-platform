import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface AuditRow {
  id: string
  actor_user_id: string | null
  action: string
  target_type: string | null
  target_id: string | null
  tenant_context: string | null
  metadata: any
  created_at: string
}

export function AdminAuditLog() {
  const [rows, setRows] = useState<AuditRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)
      .then(({ data }) => {
        setRows((data as AuditRow[]) || [])
        setLoading(false)
      })
  }, [])

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <h3
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: '20px',
            fontWeight: 600,
            letterSpacing: '-0.008em',
            margin: 0,
          }}
        >
          Audit log
        </h3>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: '14px', margin: '4px 0 0 0' }}>
          Append-only record of security-relevant actions. Most recent 100 shown.
        </p>
      </div>

      {loading && <p style={{ color: 'var(--color-text-tertiary)', fontSize: '14px' }}>Loading…</p>}

      {!loading && rows.length === 0 && (
        <p style={{ color: 'var(--color-text-tertiary)', fontSize: '14px', padding: '32px 0', textAlign: 'center' }}>
          No audit entries yet.
        </p>
      )}

      {!loading && rows.length > 0 && (
        <div>
          {rows.map((r) => (
            <div
              key={r.id}
              style={{
                padding: '12px 0',
                borderBottom: '0.5px solid var(--color-hairline)',
                display: 'grid',
                gridTemplateColumns: '180px 120px 1fr',
                gap: '16px',
                alignItems: 'center',
              }}
            >
              <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                {new Date(r.created_at).toLocaleString()}
              </div>
              <div style={{ fontSize: '13px', fontWeight: 500 }}>{r.action}</div>
              <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                {r.target_type && (
                  <>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>
                      {r.target_type}:{r.target_id}
                    </span>
                    {r.tenant_context && ` · ${r.tenant_context}`}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
