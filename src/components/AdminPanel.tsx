import { useState } from 'react'
import { useStore } from '@/store/useStore'
import { AdminTenants } from './admin/AdminTenants'
import { AdminUsers } from './admin/AdminUsers'
import { AdminVariants } from './admin/AdminVariants'
import { AdminAuditLog } from './admin/AdminAuditLog'

type AdminTab = 'tenants' | 'users' | 'variants' | 'audit'

export function AdminPanel({ onClose }: { onClose: () => void }) {
  const currentUser = useStore((s) => s.currentUser)
  const [tab, setTab] = useState<AdminTab>('tenants')

  const isSuperAdmin = currentUser?.role === 'superadmin'

  const tabs: { id: AdminTab; label: string; superadminOnly?: boolean }[] = [
    { id: 'tenants', label: 'Tenants' },
    { id: 'users', label: 'Users' },
    { id: 'variants', label: 'Prompt Variants', superadminOnly: true },
    { id: 'audit', label: 'Audit Log', superadminOnly: true },
  ]

  const visibleTabs = tabs.filter((t) => !t.superadminOnly || isSuperAdmin)

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
        zIndex: 300,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '48px 24px',
        overflow: 'auto',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '960px',
          background: 'var(--color-bg-elevated)',
          borderRadius: 'var(--radius-modal)',
          boxShadow: 'var(--shadow-card)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '24px 32px',
            borderBottom: '0.5px solid var(--color-hairline)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <h2
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: '24px',
                fontWeight: 600,
                letterSpacing: '-0.011em',
                margin: 0,
              }}
            >
              Admin
            </h2>
            <p
              style={{
                color: 'var(--color-text-secondary)',
                fontSize: '14px',
                margin: '4px 0 0 0',
              }}
            >
              Manage tenants, users, and platform configuration.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--color-text-secondary)',
              fontSize: '24px',
              cursor: 'pointer',
              padding: '4px 12px',
              fontFamily: 'inherit',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {/* Tabs */}
        <div
          style={{
            padding: '0 32px',
            borderBottom: '0.5px solid var(--color-hairline)',
            display: 'flex',
            gap: '24px',
          }}
        >
          {visibleTabs.map((t) => {
            const active = tab === t.id
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: active ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                  fontSize: '14px',
                  fontWeight: active ? 500 : 400,
                  cursor: 'pointer',
                  padding: '16px 0',
                  borderBottom: active ? '2px solid var(--color-accent)' : '2px solid transparent',
                  marginBottom: '-1px',
                  fontFamily: 'inherit',
                  transition: 'var(--transition-default)',
                }}
              >
                {t.label}
              </button>
            )
          })}
        </div>

        {/* Body */}
        <div style={{ padding: '32px', maxHeight: 'calc(100vh - 220px)', overflow: 'auto' }}>
          {tab === 'tenants' && <AdminTenants />}
          {tab === 'users' && <AdminUsers />}
          {tab === 'variants' && isSuperAdmin && <AdminVariants />}
          {tab === 'audit' && isSuperAdmin && <AdminAuditLog />}
        </div>
      </div>
    </div>
  )
}
