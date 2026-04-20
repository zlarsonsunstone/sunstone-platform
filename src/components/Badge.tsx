import { ReactNode, CSSProperties } from 'react'

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

const tones: Record<Tone, { bg: string; fg: string }> = {
  neutral: { bg: 'var(--color-bg-subtle)', fg: 'var(--color-text-secondary)' },
  success: { bg: 'rgba(52, 199, 89, 0.15)', fg: 'var(--color-success)' },
  warning: { bg: 'rgba(255, 159, 10, 0.18)', fg: 'var(--color-warning)' },
  danger: { bg: 'rgba(255, 59, 48, 0.15)', fg: 'var(--color-danger)' },
  info: { bg: 'rgba(212, 146, 10, 0.15)', fg: 'var(--color-accent)' },
}

export function Badge({
  tone = 'neutral',
  children,
  style,
}: {
  tone?: Tone
  children: ReactNode
  style?: CSSProperties
}) {
  const t = tones[tone]
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        borderRadius: '999px',
        padding: '2px 8px',
        fontSize: '11px',
        fontWeight: 500,
        background: t.bg,
        color: t.fg,
        letterSpacing: '-0.003em',
        lineHeight: 1.4,
        ...style,
      }}
    >
      {children}
    </span>
  )
}
