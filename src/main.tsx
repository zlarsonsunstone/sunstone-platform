import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { PublicIntakeForm } from './components/PublicIntakeForm'
import './index.css'
import { initializeTheme } from './lib/theme'

// Apply theme (light/dark) before React mounts to prevent FOUC
initializeTheme()

// =============================================================================
// PATH-LEVEL ROUTING
// =============================================================================
// Public routes bypass the auth-gated platform entirely. /prospect/:token
// continues to be handled by App/components however it was before.
// =============================================================================

function getRootComponent(): React.ReactNode {
  const path = window.location.pathname

  // /start - public intake form (replaces discovery calls)
  if (path === '/start' || path === '/start/') {
    return <PublicIntakeForm />
  }

  // Default: auth-gated platform (handles /prospect/:token internally)
  return <App />
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {getRootComponent()}
  </React.StrictMode>
)
