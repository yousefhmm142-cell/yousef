import { describe, expect, it } from 'vitest'
import { addDays } from '../../lib/dates'
import { fuelForecast } from './forecast'
import { generatorHealth } from './health'
import type { Generator, SiteReport } from './model'

const rep = (reportDate: string, use: number, closing: number | null = null, gens: Array<[number, number, number?, number?]> = [[1, 10]]) =>
  ({
    reportDate, status: 'approved',
    fuel: [{ fuelTypeId: 1, consumption: use, closingBalance: closing, receivedQty: 0 }],
    generators: gens.map(([generatorId, runHours, temperatureC, oilPressure]) => ({ generatorId, didRun: true, runHours, temperatureC: temperatureC ?? null, oilPressure: oilPressure ?? null, oilPressureUnit: 'bar' })),
  }) as unknown as SiteReport
const back = (from: string, n: number, use: (i: number, date: string) => number) => Array.from({ length: n }, (_, i) => { const d = addDays(from, -(i + 1)); return rep(d, use(i, d)) })

describe('fuel forecast', () => {
  it('runs out on the day the rest is not enough, order two days before', () => {
    const f = fuelForecast(rep('2026-11-12', 1000, 2500), back('2026-11-12', 5, () => 1000))!
    expect(f.runOutDate).toBe('2026-11-15') // 13th: 1500 left, 14th: 500 left, 15th: not enough
    expect(f.orderBy).toBe('2026-11-13')
    expect(f.rough).toBe(false)
    expect(f.byWeekday).toBe(false)
  })
  it('uses each weekday when there are two weeks or more', () => {
    // Fridays (2026-11-13 is a Friday) use 3000, other days 500.
    const isFri = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay() === 5
    const history = back('2026-11-12', 20, (_, d) => (isFri(d) ? 3000 : 500))
    const f = fuelForecast(rep('2026-11-12', 500, 2000), history)!
    expect(f.byWeekday).toBe(true)
    expect(f.runOutDate).toBe('2026-11-13') // Friday needs 3000, there are 2000
  })
  it('is null without figures, and rough with little history', () => {
    expect(fuelForecast(rep('2026-11-12', 1000, null), [])).toBeNull()
    expect(fuelForecast(rep('2026-11-12', 0, 5000), [])).toBeNull()
    expect(fuelForecast(rep('2026-11-12', 1000, 5000), [])!.rough).toBe(true)
  })
})

describe('generator health', () => {
  const g = (id: number): Generator => ({ id, name: `المولد ${id}`, brand: '', model: null, capacityKva: 500, litersPerHour: 80, isActive: true, sortOrder: id })
  it('says it burns more, from days it ran alone only', () => {
    const now = Array.from({ length: 7 }, (_, i) => rep(addDays('2026-11-12', -i), 1000, null, [[1, 10]])) // 100 l/h
    const before = Array.from({ length: 7 }, (_, i) => rep(addDays('2026-11-05', -i), 800, null, [[1, 10]])) // 80 l/h
    const shared = Array.from({ length: 5 }, (_, i) => rep(addDays('2026-10-25', -i), 5000, null, [[1, 10], [2, 10]]))
    const [h] = generatorHealth([...now, ...before, ...shared], [g(1)])
    expect(h!.burn).toEqual({ now: 100, before: 80, rated: 80, trend: 'worse' })
    expect(h!.burnDaysAlone).toBe(14)
  })
  it('watches temperature and oil pressure over time', () => {
    const now = Array.from({ length: 7 }, (_, i) => rep(addDays('2026-11-12', -i), 0, null, [[1, 10, 96, 2.0]]))
    const before = Array.from({ length: 7 }, (_, i) => rep(addDays('2026-11-05', -i), 0, null, [[1, 10, 90, 2.5]]))
    const [h] = generatorHealth([...now, ...before], [g(1)])
    expect(h!.temp!.trend).toBe('worse')
    expect(h!.oil!.trend).toBe('worse')
  })
  it('says nothing about burn with fewer than four days alone', () => {
    const shared = Array.from({ length: 10 }, (_, i) => rep(addDays('2026-11-12', -i), 2000, null, [[1, 10], [2, 10]]))
    const alone = Array.from({ length: 3 }, (_, i) => rep(addDays('2026-10-30', -i), 900, null, [[1, 10]]))
    const [h] = generatorHealth([...shared, ...alone], [g(1), g(2)])
    expect(h!.burn).toBeNull()
    expect(h!.burnDaysAlone).toBe(3)
  })
})
