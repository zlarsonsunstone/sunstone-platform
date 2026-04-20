import { useEffect } from 'react'
import { useStore } from '@/store/useStore'
import { Card } from './Card'

export function TenantPickerModal() {
  const availableTenants = useStore((s) => s.availableTenants)
  const loadAvailableTenants = useStore((s) => s.loadAvailableTenants)
  const setActiveTenant = useStore((s) => s.setActiveTenant)
  const resolutionState = useStore((s) => s.tenantResolutionState)

  useEffect(() => {
    loadAvailableTenants()
  }, [loadAvailableTenants])

  if (resolutionState !== 'needs-picker' && resolutionState !== 'stale') {
    return null
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.4)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 200,
        padding: '24px',
      }}
    >
      <Card padding="large" style={{ width: '100%', maxWidth: '480px' }}>
        <h2
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: '24px',
            fontWeight: 600,
            letterSpacing: '-0.011em',
            marginBottom: '8px',
          }}
        >
          Select a tenant
        </h2>

        {resolutionState === 'stale' && (
          <p
            style={{
              fontSize: '15px',
              color: 'var(--color-text-secondary)',
              marginBottom: '16px',
            }}
          >
            Previous tenant no longer available. Select a tenant to continue.
          </p>
        )}

        {resolutionState === 'needs-picker' && (
          <p
            style={{
              fontSize: '15px',
              color: 'var(--color-text-secondary)',
              marginBottom: '24px',
            }}
          >
            Choose a client to work on.
          </p>
        )}

        <div style={{ marginTop: '24px', display: 'flex', flexDirection: 'column', gap: '0' }}>
          {availableTenants.length === 0 && (
            <p
              style={{
                fontSize: '15px',
                color: 'var(--color-text-tertiary)',
                textAlign: 'center',
                padding: '24px 0',
              }}
            >
              No tenants available. A SuperAdmin must create one first.
            </p>
          )}

          {availableTenants.map((tenant) => (
            <button
              key={tenant.id}
              onClick={() => setActiveTenant(tenant.id)}
              style={{
                background: 'transparent',
                border: 'none',
                borderBottom: '0.5px solid var(--color-hairline)',
                padding: '16px 0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer',
                fontFamily: 'inherit',
                textAlign: 'left',
                transition: 'var(--transition-default)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--color-bg-subtle)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {tenant.client_logo_url ? (
                  <img
                    src={tenant.client_logo_url}
                    alt=""
                    style={{ width: '32px', height: '32px', borderRadius: '6px', objectFit: 'cover' }}
                  />
                ) : (
                  <div
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '6px',
                      background: tenant.client_color || 'var(--color-bg-subtle)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#FFFFFF',
                      fontSize: '13px',
                      fontWeight: 600,
                    }}
                  >
                    {tenant.name.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div>
                  <div style={{ fontSize: '15px', fontWeight: 500, color: 'var(--color-text-primary)' }}>
                    {tenant.name}
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)', marginTop: '2px' }}>
                    {tenant.id}
                  </div>
                </div>
              </div>
              <span style={{ color: 'var(--color-text-tertiary)', fontSize: '18px' }}>›</span>
            </button>
          ))}
        </div>
      </Card>
    </div>
  )
}
