import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useStore } from '@/store/useStore'
import type { User } from '@/lib/types'
import { LoginScreen } from '@/components/LoginScreen'
import { TenantPickerModal } from '@/components/TenantPickerModal'
import { NavBar } from '@/components/NavBar'
import { Banner } from '@/components/Banner'
import { Dashboard } from '@/components/Dashboard'
import { AdminPanel } from '@/components/AdminPanel'
import { PrelimReview } from '@/components/PrelimReview'
import { AdminSubmissionsPage } from '@/components/AdminSubmissionsPage'
import { ProfileReview } from '@/components/ProfileReview'
import { ProspectConfirmation } from '@/pages/ProspectConfirmation'
import { ReconPage } from '@/pages/ReconPage'

export default function App() {
  // Intercept prospect-view URLs before auth check.
  const prospectMatch = window.location.pathname.match(/^\/prospect\/([A-Za-z0-9_-]+)\/?$/)
  if (prospectMatch) {
    return <ProspectConfirmation token={prospectMatch[1]} />
  }

  const isPrelimReviewPath = window.location.pathname === '/prelim/review'
    || window.location.pathname === '/prelim/review/'

  const isAdminSubmissionsPath = window.location.pathname === '/admin/submissions'
    || window.location.pathname === '/admin/submissions/'

  const isProfileReviewPath = window.location.pathname === '/profile/review'
    || window.location.pathname === '/profile/review/'

  // /recon - prospect-facing Dartboard Tool (clustered opps). Auth-gated.
  // Renders without NavBar / Dashboard chrome.
  const isReconPath = window.location.pathname === '/recon'
    || window.location.pathname === '/recon/'

  const [authState, setAuthState] = useState<'loading' | 'signed-in' | 'signed-out'>('loading')
  const [activeTab, setActiveTab] = useState('Overview')
  const [adminOpen, setAdminOpen] = useState(false)

  const currentUser = useStore((s) => s.currentUser)
  const setCurrentUser = useStore((s) => s.setCurrentUser)
  const resolveTenantFromStorage = useStore((s) => s.resolveTenantFromStorage)
  const tenantResolutionState = useStore((s) => s.tenantResolutionState)
  const activeTenant = useStore((s) => s.activeTenant)

  // Handle auth state
  useEffect(() => {
    let mounted = true

    const loadUser = async (authUserId: string, email: string) => {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', authUserId)
        .maybeSingle()

      if (!mounted) return

      if (error) {
        console.error('[App] Failed to load user record:', error)
        setCurrentUser(null)
        setAuthState('signed-in')
        return
      }

      if (data) {
        setCurrentUser(data as User)
      } else {
        console.warn('[App] Auth user has no v2.users record:', email)
        setCurrentUser(null)
      }
      setAuthState('signed-in')
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return
      if (session?.user) {
        loadUser(session.user.id, session.user.email || '')
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
        Loading...
      </div>
    )
  }

  if (authState === 'signed-out') {
     const path = window.location.pathname
     if (path === '/signin' || path === '/signin/') {
       return <LoginScreen />
     }
     if (path === '/journey' || path === '/journey/') {
       window.location.replace('/Sunstone_Stages.html')
       return null
     }
     if (path === '/journey/plain' || path === '/journey/plain/') {
       window.location.replace('/Sunstone_Stages_Plain.html')
       return null
     }
     // /recon and /stages require auth - redirect to signin
     if (path === '/recon' || path === '/recon/' || path === '/stages' || path === '/stages/') {
       window.location.replace('/signin')
       return null
     }
     window.location.replace('/Sunstone_Story.html')
     return null
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

  // /recon - prospect Dartboard Tool. Auth-gated, renders standalone.
  // Includes Banner so impersonation banner shows; no NavBar / Dashboard.
  if (isReconPath) {
    return (
      <>
        <Banner />
        <TenantPickerModal />
        {tenantResolutionState === 'ready' && activeTenant && <ReconPage />}
        {tenantResolutionState === 'loading' && (
          <div style={{ padding: '64px 48px', color: 'var(--color-text-tertiary)', fontSize: '14px' }}>
            Resolving tenant...
          </div>
        )}
      </>
    )
  }

  if (isPrelimReviewPath) {
    return <PrelimReview />
  }

  if (isAdminSubmissionsPath) {
    return <AdminSubmissionsPage />
  }

  if (isProfileReviewPath) {
    return <ProfileReview />
  }

  // Signed in with role - show the main app
  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg-primary)' }}>
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 500,
        }}
      >
        <Banner />
        <NavBar
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onOpenAdmin={() => setAdminOpen(true)}
        />
      </div>

      <TenantPickerModal />

      {tenantResolutionState === 'ready' && activeTenant && (
        <Dashboard activeTab={activeTab} />
      )}

      {adminOpen && <AdminPanel onClose={() => setAdminOpen(false)} />}

      {tenantResolutionState === 'loading' && (
        <div
          style={{
            padding: '64px 48px',
            color: 'var(--color-text-tertiary)',
            fontSize: '14px',
          }}
        >
          Resolving tenant...
        </div>
      )}
    </div>
  )
}
