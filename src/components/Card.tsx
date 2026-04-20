import { ReactNode, CSSProperties } from 'react'

interface CardProps {
  children: ReactNode
  padding?: 'standard' | 'large'
  style?: CSSProperties
}

export function Card({ children, padding = 'standard', style }: CardProps) {
  const pad = padding === 'large' ? '32px' : '24px'

  return (
    <div
      style={{
        background: 'var(--color-bg-elevated)',
        borderRadius: 'var(--radius-card)',
        padding: pad,
        boxShadow: 'var(--shadow-card)',
        ...style,
      }}
    >
      {children}
    </div>
  )
}
