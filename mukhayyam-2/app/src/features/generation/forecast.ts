import { addDays, type ISODate } from '../../lib/dates'
const average = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
import { reportTotals, type SiteReport } from './model'

// When will the diesel run out, and by when should it be ordered? (plan 2, L5)
// The daily use is the average of the last 7 reports; with 14 or more on record, each weekday has its
// own average (Friday is not like Sunday). The remaining figure is used up day by day from the report on.

export interface FuelForecast {
  /** The first day there is not enough for the whole day. */
  runOutDate: ISODate
  /** Two days before, to leave room for the delivery. */
  orderBy: ISODate
  /** Days of history the guess rests on. */
  basedOn: number
  /** Fewer than 3 days of history: say it is rough. */
  rough: boolean
  byWeekday: boolean
}

const MAX_DAYS = 120
const weekday = (d: ISODate) => new Date(`${d}T12:00:00Z`).getUTCDay()

/** @param history reports sent before this one, newest first (drafts left out). */
export function fuelForecast(report: SiteReport, history: SiteReport[]): FuelForecast | null {
  if (!report.fuel.some((f) => f.closingBalance !== null)) return null
  let left = reportTotals(report).remaining
  const days = [report, ...history].map((r) => ({ date: r.reportDate, use: reportTotals(r).consumption })).filter((d) => d.use > 0)
  if (!days.length) return null
  const recent = average(days.slice(0, 7).map((d) => d.use))
  const byWeekday = days.length >= 14
  const perDay = new Map<number, number>()
  if (byWeekday)
    for (let w = 0; w < 7; w++) {
      const same = days.filter((d) => weekday(d.date) === w).slice(0, 4).map((d) => d.use)
      perDay.set(w, same.length ? average(same) : recent)
    }
  let date = report.reportDate
  for (let i = 0; i < MAX_DAYS; i++) {
    date = addDays(date, 1)
    const use = byWeekday ? perDay.get(weekday(date))! : recent
    if (left < use) return { runOutDate: date, orderBy: addDays(date, -2), basedOn: days.length, rough: days.length < 3, byWeekday }
    left -= use
  }
  return null
}
