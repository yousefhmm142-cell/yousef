import { useEffect, useId, useState, type KeyboardEvent, type ReactNode } from 'react'
import { cleanDecimalInput, formatAmount, parseDecimal } from '../lib/numbers'

interface NumberFieldProps {
  label: string
  value: number | null
  onChange(value: number | null): void
  unit?: string
  hint?: ReactNode
  max?: number
  /** Allow a decimal point (temperatures, pressures, hours). */
  decimal?: boolean
  disabled?: boolean
  /** Hide the visible label (it is still read out). */
  bareLabel?: boolean
}

/** Number box: phone number pad, Arabic digits, thousands marks shown when not editing. */
export function NumberField({ label, value, onChange, unit, hint, max, decimal = true, disabled, bareLabel }: NumberFieldProps) {
  const id = useId()
  const [focused, setFocused] = useState(false)
  const [text, setText] = useState(value === null ? '' : String(value))

  useEffect(() => {
    if (!focused) setText(value === null ? '' : String(value))
  }, [value, focused])

  const tooBig = max !== undefined && value !== null && value > max
  return (
    <div className="nf" data-invalid={tooBig || undefined}>
      <label htmlFor={id} className={bareLabel ? 'sr-only' : undefined}>
        {label}
      </label>
      <div className="nf-box">
        <input
          id={id}
          data-nav
          className="nf-input num"
          inputMode={decimal ? 'decimal' : 'numeric'}
          enterKeyHint="next"
          autoComplete="off"
          disabled={disabled}
          aria-invalid={tooBig || undefined}
          value={focused ? text : value === null ? '' : formatAmount(value)}
          onFocus={(e) => {
            const box = e.currentTarget
            setFocused(true)
            setText(value === null ? '' : String(value))
            // Select the old figure so typing replaces it, but only if the person is still in this box:
            // selecting a box that lost focus would pull the cursor back into it.
            requestAnimationFrame(() => {
              if (document.activeElement === box) box.select()
            })
          }}
          onBlur={() => setFocused(false)}
          onChange={(e) => {
            const next = cleanDecimalInput(e.target.value)
            setText(next)
            onChange(parseDecimal(next))
          }}
        />
        {unit && <span className="nf-unit">{unit}</span>}
      </div>
      {tooBig ? <span className="field-error">أكبر من المعقول (الحد {formatAmount(max)})</span> : hint && <span className="field-hint">{hint}</span>}
    </div>
  )
}

interface TextFieldProps {
  label: string
  value: string
  onChange(value: string): void
  placeholder?: string
  numeric?: boolean
}

export function TextField({ label, value, onChange, placeholder, numeric }: TextFieldProps) {
  const id = useId()
  return (
    <div className="nf">
      <label htmlFor={id}>{label}</label>
      <div className="nf-box">
        <input
          id={id}
          data-nav
          className={`nf-input ${numeric ? 'num' : ''}`}
          inputMode={numeric ? 'numeric' : 'text'}
          enterKeyHint="next"
          autoComplete="off"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  )
}

export function TimeField({ label, value, onChange }: { label: string; value: string; onChange(v: string): void }) {
  return (
    <input
      type="time"
      data-nav
      className="time-input num"
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

interface SegmentedProps<T extends string> {
  label: string
  value: T
  options: ReadonlyArray<{ value: T; label: string }>
  onChange(value: T): void
}

export function Segmented<T extends string>({ label, value, options, onChange }: SegmentedProps<T>) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Chip({ pressed, onClick, children }: { pressed: boolean; onClick(): void; children: ReactNode }) {
  return (
    <button type="button" className="chip" aria-pressed={pressed} onClick={onClick}>
      {children}
    </button>
  )
}

/** Enter on a phone keyboard ("التالي") jumps to the next box in the same section. */
export function advanceOnEnter(e: KeyboardEvent<HTMLElement>) {
  const target = e.target as HTMLElement
  if (e.key !== 'Enter' || !target.matches('input[data-nav]')) return
  e.preventDefault()
  const boxes = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-nav]:not(:disabled)'))
  const next = boxes[boxes.indexOf(target) + 1]
  if (next) next.focus()
  else target.blur()
}

/** A figure the form works out by itself (greyed out, not typed). */
export function CalcField({ label, value, unit, hint }: { label: string; value: number | null; unit?: string; hint?: ReactNode }) {
  return (
    <div className="nf calc">
      <span className="nf-label">{label}</span>
      <div className="nf-box" aria-live="polite">
        <span className="nf-input num">{value === null ? '—' : formatAmount(value)}</span>
        {unit && <span className="nf-unit">{unit}</span>}
      </div>
      <span className="field-hint">{hint ?? 'يُحسب تلقائياً'}</span>
    </div>
  )
}
