import { useEffect, useRef, useState } from 'react'
import { formatAmount } from '../../lib/numbers'
import { usePageVisible, useReducedMotion } from '../../lib/motion'

/** Finite animation; a refresh with an unchanged value never restarts it. */
export function CountUp({ value, decimals = 2 }: { value: number | null | undefined; decimals?: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const last = useRef(0)
  const started = useRef(false)
  const [seen, setSeen] = useState(false)
  const [shown, setShown] = useState(value)
  const reduced = useReducedMotion()
  const visible = usePageVisible()
  useEffect(() => {
    const el = ref.current
    if (!el || seen) return
    if (!('IntersectionObserver' in window)) { setSeen(true); return }
    const io = new IntersectionObserver(([entry]) => { if (entry?.isIntersecting) { setSeen(true); io.disconnect() } })
    io.observe(el)
    return () => io.disconnect()
  }, [seen])
  useEffect(() => {
    if (!seen) return
    if (value == null || reduced || !visible) { setShown(value); last.current = value ?? 0; return }
    const from = last.current
    const duration = started.current ? 300 : 600
    started.current = true
    let frame = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const next = from + (value - from) * (1 - Math.pow(1 - t, 3))
      last.current = next
      setShown(t === 1 ? value : Number(next.toFixed(decimals)))
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value, decimals, seen, reduced, visible])
  return <span ref={ref} className="num fx-count" aria-label={formatAmount(value)}><span aria-hidden="true">{formatAmount(!seen || reduced || !visible ? value : shown)}</span></span>
}
