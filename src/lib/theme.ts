/**
 * DS-8 — Theme management.
 * Reads user preference from localStorage (set post-login from users.display_preferences).
 * Falls back to system preference (prefers-color-scheme).
 * No flash of wrong theme — runs before React mounts.
 */

type Theme = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'sunstone.theme'

export function getStoredTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark' || stored === 'system') {
    return stored
  }
  return 'system'
}

export function setTheme(theme: Theme): void {
  localStorage.setItem(STORAGE_KEY, theme)
  applyTheme(theme)
}

function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return theme
}

function applyTheme(theme: Theme): void {
  const resolved = resolveTheme(theme)
  document.documentElement.setAttribute('data-theme', resolved)
}

export function initializeTheme(): void {
  const theme = getStoredTheme()
  applyTheme(theme)

  // Listen for system theme changes and re-apply if user is on 'system'
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const current = getStoredTheme()
    if (current === 'system') {
      applyTheme(current)
    }
  })
}
