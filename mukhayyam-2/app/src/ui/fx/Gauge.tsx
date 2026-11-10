import { useEffect, useId, useState } from 'react'
import { formatAmount } from '../../lib/numbers'
import { useReducedMotion } from '../../lib/motion'

export function Gauge({ value, max = 100, warn, danger, inverse = false, label, detail, size }: {
  value: number | null; max?: number; warn: number; danger: number; inverse?: boolean; label: string; detail?: string; size?: 'sm'
}) {
  const gradient = useId().replace(/:/g, '')
  const [ready, setReady] = useState(false)
  const reduced = useReducedMotion()
  useEffect(() => { const id = requestAnimationFrame(() => setReady(true)); return () => cancelAnimationFrame(id) }, [])
  const fraction = value === null ? 0 : Math.max(0, Math.min(1, value / max))
  const tone = value === null ? 'muted' : inverse ? (value < danger ? 'danger' : value < warn ? 'warn' : 'ok') : (value >= danger ? 'danger' : value >= warn ? 'warn' : 'ok')
  return <div className={`fx-gauge${size ? ' fx-gauge-sm' : ''}`} data-tone={tone} role="img" aria-label={`${label}: ${formatAmount(value)}${detail ? `، ${detail}` : ''}`}>
    <svg viewBox="0 0 160 140" aria-hidden="true">
      <defs><linearGradient id={gradient}><stop offset="0" stopColor={inverse ? 'var(--danger)' : 'var(--ok)'} /><stop offset=".6" stopColor="var(--warn)" /><stop offset="1" stopColor={inverse ? 'var(--ok)' : 'var(--danger)'} /></linearGradient></defs>
      <path d="M26.3 111 A62 62 0 1 1 133.7 111" fill="none" stroke="var(--track)" strokeWidth="9" strokeLinecap="round" />
      <path d="M26.3 111 A62 62 0 1 1 133.7 111" fill="none" stroke={`url(#${gradient})`} strokeWidth="9" strokeLinecap="round" pathLength="100" strokeDasharray={`${fraction * 100} 100`} />
      <g className="fx-needle" style={{ transform: `rotate(${150 + ((ready || reduced) ? fraction : 0) * 240}deg)` }}><path d="M80 80 H128" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></g>
      <circle cx="80" cy="80" r="5" fill="currentColor" />
      <text x="80" y="119" textAnchor="middle" fill="var(--ink)" fontSize={size ? '25' : '23'} fontWeight="800">{value === null ? '—' : `${formatAmount(Math.round(value * 10) / 10)}${!size ? '%' : ''}`}</text>
    </svg>
    <b>{label}</b>{detail && <small>{detail}</small>}
  </div>
}
