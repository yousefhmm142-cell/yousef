import { config } from '../config'
import { serverNow } from './clock'
import { formatLongDate, formatWeekday } from './format'

/** A calendar day in Gaza, written YYYY-MM-DD. */
export type ISODate = string

const isoFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: config.timeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export const toISODate = (d: Date): ISODate => isoFormat.format(d)

export const todayISO = (): ISODate => toISODate(serverNow())

/** Noon UTC falls on the same calendar day in Gaza all year, so it is safe for formatting. */
export const isoNoon = (iso: ISODate): Date => new Date(`${iso}T12:00:00Z`)

export function addDays(iso: ISODate, days: number): ISODate {
  const d = isoNoon(iso)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function isISODate(value: string | undefined): value is ISODate {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && toISODateSafe(value) === value
}

function toISODateSafe(value: string): string | null {
  const d = new Date(`${value}T12:00:00Z`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

/** "الخميس" and "29 أكتوبر 2026" for a calendar day. */
export function describeDay(iso: ISODate): { weekday: string; date: string } {
  const d = isoNoon(iso)
  return { weekday: formatWeekday(d), date: formatLongDate(d) }
}

/** "اليوم" / "أمس" / weekday name. */
export function dayName(iso: ISODate, today: ISODate = todayISO()): string {
  if (iso === today) return 'اليوم'
  if (iso === addDays(today, -1)) return 'أمس'
  return formatWeekday(isoNoon(iso))
}
