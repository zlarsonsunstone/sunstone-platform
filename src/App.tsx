import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useStore } from '@/store/useStore'
import type { User } from '@/lib/types'
import { LoginScreen } from '@/components/LoginScreen'
import { TenantPickerModal } from '@/components/TenantPickerModal'
import { NavBar } from '@/components/NavBar'
import { Banner } from '@/components/Banner'
import { OverviewPlaceholder } from '@/components/OverviewPlaceholder'

export default function App() {
  const [authState, setAuthState] = useState<'loading' | 'signed-in' | 'signed-out'>('loading')
  const [activeTab, setActiveTab] = useState('Overview')

  const currentUser = useStore((s) => s.currentUser)
  const setCurrentUser = useStore((s) => s.setCurrentUser)
  const resolveTenantFromStorage = useStore((s) => s.resolveTenantFromStorage)
  const tenantResolutionState = useStore((s) => s.tenantResolutionState)
  const activeTenant = useStore((s) => s.activeTenant)

  // Handle auth state
  useEffect(() => {
    let mounted = true

    const loadUser = async (authUserId: string, email: string) => {
      // Read the app's user record from v2.users
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', authUserId)
        .maybeSingle()

      if (!mounted) return

      if (error || !data) {
        // Auth record exists but no corresponding v2.users row.
        // This is expected for new signups before a SuperAdmin provisions them.
        console.warn('No v2.users record found for auth user:', authUserId, email)
        setCurrentUser(null)
        setAuthState('signed-in') // still signed in, just no role yet
        return
      }

      setCurrentUser(data as User)
      setAuthState('signed-in')
    }

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      if (data.session?.user) {
        loadUser(data.session.user.id, data.session.user.email || '')
      } else {
        setAuthState('signed-out')
      }
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return
      if (session?.user) {
        loadUser(session.user.id, session.user.email || '')
      } else {
        setCurrentUser(null)
        setAuthState('signed-out')
      }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [setCurrentUser])

  // When user is set, resolve tenant from storage
  useEffect(() => {
    if (currentUser) {
      resolveTenantFromStorage()
    }
  }, [currentUser, resolveTenantFromStorage])

  // Render states
  if (authState === 'loading') {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--color-bg-primary)',
          color: 'var(--color-text-tertiary)',
          fontSize: '14px',
        }}
      >
        Loading…
      </div>
    )
  }

  if (authState === 'signed-out') {
    return <LoginScreen />
  }

  if (!currentUser) {
    // Signed in but no role provisioned
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          background: 'var(--color-bg-primary)',
        }}
      >
        <div style={{ maxWidth: '480px', textAlign: 'center' }}>
          <h2
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '24px',
              fontWeight: 600,
              letterSpacing: '-0.011em',
              marginBottom: '8px',
            }}
          >
            Account pending
          </h2>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: '15px' }}>
            Your account is signed in but has not been provisioned with a role yet.
            Contact a Sunstone administrator.
          </p>
          <button
            onClick={() => supabase.auth.signOut()}
            style={{
              marginTop: '24px',
              background: 'transparent',
              border: '1px solid var(--color-hairline)',
              color: 'var(--color-text-primary)',
              padding: '10px 20px',
              fontSize: '14px',
              fontWeight: 500,
              borderRadius: 'var(--radius-input)',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    )
  }

  // Signed in with role — show the main app
  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg-primary)' }}>
      <Banner />
      <NavBar activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Tenant picker blocks UI if needed (State B or C) */}
      <TenantPickerModal />

      {/* Main content — only renders when tenant is resolved */}
      {tenantResolutionState === 'ready' && activeTenant && <OverviewPlaceholder />}

      {tenantResolutionState === 'loading' && (
        <div
          style={{
            padding: '64px 48px',
            color: 'var(--color-text-tertiary)',
            fontSize: '14px',
          }}
        >
          Resolving tenant…
        </div>
      )}
    </div>
  )
}
