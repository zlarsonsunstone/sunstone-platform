import { InputHTMLAttributes, TextareaHTMLAttributes, ReactNode, CSSProperties } from 'react'

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint?: string
  error?: string
  children: ReactNode
}) {
  return (
    <div>
      <label
        style={{
          display: 'block',
          fontSize: '13px',
          fontWeight: 500,
          color: 'var(--color-text-secondary)',
          marginBottom: '6px',
        }}
      >
        {label}
      </label>
      {children}
      {hint && !error && (
        <div
          style={{
            fontSize: '12px',
            color: 'var(--color-text-tertiary)',
            marginTop: '4px',
          }}
        >
          {hint}
        </div>
      )}
      {error && (
        <div
          style={{
            fontSize: '12px',
            color: 'var(--color-danger)',
            marginTop: '4px',
          }}
        >
          {error}
        </div>
      )}
    </div>
  )
}

export const inputStyle: CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  background: 'var(--color-bg-subtle)',
  border: '1px solid var(--color-hairline)',
  borderRadius: 'var(--radius-input)',
  fontSize: '14px',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
  color: 'var(--color-text-primary)',
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const { style, ...rest } = props
  return <input type={props.type || 'text'} {...rest} style={{ ...inputStyle, ...style }} />
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { style, ...rest } = props
  return (
    <textarea
      {...rest}
      style={{
        ...inputStyle,
        resize: 'vertical',
        minHeight: '96px',
        fontFamily: 'inherit',
        lineHeight: 1.5,
        ...style,
      }}
    />
  )
}
