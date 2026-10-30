import { describe, expect, it } from 'vitest'
import { addDays, isISODate } from './dates'
import { cleanDecimalInput, formatAmount, parseDecimal } from './numbers'
import { normalizePhone } from './phone'

describe('typed numbers', () => {
  it('reads Arabic-Indic digits', () => {
    expect(parseDecimal('٢٦٠٠')).toBe(2600)
  })
  it('treats commas as thousands marks, not decimals', () => {
    expect(parseDecimal('2,600')).toBe(2600)
    expect(parseDecimal('٢٬٦٠٠')).toBe(2600)
  })
  it('accepts the Arabic decimal mark and a dot', () => {
    expect(parseDecimal('1٫8')).toBe(1.8)
    expect(parseDecimal('3.75')).toBe(3.75)
    expect(parseDecimal('.5')).toBe(0.5)
  })
  it('returns null for an empty box', () => {
    expect(parseDecimal('')).toBeNull()
    expect(parseDecimal('لتر')).toBeNull()
    expect(parseDecimal('.')).toBeNull()
  })
  it('keeps a half-typed decimal editable and drops a second dot', () => {
    expect(cleanDecimalInput('12.')).toBe('12.')
    expect(cleanDecimalInput('1.2.3')).toBe('1.23')
  })
  it('formats with thousands marks', () => {
    expect(formatAmount(1240)).toBe('1,240')
    expect(formatAmount(null)).toBe('—')
  })
})

describe('phone numbers', () => {
  it('normalises common ways of writing a Gaza mobile', () => {
    expect(normalizePhone('059 912 3456')).toBe('0599123456')
    expect(normalizePhone('+970599123456')).toBe('0599123456')
    expect(normalizePhone('00972599123456')).toBe('0599123456')
    expect(normalizePhone('٠٥٩٩١٢٣٤٥٦')).toBe('0599123456')
    expect(normalizePhone('599123456')).toBe('0599123456')
  })
})

describe('calendar days', () => {
  it('moves across months and years', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31')
  })
  it('rejects impossible dates', () => {
    expect(isISODate('2026-10-29')).toBe(true)
    expect(isISODate('2026-02-30')).toBe(false)
    expect(isISODate('29-10-2026')).toBe(false)
  })
})
