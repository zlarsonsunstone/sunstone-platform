import { useStore } from '@/store/useStore'

export function Banner() {
  const banner = useStore((s) => s.banner)
  const clearActiveTenant = useStore((s) => s.clearActiveTenant)
  const stopImpersonation = useStore((s) => s.stopImpersonation)
  const currentUser = useStore((s) => s.currentUser)

  if (banner.kind === 'none') return null

  const isImpersonation = banner.kind === 'impersonation'

  const bgColor = isImpersonation ? '#FF3B30' : '#FF9F0A'
  const fontWeight = isImpersonation ? 600 : 500

  const text =
    banner.kind === 'tenant-view'
      ? `Viewing tenant: ${banner.tenantName}  ·  You are signed in as ${banner.actorName}`
      : `IMPERSONATING: ${banner.impersonatedUserName} at ${banner.tenantName}  ·  All actions logged`

  const actionText = isImpersonation ? 'Exit impersonation' : 'Return to all tenants'

  const handleAction = () => {
    if (isImpersonation) {
      stopImpersonation()
    } else {
      // Only Admin/SuperAdmin can return to picker; Users never see this banner
      if (currentUser?.role === 'admin' || currentUser?.role === 'superadmin') {
        clearActiveTenant()
      }
    }
  }

  return (
    <div
      role="status"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 100,
        height: '48px',
        background: bgColor,
        color: '#FFFFFF',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 24px',
        fontSize: '15px',
        fontWeight,
        letterSpacing: '-0.003em',
      }}
    >
      <span>{text}</span>
      <button
        onClick={handleAction}
        style={{
          background: 'transparent',
          border: 'none',
          color: '#FFFFFF',
          fontSize: '14px',
          fontWeight: 500,
          cursor: 'pointer',
          padding: '0',
          fontFamily: 'inherit',
        }}
      >
        {actionText}
      </button>
    </div>
  )
}
