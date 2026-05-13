import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useStore } from '@/store/useStore'
import type { User, Tenant } from '@/lib/types'

export function AdminUsers() {
  const currentUser = useStore((s) => s.currentUser)
  const startImpersonation = useStore((s) => s.startImpersonation)
  const setActiveTenant = useStore((s) => s.setActiveTenant)
  const impersonatedUserId = useStore((s) => s.impersonatedUserId)

  const [users, setUsers] = useState<User[]>([])
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(true)
  const [busyUserId, setBusyUserId] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      supabase.from('users').select('*').order('created_at', { ascending: false }),
      supabase.from('tenants').select('*'),
    ]).then(([uResult, tResult]) => {
      setUsers((uResult.data as User[]) || [])
      setTenants((tResult.data as Tenant[]) || [])
      setLoading(false)
    })
  }, [])

  const tenantName = (id: string | null) =>
    id ? tenants.find((t) => t.id === id)?.name || id : '—'

  // Only SuperAdmin and Admin can impersonate
  const canImpersonate =
    currentUser?.role === 'superadmin' || currentUser?.role === 'admin'

  const handleImpersonate = async (u: User) => {
    if (!u.home_tenant_id) {
      alert('This user has no home tenant. Impersonation requires a tenant assignment.')
      return
    }
    setBusyUserId(u.id)
    try {
      // Switch active tenant to the user's home tenant
      await setActiveTenant(u.home_tenant_id)
      // Flip impersonation banner state
      startImpersonation(
        u.id,
        u.full_name || u.email,
        tenantName(u.home_tenant_id)
      )
    } catch (e: any) {
      console.error('[Impersonate] error:', e)
      alert('Failed to start impersonation: ' + (e?.message || 'unknown'))
    } finally {
      setBusyUserId(null)
    }
  }

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
          Users
        </h3>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: '14px', margin: '4px 0 0 0' }}>
          User creation requires SuperAdmin direct SQL access during bootstrap. In-app invitation flow ships in a follow-up.
        </p>
      </div>

      {loading && <p style={{ color: 'var(--color-text-tertiary)', fontSize: '14px' }}>Loading…</p>}

      {!loading && (
        <div>
          {users.map((u) => {
            const isSelf = u.id === currentUser?.id
            const isCurrentlyImpersonating = u.id === impersonatedUserId
            return (
              <div
                key={u.id}
                style={{
                  padding: '16px 0',
                  borderBottom: '0.5px solid var(--color-hairline)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '16px',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '15px', fontWeight: 500 }}>
                    {u.full_name || u.email}
                    {isSelf && (
                      <span
                        style={{
                          marginLeft: '8px',
                          fontSize: '11px',
                          fontWeight: 500,
                          color: 'var(--color-text-tertiary)',
                          textTransform: 'uppercase',
                          letterSpacing: '0.015em',
                        }}
                      >
                        You
                      </span>
                    )}
                    {isCurrentlyImpersonating && (
                      <span
                        style={{
                          marginLeft: '8px',
                          fontSize: '11px',
                          fontWeight: 600,
                          color: '#FF3B30',
                          textTransform: 'uppercase',
                          letterSpacing: '0.015em',
                        }}
                      >
                        Impersonating now
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)', marginTop: '2px' }}>
                    {u.email} · {u.role === 'user' ? tenantName(u.home_tenant_id) : u.role}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexShrink: 0 }}>
                  {canImpersonate && !isSelf && u.home_tenant_id && (
                    <button
                      onClick={() => handleImpersonate(u)}
                      disabled={busyUserId === u.id}
                      style={{
                        padding: '6px 12px',
                        background: 'transparent',
                        border: '1px solid var(--color-hairline)',
                        borderRadius: '6px',
                        fontSize: '12px',
                        fontWeight: 500,
                        color: 'var(--color-text-primary)',
                        cursor: busyUserId === u.id ? 'wait' : 'pointer',
                        fontFamily: 'inherit',
                        letterSpacing: '-0.003em',
                      }}
                    >
                      {busyUserId === u.id ? 'Switching…' : 'View as user'}
                    </button>
                  )}
                  <RolePill role={u.role} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function RolePill({ role }: { role: string }) {
  const colors: Record<string, { bg: string; fg: string }> = {
    superadmin: { bg: 'rgba(212, 146, 10, 0.15)', fg: '#D4920A' },
    admin: { bg: 'rgba(55, 138, 221, 0.15)', fg: '#378ADD' },
    user: { bg: 'rgba(134, 134, 139, 0.15)', fg: '#6E6E73' },
  }
  const c = colors[role] || colors.user

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
      {role}
    </span>
  )
}
