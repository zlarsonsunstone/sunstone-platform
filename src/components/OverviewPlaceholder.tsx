import { useStore } from '@/store/useStore'
import { Card } from './Card'

export function OverviewPlaceholder() {
  const tenant = useStore((s) => s.activeTenant)

  return (
    <main
      style={{
        padding: '64px 48px',
        background: 'var(--color-bg-primary)',
        minHeight: '100vh',
      }}
    >
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
          Day 1 shell · {tenant?.name}
        </span>
      </div>

      <h1
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: '40px',
          fontWeight: 600,
          color: 'var(--color-text-primary)',
          letterSpacing: '-0.022em',
          marginBottom: '8px',
          lineHeight: 1.1,
        }}
      >
        Overview
      </h1>
      <p
        style={{
          color: 'var(--color-text-secondary)',
          fontSize: '17px',
          lineHeight: 1.47,
          margin: '0 0 64px 0',
          maxWidth: '640px',
        }}
      >
        The foundation is live. Tabs, data model, and tenant isolation are wired.
        Features will land progressively from here.
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '16px',
          marginBottom: '32px',
        }}
      >
        <Card>
          <div
            style={{
              color: 'var(--color-text-tertiary)',
              fontSize: '13px',
              fontWeight: 500,
              letterSpacing: '0.015em',
              textTransform: 'uppercase',
              marginBottom: '12px',
            }}
          >
            Template
          </div>
          <div
            style={{
              color: 'var(--color-text-primary)',
              fontSize: '20px',
              fontWeight: 600,
              letterSpacing: '-0.008em',
            }}
          >
            {tenant?.template_id || '—'}
          </div>
        </Card>

        <Card>
          <div
            style={{
              color: 'var(--color-text-tertiary)',
              fontSize: '13px',
              fontWeight: 500,
              letterSpacing: '0.015em',
              textTransform: 'uppercase',
              marginBottom: '12px',
            }}
          >
            Value threshold
          </div>
          <div
            style={{
              color: 'var(--color-text-primary)',
              fontSize: '20px',
              fontWeight: 600,
              letterSpacing: '-0.008em',
              fontFamily: 'var(--font-mono)',
            }}
          >
            ${(tenant?.value_threshold ?? 0).toLocaleString()}
          </div>
        </Card>

        <Card>
          <div
            style={{
              color: 'var(--color-text-tertiary)',
              fontSize: '13px',
              fontWeight: 500,
              letterSpacing: '0.015em',
              textTransform: 'uppercase',
              marginBottom: '12px',
            }}
          >
            Turn count
          </div>
          <div
            style={{
              color: 'var(--color-text-primary)',
              fontSize: '20px',
              fontWeight: 600,
              letterSpacing: '-0.008em',
            }}
          >
            {tenant?.turn_count ?? '—'}
          </div>
        </Card>

        <Card>
          <div
            style={{
              color: 'var(--color-text-tertiary)',
              fontSize: '13px',
              fontWeight: 500,
              letterSpacing: '0.015em',
              textTransform: 'uppercase',
              marginBottom: '12px',
            }}
          >
            Prompt variant
          </div>
          <div
            style={{
              color: 'var(--color-text-primary)',
              fontSize: '15px',
              fontWeight: 500,
              fontFamily: 'var(--font-mono)',
            }}
          >
            {tenant?.prompt_variant_enrichment || '—'}
          </div>
        </Card>
      </div>
    </main>
  )
}
