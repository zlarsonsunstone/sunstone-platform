import { useEffect, useState } from 'react'
import { useStore } from '@/store/useStore'
import { Card } from './Card'
import { Button } from './Button'
import { CreateTenantWizard } from './admin/CreateTenantWizard'

export function TenantPickerModal() {
  const currentUser = useStore((s) => s.currentUser)
  const availableTenants = useStore((s) => s.availableTenants)
  const loadAvailableTenants = useStore((s) => s.loadAvailableTenants)
  const setActiveTenant = useStore((s) => s.setActiveTenant)
  const resolutionState = useStore((s) => s.tenantResolutionState)

  const [showWizard, setShowWizard] = useState(false)

  const isSuperAdmin = currentUser?.role === 'superadmin'

  useEffect(() => {
    loadAvailableTenants()
  }, [loadAvailableTenants])

  if (resolutionState !== 'needs-picker' && resolutionState !== 'stale') {
    return null
  }

  const handleTenantCreated = async () => {
    setShowWizard(false)
    await loadAvailableTenants()
  }

  return (
    <>
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

          {availableTenants.length === 0 ? (
            <div style={{ padding: '24px 0', textAlign: 'center' }}>
              <p
                style={{
                  fontSize: '15px',
                  color: 'var(--color-text-tertiary)',
                  marginBottom: isSuperAdmin ? '20px' : 0,
                }}
              >
                {isSuperAdmin
                  ? 'No tenants yet. Create your first one to begin.'
                  : 'No tenants available. A SuperAdmin must create one first.'}
              </p>
              {isSuperAdmin && (
                <Button onClick={() => setShowWizard(true)}>Create first tenant</Button>
              )}
            </div>
          ) : (
            <>
              <div style={{ marginTop: '24px', display: 'flex', flexDirection: 'column', gap: '0' }}>
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

              {isSuperAdmin && (
                <div style={{ marginTop: '20px', textAlign: 'center' }}>
                  <button
                    onClick={() => setShowWizard(true)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--color-accent)',
                      fontSize: '14px',
                      fontWeight: 500,
                      cursor: 'pointer',
                      padding: '8px 12px',
                      fontFamily: 'inherit',
                    }}
                  >
                    + New tenant
                  </button>
                </div>
              )}
            </>
          )}
        </Card>
      </div>

      {showWizard && (
        <CreateTenantWizard
          existingTenants={availableTenants}
          onClose={() => setShowWizard(false)}
          onCreated={handleTenantCreated}
        />
      )}
    </>
  )
}
