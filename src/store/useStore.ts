import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  User,
  Tenant,
  TenantResolutionState,
  BannerState,
} from '@/lib/types'
import { supabase } from '@/lib/supabase'

/**
 * PRD v1.4 — Tenant Resolution States A/B/C
 * A: activeTenantId exists + tenant exists + user has access → ready
 * B: activeTenantId is null → needs-picker (blocks UI)
 * C: activeTenantId exists but tenant missing/inactive/out-of-scope → stale → clear → picker
 */

interface StoreState {
  // Auth
  currentUser: User | null

  // Tenant resolution
  activeTenantId: string | null
  activeTenant: Tenant | null
  tenantResolutionState: TenantResolutionState
  availableTenants: Tenant[]

  // Banner (tenant-view / impersonation)
  banner: BannerState

  // Impersonation
  impersonatedUserId: string | null

  // Actions
  setCurrentUser: (user: User | null) => void
  setActiveTenant: (tenantId: string) => Promise<void>
  clearActiveTenant: () => void
  resolveTenantFromStorage: () => Promise<void>
  loadAvailableTenants: () => Promise<void>
  startImpersonation: (userId: string, userName: string, tenantName: string) => void
  stopImpersonation: () => void
}

export const useStore = create<StoreState>()(
  persist(
    (set, get) => ({
      currentUser: null,
      activeTenantId: null,
      activeTenant: null,
      tenantResolutionState: 'loading',
      availableTenants: [],
      banner: { kind: 'none' },
      impersonatedUserId: null,

      setCurrentUser: (user) => {
        set({ currentUser: user })

        // For Users (role='user'), tenant is locked to home_tenant_id.
        // For Admin/SuperAdmin, tenant resolution follows localStorage flow.
        if (user && user.role === 'user' && user.home_tenant_id) {
          get().setActiveTenant(user.home_tenant_id)
        }
      },

      setActiveTenant: async (tenantId: string) => {
        const { data, error } = await supabase
          .from('tenants')
          .select('*')
          .eq('id', tenantId)
          .eq('status', 'active')
          .maybeSingle()

        if (error || !data) {
          // State C — tenant missing or inactive
          set({
            activeTenantId: null,
            activeTenant: null,
            tenantResolutionState: 'stale',
          })
          return
        }

        // State A — normal operation
        set({
          activeTenantId: tenantId,
          activeTenant: data as Tenant,
          tenantResolutionState: 'ready',
        })

        // Apply tenant accent color to CSS variable (DS-11)
        document.documentElement.style.setProperty(
          '--color-accent',
          data.client_color || 'var(--color-accent-default)'
        )

        // Banner for Admin/SuperAdmin viewing a tenant (RM-5 state 1)
        const user = get().currentUser
        if (user && (user.role === 'admin' || user.role === 'superadmin')) {
          set({
            banner: {
              kind: 'tenant-view',
              tenantName: data.name,
              actorName: user.full_name || user.email,
            },
          })
        }
      },

      clearActiveTenant: () => {
        set({
          activeTenantId: null,
          activeTenant: null,
          tenantResolutionState: 'needs-picker',
          banner: { kind: 'none' },
        })
        // Reset accent color to default
        document.documentElement.style.removeProperty('--color-accent')
      },

      resolveTenantFromStorage: async () => {
        const { activeTenantId, currentUser } = get()

        // No user yet → stay in loading, picker not relevant until auth
        if (!currentUser) {
          set({ tenantResolutionState: 'loading' })
          return
        }

        // Users have fixed tenant, no picker
        if (currentUser.role === 'user') {
          if (currentUser.home_tenant_id) {
            await get().setActiveTenant(currentUser.home_tenant_id)
          }
          return
        }

        // Admin/SuperAdmin: check localStorage-persisted activeTenantId
        if (!activeTenantId) {
          // State B — first visit / cleared storage
          set({ tenantResolutionState: 'needs-picker' })
          return
        }

        // State A or C — try to load the tenant
        await get().setActiveTenant(activeTenantId)
      },

      loadAvailableTenants: async () => {
        const { currentUser } = get()
        if (!currentUser) return

        let query = supabase.from('tenants').select('*').eq('status', 'active').order('name')

        // Scoped Admin: restrict by admin_tenant_scope (RM-2)
        if (
          currentUser.role === 'admin' &&
          currentUser.admin_tenant_scope !== null &&
          Array.isArray(currentUser.admin_tenant_scope)
        ) {
          if (currentUser.admin_tenant_scope.length === 0) {
            set({ availableTenants: [] })
            return
          }
          query = query.in('id', currentUser.admin_tenant_scope)
        }

        const { data, error } = await query
        if (error) {
          console.error('Failed to load tenants:', error)
          set({ availableTenants: [] })
          return
        }

        set({ availableTenants: (data as Tenant[]) || [] })
      },

      startImpersonation: (userId, userName, tenantName) => {
        set({
          impersonatedUserId: userId,
          banner: {
            kind: 'impersonation',
            impersonatedUserName: userName,
            tenantName,
          },
        })
        // Audit log write happens server-side via edge function (RM-7).
      },

      stopImpersonation: () => {
        const { currentUser, activeTenant } = get()
        set({ impersonatedUserId: null })

        // Revert banner to tenant-view if Admin/SuperAdmin still viewing a tenant
        if (
          currentUser &&
          (currentUser.role === 'admin' || currentUser.role === 'superadmin') &&
          activeTenant
        ) {
          set({
            banner: {
              kind: 'tenant-view',
              tenantName: activeTenant.name,
              actorName: currentUser.full_name || currentUser.email,
            },
          })
        } else {
          set({ banner: { kind: 'none' } })
        }
      },
    }),
    {
      name: 'sunstone.store',
      // Only persist tenant selection — NOT user, NOT banner, NOT impersonation
      partialize: (state) => ({ activeTenantId: state.activeTenantId }),
    }
  )
)
