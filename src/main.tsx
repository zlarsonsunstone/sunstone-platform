import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ProspectConfirmation } from './components/ProspectConfirmation'
import { PublicIntakeForm } from './components/PublicIntakeForm'
import './index.css'
import { initializeTheme } from './lib/theme'

// Apply theme (light/dark) before React mounts to prevent FOUC
initializeTheme()

// =============================================================================
// PATH-LEVEL ROUTING
// =============================================================================
// Decide which root component to render based on URL path. Public routes
// bypass the auth-gated platform entirely, so they're never gated by sign-in
// state. Each public route is its own root component instance.
// =============================================================================

function getRootComponent(): React.ReactNode {
  const path = window.location.pathname

  // /start - public intake form (replaces discovery calls)
  if (path === '/start' || path === '/start/') {
    return <PublicIntakeForm />
  }

  // /prospect/:token - existing prospect confirmation flow
  if (path.startsWith('/prospect/')) {
    const token = path.replace(/^\/prospect\//, '').replace(/\/$/, '')
    if (token) {
      return <ProspectConfirmation token={token} />
    }
  }

  // Default: auth-gated platform
  return <App />
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {getRootComponent()}
  </React.StrictMode>
)
