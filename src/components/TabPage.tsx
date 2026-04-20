import { ReactNode } from 'react'

interface TabPageProps {
  eyebrow?: string
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
}

export function TabPage({ eyebrow, title, description, actions, children }: TabPageProps) {
  return (
    <main
      style={{
        padding: '64px 48px',
        background: 'var(--color-bg-primary)',
        minHeight: 'calc(100vh - 69px)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '24px', marginBottom: '48px' }}>
        <div>
          {eyebrow && (
            <div style={{ marginBottom: '8px' }}>
              <span
                style={{
                  color: 'var(--color-text-tertiary)',
                  fontSize: '13px',
                  fontWeight: 500,
                  letterSpacing: '0.015em',
                  textTransform: 'uppercase',
                }}
              >
                {eyebrow}
              </span>
            </div>
          )}
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '40px',
              fontWeight: 600,
              color: 'var(--color-text-primary)',
              letterSpacing: '-0.022em',
              marginBottom: description ? '8px' : 0,
              lineHeight: 1.1,
            }}
          >
            {title}
          </h1>
          {description && (
            <p
              style={{
                color: 'var(--color-text-secondary)',
                fontSize: '17px',
                lineHeight: 1.47,
                margin: 0,
                maxWidth: '640px',
              }}
            >
              {description}
            </p>
          )}
        </div>
        {actions && <div style={{ flexShrink: 0 }}>{actions}</div>}
      </div>

      {children}
    </main>
  )
}
