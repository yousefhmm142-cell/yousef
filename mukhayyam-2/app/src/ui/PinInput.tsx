import { useState, type Ref } from 'react'
import { toLatinDigits } from '../lib/phone'

interface PinInputProps {
  value: string
  onChange(value: string): void
  /** Called once all digits are in, so the person never has to press a button. */
  onComplete?(value: string): void
  length?: number
  invalid?: boolean
  disabled?: boolean
  inputRef?: Ref<HTMLInputElement>
  id?: string
  describedBy?: string
}

/**
 * One real input under a row of boxes: the phone keyboard, paste and password managers all work,
 * and Arabic-Indic digits are accepted.
 */
export function PinInput({ value, onChange, onComplete, length = 6, invalid, disabled, inputRef, id, describedBy }: PinInputProps) {
  const [focused, setFocused] = useState(false)

  return (
    <div className="pin" dir="ltr" data-invalid={invalid || undefined} data-focused={focused || undefined}>
      <input
        ref={inputRef}
        id={id}
        className="pin-input"
        type="text"
        inputMode="numeric"
        autoComplete="current-password"
        pattern="[0-9]*"
        maxLength={length}
        value={value}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          const next = toLatinDigits(e.target.value).replace(/\D/g, '').slice(0, length)
          onChange(next)
          if (next.length === length && value.length !== length) onComplete?.(next)
        }}
      />
      {Array.from({ length }, (_, i) => (
        <span
          key={i}
          className="pin-box"
          data-filled={i < value.length || undefined}
          data-active={(focused && i === Math.min(value.length, length - 1)) || undefined}
          aria-hidden="true"
        />
      ))}
    </div>
  )
}
