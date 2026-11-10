import { toLatinDigits } from './phone'

/**
 * Cleans what someone types into a number box, keeping it editable:
 * Arabic digits become 0-9, "٫" and "." are the decimal point, "," "٬" "،" are thousands marks and dropped.
 */
export function cleanDecimalInput(input: string): string {
  const s = toLatinDigits(input)
    .replace(/[٬,،\s]/g, '')
    .replace(/٫/g, '.')
    .replace(/[^\d.]/g, '')
  const dot = s.indexOf('.')
  return dot === -1 ? s : s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '')
}

/** The number in a typed value, or null when the box is empty. */
export function parseDecimal(input: string): number | null {
  const s = cleanDecimalInput(input)
  if (s === '' || s === '.') return null
  const n = Number(s.startsWith('.') ? `0${s}` : s)
  return Number.isFinite(n) ? n : null
}

const grouped = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })

/** 2600 -> "2,600", null -> "—" */
export function formatAmount(n: number | null | undefined): string {
  return n === null || n === undefined ? '—' : grouped.format(n)
}

export const sum = (values: Array<number | null | undefined>): number =>
  values.reduce<number>((acc, v) => acc + (v ?? 0), 0)

export function average(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
}
