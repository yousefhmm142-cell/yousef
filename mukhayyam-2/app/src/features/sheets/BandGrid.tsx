import { useEffect, useState, type KeyboardEvent } from 'react'
import { cleanDecimalInput, formatAmount, parseDecimal } from '../../lib/numbers'
import { BANDS } from './loads'

// The paper's loads table, to type into: one column for each hour band (9 · 12 · 3 · 6 · 9 · 12) and the
// readings of that band stacked in it. Built for fast typing:
//  · Enter (or the phone's «التالي») goes to the next box: down the band, then on to the next hour.
//  · The arrows move around: ← → between hours (the next hour is on the left, as on the paper), ↑ ↓ inside an hour.
//  · The box is selected when reached, so typing replaces what was there; an empty one stays a dash.

interface BandGridProps {
  /** How many readings in every band (3 for a zone, 1 for a generator). */
  rows: number
  /** [band][row] */
  values: ReadonlyArray<ReadonlyArray<number | null>>
  onChange(band: number, row: number, value: number | null): void
  max?: number
  /** A row under the bands with the mean of each one, shown once all its readings are typed. */
  average?: ReadonlyArray<number | null>
  unit?: string
  /** What the boxes are called for a screen reader, e.g. the zone or generator. */
  name: string
}

export function BandGrid({ rows, values, onChange, max, average, unit, name }: BandGridProps) {
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const t = e.target as HTMLInputElement
    if (!t.matches?.('input[data-bg-b]')) return
    const b = Number(t.dataset.bgB)
    const r = Number(t.dataset.bgR)
    // On the paper the first hour is on the right, so the next hour is to the left.
    const to =
      e.key === 'ArrowLeft' ? [b + 1, r] : e.key === 'ArrowRight' ? [b - 1, r] : e.key === 'ArrowDown' ? [b, r + 1] : e.key === 'ArrowUp' ? [b, r - 1] : null
    if (!to) return
    const next = e.currentTarget.querySelector<HTMLInputElement>(`input[data-bg-b="${to[0]}"][data-bg-r="${to[1]}"]`)
    if (!next) return
    e.preventDefault()
    next.focus()
  }

  return (
    <div className="bg" onKeyDown={onKeyDown} role="group" aria-label={`الأحمال حسب الساعة: ${name}`}>
      {/* Heads first, then the boxes hour by hour (this is the order Enter and Tab follow). */}
      {BANDS.map((band, b) => (
        <div key={`h${b}`} className="bg-h" style={{ gridColumn: b + 1, gridRow: 1 }}>
          <b className="num">{band.label}</b>
          <small className="num" dir="ltr">{band.range}</small>
        </div>
      ))}
      {BANDS.flatMap((band, b) =>
        Array.from({ length: rows }, (_, r) => (
          <BandCell
            key={`${b}-${r}`}
            band={b}
            row={r}
            col={b + 1}
            gridRow={r + 2}
            value={values[b]?.[r] ?? null}
            max={max}
            label={`${name}، الساعة ${band.range}${rows > 1 ? `، القراءة ${r + 1}` : ''}`}
            onChange={(v) => onChange(b, r, v)}
          />
        )),
      )}
      {average &&
        BANDS.map((band, b) => (
          <div key={`a${b}`} className="bg-avg" style={{ gridColumn: b + 1, gridRow: rows + 2 }} aria-label={`متوسط الساعة ${band.range}`}>
            {average[b] === null || average[b] === undefined ? <span className="bg-dash">—</span> : <b className="num">{formatAmount(average[b]!)}</b>}
          </div>
        ))}
      {average && <p className="bg-cap" style={{ gridColumn: '1 / -1', gridRow: rows + 3 }}>الصف الأخير: المتوسط الحسابي للقراءات الثلاثة{unit ? ` (${unit})` : ''}</p>}
    </div>
  )
}

function BandCell({ band, row, col, gridRow, value, max, label, onChange }: { band: number; row: number; col: number; gridRow: number; value: number | null; max?: number; label: string; onChange(v: number | null): void }) {
  const [focused, setFocused] = useState(false)
  const [text, setText] = useState(value === null ? '' : String(value))
  useEffect(() => {
    if (!focused) setText(value === null ? '' : String(value))
  }, [value, focused])
  const tooBig = max !== undefined && value !== null && value > max
  return (
    <input
      data-nav
      data-bg-b={band}
      data-bg-r={row}
      className="bg-in num"
      data-filled={value !== null || undefined}
      aria-invalid={tooBig || undefined}
      aria-label={label}
      style={{ gridColumn: col, gridRow }}
      inputMode="decimal"
      enterKeyHint="next"
      autoComplete="off"
      placeholder="—"
      value={focused ? text : value === null ? '' : formatAmount(value)}
      onFocus={(e) => {
        const box = e.currentTarget
        const start = value === null ? '' : String(value)
        setFocused(true)
        setText(start)
        // Selected at once (typing right after Enter replaces the old figure), and again a moment later for
        // phones, which drop the selection when the finger lifts; never once something new was typed.
        box.select()
        requestAnimationFrame(() => {
          if (document.activeElement === box && box.value === start) box.select()
        })
      }}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        const next = cleanDecimalInput(e.target.value)
        setText(next)
        onChange(parseDecimal(next))
      }}
    />
  )
}
