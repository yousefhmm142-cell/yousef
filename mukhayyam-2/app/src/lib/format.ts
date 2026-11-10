import { config } from '../config'

// Arabic words with Latin digits, Gregorian months (أكتوبر), Gaza time.
const locale = 'ar-EG-u-nu-latn-ca-gregory'
const timeZone = config.timeZone

const weekday = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone })
const longDate = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone })
const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', hour12: true, timeZone })
const hour24 = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone })
const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 })

export const formatWeekday = (d: Date) => weekday.format(d)
export const formatLongDate = (d: Date) => longDate.format(d)
export const formatTime = (d: Date) => time.format(d)

/** A stored clock time "14:30" shown the 12-hour way: "2:30 م" ("" when empty). */
export function clock12(hhmm: string | null | undefined): string {
  if (!hhmm) return ''
  const [h, m] = hhmm.split(':').map(Number)
  if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) return hhmm
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'ص' : 'م'}`
}
export const formatNumber = (n: number) => number.format(n)

export function greeting(d: Date): string {
  const h = Number(hour24.format(d))
  return h >= 4 && h < 12 ? 'صباح الخير' : 'مساء الخير'
}

export const firstName = (fullName: string) => fullName.trim().split(/\s+/)[0] ?? fullName

export const initial = (fullName: string) => Array.from(fullName.trim())[0] ?? '؟'
