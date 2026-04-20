import { ReactNode, ButtonHTMLAttributes } from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'tertiary'
type ButtonSize = 'small' | 'medium'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
  variant?: ButtonVariant
  size?: ButtonSize
}

export function Button({
  children,
  variant = 'primary',
  size = 'medium',
  style,
  ...rest
}: ButtonProps) {
  const base = {
    fontFamily: 'var(--font-text)',
    fontWeight: 500,
    fontSize: '15px',
    borderRadius: 'var(--radius-input)',
    border: 'none',
    cursor: 'pointer',
    transition: 'var(--transition-default)',
    letterSpacing: '-0.003em',
  }

  const sizes = {
    small: { padding: '8px 16px', height: '36px' },
    medium: { padding: '10px 20px', height: '40px' },
  }

  const variants: Record<ButtonVariant, React.CSSProperties> = {
    primary: {
      background: 'var(--color-accent)',
      color: '#FFFFFF',
    },
    secondary: {
      background: 'transparent',
      color: 'var(--color-accent)',
      border: '1px solid var(--color-hairline)',
    },
    tertiary: {
      background: 'transparent',
      color: 'var(--color-accent)',
      padding: '8px 12px',
    },
  }

  return (
    <button
      {...rest}
      style={{ ...base, ...sizes[size], ...variants[variant], ...style }}
    >
      {children}
    </button>
  )
}
