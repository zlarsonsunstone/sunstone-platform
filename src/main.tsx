import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { PublicIntakeForm } from './components/PublicIntakeForm'
import { PrelimSignOffPage } from './components/PrelimSignOffPage'
import './index.css'
import { initializeTheme } from './lib/theme'

// Apply theme (light/dark) before React mounts to prevent FOUC
initializeTheme()

// =============================================================================
// PATH-LEVEL ROUTING
// =============================================================================
// Public routes bypass the auth-gated platform entirely. /prospect/:token
// continues to be handled by App/components however it was before.
//
// /start                  -> PublicIntakeForm   (free-form public intake)
// /prelim/<token>         -> PrelimSignOffPage   (anon prospect sign-off, gated by token)
// /prelim/review[?id=...] -> falls through to <App /> (auth-gated consultant tool)
// everything else         -> <App />
//
// The /prelim/review path is reserved - PrelimSignOffPage is for tokens only,
// never the literal string "review".
// =============================================================================

function getRootComponent(): React.ReactNode {
  const path = window.location.pathname

  // /start - public intake form (replaces discovery calls)
  if (path === '/start' || path === '/start/') {
    return <PublicIntakeForm />
  }

  // /prelim/<token> - prospect-facing prelim sign-off (anon, gated by token).
  // Excludes the reserved /prelim/review path which is the consultant tool
  // mounted inside <App />.
  const prelimMatch = path.match(/^\/prelim\/([^/]+)\/?$/)
  if (prelimMatch && prelimMatch[1] !== 'review') {
    return <PrelimSignOffPage />
  }

  // Default: auth-gated platform (handles /prospect/:token + /prelim/review internally)
  return <App />
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {getRootComponent()}
  </React.StrictMode>
)
