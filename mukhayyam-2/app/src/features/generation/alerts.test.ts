import { describe, expect, it } from 'vitest'
import { computeAlerts, consumptionStats, fuelOutlook, hoursSinceOilChange } from './alerts'
import { defaultAlertSettings, loadKva, missingItems, newReport, reconcileReport, toBar, type Generator, type SiteReport } from './model'

const generators: Generator[] = [
  { id: 1, name: 'المولد 1', brand: 'Perkins', model: null, capacityKva: 500, litersPerHour: null, isActive: true, sortOrder: 1 },
  { id: 2, name: 'المولد 2', brand: 'Cummins', model: null, capacityKva: 400, litersPerHour: null, isActive: true, sortOrder: 2 },
]
const fuelTypes = [
  { id: 1, name: 'سولار صناعي', isActive: true, sortOrder: 1 },
  { id: 2, name: 'سولار إسرائيلي', isActive: true, sortOrder: 2 },
]

function report(date: string, consumption: [number, number], closing: [number, number], opening: [number, number] = [0, 0]): SiteReport {
  const r = newReport(date, fuelTypes, generators, 'e1', null, '2026-01-01T00:00:00Z')
  r.status = 'approved'
  r.fuel.forEach((f, i) => {
    f.consumption = consumption[i] ?? null
    f.closingBalance = closing[i] ?? null
    f.openingBalance = opening[i] ?? null
  })
  r.generators.forEach((g) => {
    g.runHours = 10
    g.loads = [300, 300, 300]
    g.temperatureC = 85
    g.oilPressure = 4
  })
  return r
}

const ctx = (history: SiteReport[]) => ({
  history,
  generators: new Map(generators.map((g) => [g.id, g])),
  fuelNames: new Map(fuelTypes.map((f) => [f.id, f.name])),
  settings: defaultAlertSettings,
})

// Seven ordinary days at 1,000 litres a day, newest first.
const week = Array.from({ length: 7 }, (_, i) => report(`2026-10-${String(28 - i).padStart(2, '0')}`, [800, 200], [3000, 600]))

describe('consumption', () => {
  it('compares today with the average of the last seven reports', () => {
    const today = report('2026-10-29', [1000, 240], [2000, 360], [3000, 600])
    const stats = consumptionStats(today, week)
    expect(stats.average).toBe(1000)
    expect(Math.round(stats.changePct!)).toBe(24)
    expect(stats.series).toHaveLength(7)
    const alert = computeAlerts(today, ctx(week)).find((a) => a.kind === 'consumption')
    expect(alert?.level).toBe('warn')
    expect(alert?.title).toContain('24%')
  })
  it('stays quiet with fewer than three days of history', () => {
    const today = report('2026-10-29', [2000, 500], [2000, 360])
    expect(computeAlerts(today, ctx(week.slice(0, 2))).some((a) => a.kind === 'consumption')).toBe(false)
  })
})

describe('fuel days left', () => {
  it('warns under two days and is critical under one', () => {
    const low = report('2026-10-29', [800, 200], [1200, 300], [3000, 600])
    expect(fuelOutlook(low, week).days).toBeCloseTo(1.5)
    expect(computeAlerts(low, ctx(week)).find((a) => a.kind === 'fuel_days')?.level).toBe('warn')
    const empty = report('2026-10-29', [800, 200], [500, 100], [3000, 600])
    expect(computeAlerts(empty, ctx(week)).find((a) => a.kind === 'fuel_days')?.level).toBe('danger')
  })
  it('says nothing before the remaining balance is typed', () => {
    const blank = newReport('2026-10-29', fuelTypes, generators, 'e1', null, '')
    expect(fuelOutlook(blank, week).days).toBeNull()
  })
})

describe('balance check', () => {
  it('flags an opening balance that differs from the last closing balance', () => {
    const today = report('2026-10-29', [800, 200], [3000, 600], [2950, 600])
    const mismatch = computeAlerts(today, ctx(week)).filter((a) => a.kind === 'balance_mismatch')
    expect(mismatch).toHaveLength(1)
    expect(mismatch[0]!.level).toBe('danger')
  })
})

describe('generator readings', () => {
  it('converts psi to bar before comparing oil pressure', () => {
    expect(toBar(29, 'psi')).toBeCloseTo(2, 1)
    const today = report('2026-10-29', [800, 200], [3000, 600], [3000, 600])
    today.generators[1]!.oilPressure = 1.8
    today.generators[0]!.oilPressure = 21
    today.generators[0]!.oilPressureUnit = 'psi'
    const oil = computeAlerts(today, ctx(week)).filter((a) => a.kind === 'oil_pressure')
    expect(oil.map((a) => a.level).sort()).toEqual(['danger', 'warn'])
  })
  it('works out load from amps or kW', () => {
    expect(loadKva([410, 395, 402], 'A', 230)).toBeCloseTo(277.6, 1)
    expect(loadKva([100, 100, 120], 'kW', 230)).toBe(400)
    expect(loadKva([100, null, 120], 'A', 230)).toBeNull()
  })
  it('warns at high load and phase imbalance', () => {
    const today = report('2026-10-29', [800, 200], [3000, 600], [3000, 600])
    today.generators[1]!.loads = [520, 400, 530] // ~334 kVA of 400 = 83%, gap 25%
    const alerts = computeAlerts(today, ctx(week))
    expect(alerts.find((a) => a.kind === 'load')?.level).toBe('warn')
    expect(alerts.find((a) => a.kind === 'imbalance')?.level).toBe('warn')
  })
  it('ignores a generator that did not run', () => {
    const today = report('2026-10-29', [800, 200], [3000, 600], [3000, 600])
    today.generators[1]!.didRun = false
    today.generators[1]!.temperatureC = 120
    expect(computeAlerts(today, ctx(week)).some((a) => a.kind === 'temperature')).toBe(false)
  })
})

describe('oil change', () => {
  it('counts running hours back to the last oil change', () => {
    const history = Array.from({ length: 25 }, (_, i) => report(`2026-09-${String(28 - i).padStart(2, '0')}`, [800, 200], [3000, 600]))
    history[23]!.maintenance.push({ id: 'm', generatorId: 1, oilNewLiters: 18, oilUsedLiters: 16, types: ['oil_change'], description: '' })
    const today = report('2026-09-29', [800, 200], [3000, 600], [3000, 600])
    expect(hoursSinceOilChange(1, today, history)).toBe(240)
    expect(hoursSinceOilChange(2, today, history)).toBeNull()
    const alert = computeAlerts(today, ctx(history)).find((a) => a.kind === 'oil_change')
    expect(alert?.level).toBe('warn')
  })
})

describe('open drafts', () => {
  it('gain a generator added later, and keep what was typed', () => {
    const draft = newReport('2026-10-29', fuelTypes, generators.slice(0, 1), 'e1', null, '')
    draft.generators[0]!.runHours = 9
    const next = reconcileReport(draft, fuelTypes, generators)
    expect(next.generators.map((g) => g.generatorId)).toEqual([1, 2])
    expect(next.generators[0]!.runHours).toBe(9)
    expect(reconcileReport(next, fuelTypes, generators)).toBe(next)
  })
})

describe('before sending', () => {
  it('lists what is still empty in plain words', () => {
    const blank = newReport('2026-10-29', fuelTypes, generators, 'e1', null, '')
    const items = missingItems(blank, (id) => fuelTypes.find((f) => f.id === id)!.name, (id) => generators.find((g) => g.id === id)!.name)
    expect(items).toContain('سولار صناعي: الرصيد الموجود')
    expect(items).toContain('سولار صناعي: الاستهلاك')
    expect(items).toContain('المولد 1: أوقات التشغيل')
  })
})
