import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Button } from './Button'
import { Card } from './Card'

export function LoginScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'password' | 'magic'>('password')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null)

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setMessage(null)

    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)

    if (error) {
      setMessage({ kind: 'error', text: error.message })
    }
  }

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setMessage(null)

    const { error } = await supabase.auth.signInWithOtp({ email })
    setBusy(false)

    if (error) {
      setMessage({ kind: 'error', text: error.message })
    } else {
      setMessage({ kind: 'info', text: 'Check your email for the login link.' })
    }
  }

  const handleGoogle = async () => {
    setBusy(true)
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
  }

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
      <Card padding="large" style={{ width: '100%', maxWidth: '420px' }}>
        <div style={{ marginBottom: '32px', textAlign: 'center' }}>
          <div
            style={{
              width: '48px',
              height: '48px',
              margin: '0 auto 16px',
              background: 'var(--color-text-primary)',
              borderRadius: '10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--color-bg-elevated)',
              fontSize: '22px',
              fontWeight: 600,
              fontFamily: 'var(--font-display)',
            }}
          >
            S
          </div>
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '24px',
              fontWeight: 600,
              letterSpacing: '-0.011em',
              marginBottom: '4px',
            }}
          >
            Sunstone Intelligence Engine
          </h1>
          <p style={{ fontSize: '15px', color: 'var(--color-text-secondary)' }}>
            Sign in to continue
          </p>
        </div>

        <form onSubmit={mode === 'password' ? handlePasswordLogin : handleMagicLink}>
          <div style={{ marginBottom: '16px' }}>
            <label
              htmlFor="email"
              style={{
                display: 'block',
                fontSize: '13px',
                fontWeight: 500,
                color: 'var(--color-text-secondary)',
                marginBottom: '6px',
              }}
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              style={{
                width: '100%',
                padding: '12px 16px',
                background: 'var(--color-bg-subtle)',
                border: '1px solid var(--color-hairline)',
                borderRadius: 'var(--radius-input)',
                fontSize: '15px',
                transition: 'var(--transition-default)',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {mode === 'password' && (
            <div style={{ marginBottom: '20px' }}>
              <label
                htmlFor="password"
                style={{
                  display: 'block',
                  fontSize: '13px',
                  fontWeight: 500,
                  color: 'var(--color-text-secondary)',
                  marginBottom: '6px',
                }}
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  background: 'var(--color-bg-subtle)',
                  border: '1px solid var(--color-hairline)',
                  borderRadius: 'var(--radius-input)',
                  fontSize: '15px',
                  transition: 'var(--transition-default)',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          )}

          <Button type="submit" disabled={busy} style={{ width: '100%' }}>
            {busy ? 'Signing in…' : mode === 'password' ? 'Sign in' : 'Send magic link'}
          </Button>
        </form>

        {message && (
          <p
            style={{
              marginTop: '12px',
              fontSize: '13px',
              color: message.kind === 'error' ? 'var(--color-danger)' : 'var(--color-text-secondary)',
              textAlign: 'center',
            }}
          >
            {message.text}
          </p>
        )}

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            margin: '24px 0',
            color: 'var(--color-text-tertiary)',
            fontSize: '13px',
          }}
        >
          <div style={{ flex: 1, height: '1px', background: 'var(--color-hairline)' }} />
          <span>or</span>
          <div style={{ flex: 1, height: '1px', background: 'var(--color-hairline)' }} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <Button variant="secondary" onClick={handleGoogle} disabled={busy} style={{ width: '100%' }}>
            Continue with Google
          </Button>
          <button
            type="button"
            onClick={() => setMode(mode === 'password' ? 'magic' : 'password')}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--color-accent)',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
              padding: '8px',
              fontFamily: 'inherit',
              marginTop: '4px',
            }}
          >
            {mode === 'password' ? 'Use magic link instead' : 'Use password instead'}
          </button>
        </div>
      </Card>
    </div>
  )
}
