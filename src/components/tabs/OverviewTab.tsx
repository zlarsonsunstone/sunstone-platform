import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useStore } from '@/store/useStore'
import { TabPage } from '../TabPage'
import { Card } from '../Card'

interface SessionRow {
  session_id: string
  tenant_id: string
  iteration: number
  status: string
  record_count: number
  created_at: string
  file_name: string | null
}

export function OverviewTab() {
  const tenant = useStore((s) => s.activeTenant)
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [totalRecords, setTotalRecords] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!tenant) return
    Promise.all([
      supabase
        .from('enrichment_sessions')
        .select('*')
        .eq('tenant_id', tenant.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false }),
      supabase
        .from('enrichment_records')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenant.id)
        .is('deleted_at', null),
    ]).then(([sResult, rResult]) => {
      setSessions((sResult.data as SessionRow[]) || [])
      setTotalRecords(rResult.count || 0)
      setLoading(false)
    })
  }, [tenant?.id])

  if (!tenant) return null

  const latestSession = sessions[0]
  const maxIteration = sessions.reduce((m, s) => Math.max(m, s.iteration), 0)

  return (
    <TabPage
      eyebrow={`${tenant.template_id ? tenant.template_id.replace(/_v\d+$/, '') : 'custom'}`}
      title={`Overview — ${tenant.name}`}
      description={
        maxIteration > 0
          ? `Turn ${maxIteration} of ${tenant.turn_count} · engagement active.`
          : 'No enrichment yet. Head to the Enrichment tab to upload Turn 1 data.'
      }
    >
      {loading ? (
        <p style={{ color: 'var(--color-text-tertiary)', fontSize: '14px' }}>Loading…</p>
      ) : (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '16px',
              marginBottom: '32px',
            }}
          >
            <Metric label="Turns complete" value={`${maxIteration} / ${tenant.turn_count}`} />
            <Metric
              label="Records enriched"
              value={totalRecords.toLocaleString()}
              mono
            />
            <Metric label="Sessions" value={sessions.length.toString()} />
            <Metric
              label="Value threshold"
              value={`$${tenant.value_threshold.toLocaleString()}`}
              mono
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: '24px' }}>
            <Card padding="large">
              <h3
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: '20px',
                  fontWeight: 600,
                  letterSpacing: '-0.008em',
                  marginBottom: '4px',
                }}
              >
                Recent sessions
              </h3>
              <p style={{ fontSize: '14px', color: 'var(--color-text-secondary)', marginBottom: '20px' }}>
                Every enrichment run the platform has performed for this tenant.
              </p>

              {sessions.length === 0 && (
                <div style={{ padding: '32px 0', textAlign: 'center' }}>
                  <p style={{ color: 'var(--color-text-tertiary)', fontSize: '14px' }}>
                    No sessions yet. Start Turn 1 from the Enrichment tab.
                  </p>
                </div>
              )}

              {sessions.slice(0, 5).map((s) => (
                <div
                  key={s.session_id}
                  style={{
                    padding: '14px 0',
                    borderBottom: '0.5px solid var(--color-hairline)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '15px', fontWeight: 500 }}>
                      Turn {s.iteration}
                      {s.file_name && (
                        <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 400, marginLeft: '8px', fontSize: '13px', fontFamily: 'var(--font-mono)' }}>
                          {s.file_name}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)', marginTop: '2px' }}>
                      {new Date(s.created_at).toLocaleString()} · {s.record_count} records
                    </div>
                  </div>
                  <StatusPill status={s.status} />
                </div>
              ))}
            </Card>

            <Card padding="large">
              <h3
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: '20px',
                  fontWeight: 600,
                  letterSpacing: '-0.008em',
                  marginBottom: '4px',
                }}
              >
                Next action
              </h3>
              <p style={{ fontSize: '14px', color: 'var(--color-text-secondary)', marginBottom: '20px' }}>
                {maxIteration === 0
                  ? 'Upload your first SAM.gov or HigherGov export to kick off Turn 1.'
                  : maxIteration < tenant.turn_count
                  ? `Run Turn ${maxIteration + 1} using the search package from Gate ${maxIteration}.`
                  : 'All turns complete. Generate the client-ready Export.'}
              </p>

              {latestSession && (
                <div style={{ background: 'var(--color-bg-subtle)', borderRadius: 'var(--radius-input)', padding: '16px' }}>
                  <div
                    style={{
                      fontSize: '11px',
                      fontWeight: 500,
                      letterSpacing: '0.015em',
                      textTransform: 'uppercase',
                      color: 'var(--color-text-tertiary)',
                      marginBottom: '8px',
                    }}
                  >
                    Last session
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                    Turn {latestSession.iteration} · {latestSession.status}
                  </div>
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </TabPage>
  )
}

function Metric({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <Card>
      <div
        style={{
          color: 'var(--color-text-tertiary)',
          fontSize: '13px',
          fontWeight: 500,
          letterSpacing: '0.015em',
          textTransform: 'uppercase',
          marginBottom: '12px',
        }}
      >
        {label}
      </div>
      <div
        style={{
          color: 'var(--color-text-primary)',
          fontSize: '32px',
          fontWeight: 600,
          letterSpacing: '-0.015em',
          lineHeight: 1.1,
          fontFamily: mono ? 'var(--font-mono)' : 'var(--font-display)',
        }}
      >
        {value}
      </div>
    </Card>
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
      }}
    >
      {status}
    </span>
  )
}
