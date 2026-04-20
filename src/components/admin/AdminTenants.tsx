import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useStore } from '@/store/useStore'
import type { Tenant } from '@/lib/types'
import { Button } from '../Button'
import { CreateTenantWizard } from './CreateTenantWizard'

export function AdminTenants() {
  const currentUser = useStore((s) => s.currentUser)
  const loadAvailableTenants = useStore((s) => s.loadAvailableTenants)
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(true)
  const [showWizard, setShowWizard] = useState(false)

  const isSuperAdmin = currentUser?.role === 'superadmin'

  const load = async () => {
    setLoading(true)
    const { data } = await supabase.from('tenants').select('*').order('name')
    setTenants((data as Tenant[]) || [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  const handleTenantCreated = async () => {
    setShowWizard(false)
    await load()
    await loadAvailableTenants()
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          marginBottom: '24px',
        }}
      >
        <div>
          <h3
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '20px',
              fontWeight: 600,
              letterSpacing: '-0.008em',
              margin: 0,
            }}
          >
            Tenants
          </h3>
          <p
            style={{
              color: 'var(--color-text-secondary)',
              fontSize: '14px',
              margin: '4px 0 0 0',
            }}
          >
            {tenants.length === 0 ? 'No tenants yet.' : `${tenants.length} ${tenants.length === 1 ? 'tenant' : 'tenants'}`}
          </p>
        </div>
        {isSuperAdmin && (
          <Button onClick={() => setShowWizard(true)}>New tenant</Button>
        )}
      </div>

      {loading && (
        <p style={{ color: 'var(--color-text-tertiary)', fontSize: '14px' }}>Loading…</p>
      )}

      {!loading && tenants.length === 0 && (
        <div
          style={{
            padding: '48px 24px',
            textAlign: 'center',
            background: 'var(--color-bg-subtle)',
            borderRadius: 'var(--radius-card)',
          }}
        >
          <p style={{ color: 'var(--color-text-secondary)', fontSize: '15px', marginBottom: '16px' }}>
            Create your first tenant to begin.
          </p>
          {isSuperAdmin && (
            <Button onClick={() => setShowWizard(true)}>New tenant</Button>
          )}
        </div>
      )}

      {!loading && tenants.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {tenants.map((tenant) => (
            <div
              key={tenant.id}
              style={{
                padding: '16px 0',
                borderBottom: '0.5px solid var(--color-hairline)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {tenant.client_logo_url ? (
                  <img
                    src={tenant.client_logo_url}
                    alt=""
                    style={{ width: '36px', height: '36px', borderRadius: '8px', objectFit: 'cover' }}
                  />
                ) : (
                  <div
                    style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '8px',
                      background: tenant.client_color || 'var(--color-bg-subtle)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#FFFFFF',
                      fontSize: '14px',
                      fontWeight: 600,
                    }}
                  >
                    {tenant.name.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div>
                  <div style={{ fontSize: '15px', fontWeight: 500 }}>{tenant.name}</div>
                  <div
                    style={{
                      fontSize: '13px',
                      color: 'var(--color-text-secondary)',
                      fontFamily: 'var(--font-mono)',
                      marginTop: '2px',
                    }}
                  >
                    {tenant.id}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span
                  style={{
                    padding: '4px 10px',
                    background:
                      tenant.status === 'active'
                        ? 'rgba(52, 199, 89, 0.15)'
                        : 'rgba(134, 134, 139, 0.15)',
                    color:
                      tenant.status === 'active'
                        ? '#34C759'
                        : 'var(--color-text-tertiary)',
                    borderRadius: '6px',
                    fontSize: '11px',
                    fontWeight: 500,
                    textTransform: 'uppercase',
                    letterSpacing: '0.015em',
                  }}
                >
                  {tenant.status}
                </span>
                {tenant.template_id && (
                  <span
                    style={{
                      fontSize: '13px',
                      color: 'var(--color-text-tertiary)',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    {tenant.template_id}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showWizard && (
        <CreateTenantWizard
          existingTenants={tenants}
          onClose={() => setShowWizard(false)}
          onCreated={handleTenantCreated}
        />
      )}
    </div>
  )
}
