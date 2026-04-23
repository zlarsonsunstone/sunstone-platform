import { useStore } from '@/store/useStore'
import { supabase } from '@/lib/supabase'

const TABS = [
  'Onboard',
  'Overview',
  'Enrichment',
  'Intelligence',
  'DNA Strand',
  'Export',
  'History',
] as const

interface NavBarProps {
  activeTab: string
  onTabChange: (tab: string) => void
  onOpenAdmin?: () => void
}

export function NavBar({ activeTab, onTabChange, onOpenAdmin }: NavBarProps) {
  const currentUser = useStore((s) => s.currentUser)
  const activeTenant = useStore((s) => s.activeTenant)
  const clearActiveTenant = useStore((s) => s.clearActiveTenant)

  const isAdminOrSuperAdmin =
    currentUser && (currentUser.role === 'admin' || currentUser.role === 'superadmin')

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    window.location.reload()
  }

  return (
    <nav
      style={{
        padding: '20px 32px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '0.5px solid var(--color-hairline)',
        background: 'var(--color-bg-elevated)',
        backdropFilter: 'saturate(180%) blur(12px)',
        WebkitBackdropFilter: 'saturate(180%) blur(12px)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '40px' }}>
        {/* Sunstone wordmark */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: '24px',
              height: '24px',
              background: 'var(--color-text-primary)',
              borderRadius: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--color-bg-elevated)',
              fontWeight: 600,
              fontSize: '13px',
              fontFamily: 'var(--font-display)',
            }}
          >
            S
          </div>
          <span
            style={{
              color: 'var(--color-text-primary)',
              fontWeight: 600,
              fontSize: '15px',
              letterSpacing: '-0.01em',
              fontFamily: 'var(--font-display)',
            }}
          >
            Sunstone Intelligence Engine
          </span>
        </div>

        {/* Tabs — only shown when a tenant is active */}
        {activeTenant && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
            {TABS.map((tab) => {
              const isActive = activeTab === tab
              return (
                <button
                  key={tab}
                  onClick={() => onTabChange(tab)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                    fontSize: '14px',
                    fontWeight: isActive ? 500 : 400,
                    cursor: 'pointer',
                    padding: '18px 0',
                    marginBottom: '-18px',
                    borderBottom: isActive ? '2px solid var(--color-accent)' : '2px solid transparent',
                    fontFamily: 'inherit',
                    transition: 'var(--transition-default)',
                  }}
                >
                  {tab}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        {activeTenant && (
          <span style={{ color: 'var(--color-text-tertiary)', fontSize: '13px' }}>
            {activeTenant.name}
            {isAdminOrSuperAdmin && ' ·'}
          </span>
        )}

        {/* Admin button */}
        {isAdminOrSuperAdmin && onOpenAdmin && (
          <button
            onClick={onOpenAdmin}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--color-text-primary)',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
              padding: '0',
              fontFamily: 'inherit',
            }}
          >
            Admin
          </button>
        )}

        {/* Tenant switcher (Admin/SuperAdmin only) */}
        {isAdminOrSuperAdmin && activeTenant && (
          <button
            onClick={clearActiveTenant}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--color-accent)',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
              padding: '0',
              fontFamily: 'inherit',
            }}
          >
            Switch
          </button>
        )}

        {/* User avatar + sign out */}
        {currentUser && (
          <button
            onClick={handleSignOut}
            title="Sign out"
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              background: 'var(--color-bg-subtle)',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--color-text-primary)',
              fontWeight: 500,
              fontSize: '12px',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {(currentUser.full_name || currentUser.email || '?')
              .slice(0, 2)
              .toUpperCase()}
          </button>
        )}
      </div>
    </nav>
  )
}
