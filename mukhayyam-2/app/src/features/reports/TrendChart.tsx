import { useState } from 'react'
import { describeDay, todayISO } from '../../lib/dates'
import { formatAmount } from '../../lib/numbers'
import type { DayPoint } from './build'

// One measure, day by day, as thin bars from the baseline (one series: the title names it, no legend).
// The dashed line is the average of the days that have a value. Hover or tap a day for its figure.

export function TrendChart({ title, unit, points, empty }: { title: string; unit: string; points: DayPoint[]; empty: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const values = points.map((p) => p.value).filter((v): v is number => v !== null)
  if (!values.length) return <section className="card trend"><div className="card-h"><h2>{title}</h2></div><p className="card-empty">{empty}</p></section>
  const max = Math.max(...values) || 1
  const avg = values.reduce((a, b) => a + b, 0) / values.length
  const W = 100 / points.length
  // Thin bars: never wider than a few percent of the plot, whatever the number of days.
  const bw = Math.min(W * 0.6, 3.2)
  const shown = hover !== null ? points[hover]! : null
  const today = todayISO()
  // The value is written above the highest bar only (the rest show on hover or tap).
  const top = points.reduce((best, p, i) => (p.value !== null && (best < 0 || p.value > points[best]!.value!) ? i : best), -1)
  return (
    <section className="card trend">
      <div className="card-h">
        <h2>{title}</h2>
        <span className="meta num">{shown ? `${describeDay(shown.date).weekday} ${describeDay(shown.date).date.replace(/ \d{4}$/, '')}: ${shown.value === null ? 'ما في' : `${formatAmount(shown.value)} ${unit}`}` : `المتوسط ${formatAmount(Math.round(avg * 10) / 10)} ${unit} · الأعلى ${formatAmount(max)}`}</span>
      </div>
      <div className="trend-plot" role="img" aria-label={`${title}: المتوسط ${Math.round(avg)} ${unit}، الأعلى ${max}`} onMouseLeave={() => setHover(null)}>
        <svg viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true">
          <line x1="0" x2="100" y1="60" y2="60" className="trend-base" />
          <line x1="0" x2="100" y1={60 - (avg / max) * 56} y2={60 - (avg / max) * 56} className="trend-avg" />
          {points.map((p, i) => {
            const h = p.value === null ? 0 : Math.max(0.8, (p.value / max) * 56)
            // Right to left, like the pages: the first day on the right.
            const x = (points.length - 1 - i) * W
            return (
              <g key={p.date} onMouseEnter={() => setHover(i)} onClick={() => setHover(i)}>
                <rect x={x} y="0" width={W} height="60" fill="transparent" />
                {p.value !== null && <rect x={x + (W - bw) / 2} y={60 - h} width={bw} height={h} rx="0.6" className="trend-bar" data-on={hover === i || undefined} data-today={p.date === today || undefined} />}
              </g>
            )
          })}
        </svg>
        {top >= 0 && (
          <span className="trend-top num" aria-hidden="true" style={{ left: `${((points.length - 1 - top) + 0.5) * W}%`, bottom: `${Math.round((points[top]!.value! / max) * (56 / 60) * 150) + 40}px` }}>
            {formatAmount(points[top]!.value!)}
          </span>
        )}
        <div className="trend-axis num" aria-hidden="true">
          <span>{describeDay(points[0]!.date).date.replace(/ \d{4}$/, '')}</span>
          <span>{describeDay(points[points.length - 1]!.date).date.replace(/ \d{4}$/, '')}</span>
        </div>
      </div>
    </section>
  )
}
