import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { initial } from '../lib/format'

export function Logo({ height = 36, className = '' }: { height?: number; className?: string }) {
  return <img src="/logo.webp" alt="أبناء فارس أبو زايد" className={`logo ${className}`} style={{ height }} />
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'md' | 'lg'
  block?: boolean
  busy?: boolean
  icon?: ReactNode
}

export function Button({ variant = 'secondary', size = 'md', block, busy, icon, children, className = '', disabled, ...rest }: ButtonProps) {
  const classes = ['btn', variant !== 'secondary' && variant, size === 'lg' && 'lg', block && 'block', className]
    .filter(Boolean)
    .join(' ')
  return (
    <button type="button" className={classes} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {busy ? <span className="spinner" aria-hidden="true" /> : icon}
      {children}
    </button>
  )
}

export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'brand' | 'neutral'

export function Pill({ tone = 'neutral', dot = true, children }: { tone?: Tone; dot?: boolean; children: ReactNode }) {
  return (
    <span className={`pill ${tone === 'neutral' ? '' : tone}`}>
      {dot && <span className="dot" aria-hidden="true" />}
      {children}
    </span>
  )
}

export function Avatar({ name, size = 38 }: { name: string; size?: number }) {
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.36 }} aria-hidden="true">
      {initial(name)}
    </span>
  )
}
