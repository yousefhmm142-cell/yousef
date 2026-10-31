import { useEffect, useId, useState, type KeyboardEvent, type ReactNode } from 'react'
import { cleanDecimalInput, formatAmount, parseDecimal } from '../lib/numbers'
import { Dialog } from './Dialog'
import { Button } from './primitives'

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

const pad = (n: number) => String(n).padStart(2, '0')
const HOURS = Array.from({ length: 24 }, (_, h) => h)
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5)

/** صباحاً / ظهراً / عصراً / مساءً / ليلاً for an hour of the day. */
export function partOfDay(h: number): string {
  if (h < 5) return 'ليلاً'
  if (h < 12) return 'صباحاً'
  if (h < 15) return 'ظهراً'
  if (h < 18) return 'عصراً'
  if (h < 22) return 'مساءً'
  return 'ليلاً'
}

/** "1432", "14:32", "14.32", "9" -> "14:32" / "09:00"; null when it is not a time. */
export function parseTyped(text: string): string | null {
  const t = text.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[^\d:.]/g, '')
  const m = /^(\d{1,2})(?:[:.]?(\d{2}))?$/.exec(t)
  if (!m) return null
  const h = Number(m[1])
  const mi = Number(m[2] ?? 0)
  return h < 24 && mi < 60 ? `${pad(h)}:${pad(mi)}` : null
}

/**
 * A clock time, 24-hour, written large with the part of the day under it. Tapping it opens hour
 * and minute buttons (one tap each), «الآن», and a box to type the exact minute.
 */
export function TimeField({ label, value, onChange }: { label: string; value: string; onChange(v: string): void }) {
  const [open, setOpen] = useState(false)
  const [h, m] = value ? value.split(':').map(Number) : [null, null]
  return (
    <>
      <button type="button" data-nav className={`time-btn${value ? '' : ' empty'}`} aria-label={value ? `${label}: ${value}` : label} onClick={() => setOpen(true)}>
        {value ? (
          <>
            <b className="num">{value}</b>
            <small>{partOfDay(h!)}</small>
          </>
        ) : (
          <span>اختر الوقت</span>
        )}
      </button>
      {open && <TimePicker label={label} hour={h} minute={m} onClose={() => setOpen(false)} onPick={(v) => { onChange(v); setOpen(false) }} />}
    </>
  )
}

function TimePicker({ label, hour, minute, onPick, onClose }: {
  label: string
  hour: number | null
  minute: number | null
  onPick(v: string): void
  onClose(): void
}) {
  const [h, setH] = useState<number | null>(hour)
  const [mi, setMi] = useState<number | null>(minute)
  const [typed, setTyped] = useState('')
  const typedTime = parseTyped(typed)
  const ready = typedTime ?? (h !== null ? `${pad(h)}:${pad(mi ?? 0)}` : null)
  const now = () => {
    const t = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Gaza' }).format(new Date())
    onPick(t)
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={label}
      footer={
        <>
          <Button variant="ghost" onClick={now}>الآن</Button>
          {hour !== null && <Button variant="ghost" onClick={() => onPick('')}>مسح</Button>}
          <Button variant="primary" disabled={!ready} onClick={() => ready && onPick(ready)}>
            {ready ? <>تم · <span className="num">{ready}</span></> : 'تم'}
          </Button>
        </>
      }
    >
      <div className="tp">
        <div className="tp-show num" aria-live="polite">
          <b>{ready ?? '--:--'}</b>
          {ready && <small>{partOfDay(Number(ready.slice(0, 2)))}</small>}
        </div>
        <span className="tp-label">الساعة</span>
        <div className="tp-grid hours" role="group" aria-label="الساعة">
          {HOURS.map((x) => (
            <button key={x} type="button" className="num" aria-pressed={h === x && !typedTime} onClick={() => { setH(x); setTyped('') }}>{pad(x)}</button>
          ))}
        </div>
        <span className="tp-label">الدقائق</span>
        <div className="tp-grid minutes" role="group" aria-label="الدقائق">
          {MINUTES.map((x) => (
            <button key={x} type="button" className="num" aria-pressed={(mi ?? 0) === x && h !== null && !typedTime} onClick={() => { setMi(x); setTyped('') }}>{pad(x)}</button>
          ))}
        </div>
        <label className="tp-type">
          <span>أو اكتب الوقت بالضبط</span>
          <input
            className="nf-input num ltr"
            inputMode="numeric"
            placeholder="14:32"
            aria-label="الوقت بالضبط"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && ready) onPick(ready) }}
          />
        </label>
      </div>
    </Dialog>
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
