import { useEffect, useId, useState } from 'react'
import { usePageVisible, useReducedMotion } from '../../lib/motion'
export function FuelTank({ days, warn, danger }: { days: number | null; warn: number; danger: number }) {
  const visible = usePageVisible()
  const reduced = useReducedMotion()
  const [ready, setReady] = useState(false)
  const id = useId().replace(/:/g, '')
  useEffect(() => { const raf = requestAnimationFrame(() => setReady(true)); return () => cancelAnimationFrame(raf) }, [])
  const level = days === null ? 0 : Math.max(0, Math.min(1, days / 30))
  const tone = days === null ? 'muted' : days < danger ? 'danger' : days < warn ? 'warn' : 'fuel'
  return <svg className="fx-fuel" viewBox="0 0 80 124" aria-hidden="true" data-tone={tone} data-paused={!visible || undefined}>
    <defs><clipPath id={id}><rect x="12" y="12" width="56" height="104" rx="13" /></clipPath></defs>
    <rect x="28" y="3" width="24" height="9" rx="3" fill="currentColor" opacity=".5" />
    <rect x="12" y="12" width="56" height="104" rx="13" fill="var(--sunken)" stroke="currentColor" strokeWidth="2" strokeDasharray={days === null ? '4 4' : undefined} />
    <g clipPath={`url(#${id})`}><g className="fx-fuel-fill" style={{ transform: `translateY(${104 * (1 - ((ready || reduced) ? level : 0))}px)` }}>
      <rect x="12" y="20" width="56" height="110" fill="currentColor" opacity=".75" />
      <path className="fx-fuel-wave" d="M-44 20 Q-30 10 -16 20 T12 20 T40 20 T68 20 T96 20 T124 20 V130 H-44Z" fill="currentColor" />
    </g></g>
    {[38,64,90].map(y => <path key={y} d={`M17 ${y} h8`} stroke="var(--ink)" opacity=".4" />)}
  </svg>
}
