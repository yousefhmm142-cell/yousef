const average = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
import { reportTotals, toBar, type Generator, type SiteReport } from './model'

// Is a generator getting worse little by little? (plan 2, L6) Each day alone looks fine; the trend
// over weeks does not. Only figures typed on site are used, and nothing is said without enough days.
//  · Diesel per running hour: only from days it ran ALONE (otherwise nobody knows which one used what);
//    the last 7 such days against the 7 before. 10% more = «صار يصرف أكثر».
//  · Temperature and oil pressure: the last 7 days it ran against the 7 before (+5°C, −0.3 bar).

export type Trend = 'worse' | 'same' | 'better' | 'unknown'

export interface GeneratorHealth {
  generatorId: number
  name: string
  /** Liters per running hour now and before; null when there are too few days alone. */
  burn: { now: number; before: number; rated: number | null; trend: Trend } | null
  burnDaysAlone: number
  temp: { now: number; before: number; trend: Trend } | null
  oil: { now: number; before: number; trend: Trend } | null
}

const WINDOW = 7
const MIN_ALONE = 4
const r1 = (n: number) => Math.round(n * 10) / 10

function compare(values: number[], worseIf: (now: number, before: number) => boolean, betterIf: (now: number, before: number) => boolean) {
  // values: newest first
  const now = values.slice(0, WINDOW)
  const before = values.slice(WINDOW, WINDOW * 2)
  if (now.length < 3 || before.length < 3) return null
  const a = average(now), b = average(before)
  return { now: r1(a), before: r1(b), trend: (worseIf(a, b) ? 'worse' : betterIf(a, b) ? 'better' : 'same') as Trend }
}

/** @param reports the last reports sent (any order); the newest 30 count. */
export function generatorHealth(reports: SiteReport[], generators: Generator[]): GeneratorHealth[] {
  const recent = [...reports].filter((r) => r.status !== 'draft').sort((a, b) => b.reportDate.localeCompare(a.reportDate)).slice(0, 30)
  return generators
    .filter((g) => g.isActive && recent.some((r) => r.generators.some((l) => l.generatorId === g.id && l.didRun)))
    .map((g) => {
      const alone = recent.filter((r) => {
        const ran = r.generators.filter((l) => l.didRun)
        return ran.length === 1 && ran[0]!.generatorId === g.id && (ran[0]!.runHours ?? 0) > 0 && reportTotals(r).consumption > 0
      })
      const perHour = alone.map((r) => reportTotals(r).consumption / r.generators.find((l) => l.generatorId === g.id)!.runHours!)
      const burn = alone.length >= MIN_ALONE ? compare(perHour, (n, b) => n > b * 1.1, (n, b) => n < b * 0.9) : null
      const logs = recent.flatMap((r) => r.generators.filter((l) => l.generatorId === g.id && l.didRun))
      const temps = logs.map((l) => l.temperatureC).filter((v): v is number => v !== null)
      const oils = logs.filter((l) => l.oilPressure !== null).map((l) => toBar(l.oilPressure!, l.oilPressureUnit))
      return {
        generatorId: g.id,
        name: g.name,
        burn: burn ? { ...burn, rated: g.litersPerHour } : null,
        burnDaysAlone: alone.length,
        temp: compare(temps, (n, b) => n >= b + 5, (n, b) => n <= b - 5),
        oil: compare(oils, (n, b) => n <= b - 0.3, (n, b) => n >= b + 0.3),
      }
    })
}
