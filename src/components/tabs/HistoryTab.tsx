import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useStore } from '@/store/useStore'
import { TabPage } from '../TabPage'
import { Card } from '../Card'

interface Session {
  session_id: string
  iteration: number
  status: string
  record_count: number
  file_name: string | null
  created_at: string
  updated_at: string
}

export function HistoryTab() {
  const tenant = useStore((s) => s.activeTenant)
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!tenant) return
    supabase
      .from('enrichment_sessions')
      .select('*')
      .eq('tenant_id', tenant.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setSessions((data as Session[]) || [])
        setLoading(false)
      })
  }, [tenant?.id])

  if (!tenant) return null

  return (
    <TabPage
      eyebrow="Engagement timeline"
      title="History"
      description="Every enrichment run for this tenant, newest first."
    >
      {loading ? (
        <p style={{ color: 'var(--color-text-tertiary)', fontSize: '14px' }}>Loading…</p>
      ) : sessions.length === 0 ? (
        <Card padding="large">
          <p style={{ color: 'var(--color-text-secondary)', fontSize: '15px', textAlign: 'center', padding: '32px 0' }}>
            No sessions recorded yet for {tenant.name}.
          </p>
        </Card>
      ) : (
        <Card padding="large">
          {sessions.map((s) => (
            <div
              key={s.session_id}
              style={{
                padding: '16px 0',
                borderBottom: '0.5px solid var(--color-hairline)',
                display: 'grid',
                gridTemplateColumns: '80px 1fr 120px 100px',
                gap: '16px',
                alignItems: 'center',
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: '11px',
                    fontWeight: 500,
                    letterSpacing: '0.015em',
                    textTransform: 'uppercase',
                    color: 'var(--color-text-tertiary)',
                  }}
                >
                  Turn
                </div>
                <div style={{ fontSize: '28px', fontWeight: 600, fontFamily: 'var(--font-display)', letterSpacing: '-0.015em' }}>
                  {s.iteration}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 500, fontFamily: 'var(--font-mono)', marginBottom: '2px' }}>
                  {s.file_name || 'No file name'}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                  Started {new Date(s.created_at).toLocaleString()}
                  {s.updated_at !== s.created_at && ` · updated ${new Date(s.updated_at).toLocaleString()}`}
                </div>
              </div>
              <div style={{ fontSize: '13px', fontFamily: 'var(--font-mono)', textAlign: 'right' }}>
                {s.record_count.toLocaleString()} records
              </div>
              <StatusPill status={s.status} />
            </div>
          ))}
        </Card>
      )}
    </TabPage>
  )
}

function StatusPill({ status }: { status: string }) {
  const colors: Record<string, { bg: string; fg: string }> = {
    pending: { bg: 'rgba(134, 134, 139, 0.15)', fg: '#6E6E73' },
    active: { bg: 'rgba(212, 146, 10, 0.15)', fg: '#D4920A' },
    complete: { bg: 'rgba(52, 199, 89, 0.15)', fg: '#34C759' },
    paused: { bg: 'rgba(255, 159, 10, 0.15)', fg: '#FF9F0A' },
  }
  const c = colors[status] || colors.pending
  return (
    <span
      style={{
        padding: '4px 10px',
        background: c.bg,
        color: c.fg,
        borderRadius: '6px',
        fontSize: '11px',
        fontWeight: 500,
        textTransform: 'uppercase',
        letterSpacing: '0.015em',
        textAlign: 'center',
      }}
    >
      {status}
    </span>
  )
}
