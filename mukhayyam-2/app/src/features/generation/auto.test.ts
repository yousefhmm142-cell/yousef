import { describe, expect, it } from 'vitest'
import { computeAlerts } from './alerts'
import { applyAutoFigures, defaultAlertSettings, expectedConsumption, hoursFromRuns, newReport, type Generator } from './model'

const fuelTypes = [{ id: 1, name: 'سولار صناعي', isActive: true, sortOrder: 1 }]
const gens: Generator[] = [
  { id: 1, name: 'المولد 1', brand: 'Perkins', model: null, capacityKva: 500, litersPerHour: 60, isActive: true, sortOrder: 1 },
  { id: 2, name: 'المولد 2', brand: 'Cummins', model: null, capacityKva: 400, litersPerHour: 40, isActive: true, sortOrder: 2 },
]
const blank = (date: string) => newReport(date, fuelTypes, gens, 'op', null, `${date}T08:00:00Z`)

describe('worked-out report figures', () => {
  it('opening from yesterday, total and remaining by themselves', () => {
    const yesterday = blank('2026-10-29')
    yesterday.fuel[0]!.closingBalance = 3600
    const r = blank('2026-10-30')
    r.fuel[0]!.receivedQty = 2000
    r.fuel[0]!.consumption = 820
    applyAutoFigures(r, yesterday)
    expect(r.fuel[0]).toMatchObject({ openingBalance: 3600, totalQty: 5600, closingBalance: 4780 })
  })
  it('first report: the typed opening balance is kept', () => {
    const r = blank('2026-10-30')
    r.fuel[0]!.openingBalance = 2600
    applyAutoFigures(r, null)
    expect(r.fuel[0]).toMatchObject({ openingBalance: 2600, totalQty: 2600, closingBalance: null })
  })
  it('running hours from run times, past midnight too', () => {
    const r = blank('2026-10-30')
    r.generators[0]!.runs = [
      { id: 'a', runNo: 1, start: '06:00', end: '14:30' },
      { id: 'b', runNo: 2, start: '20:00', end: '01:00' },
    ]
    expect(hoursFromRuns(r.generators[0]!)).toBe(13.5)
    r.generators[1]!.didRun = false
    applyAutoFigures(r, null)
    expect(r.generators[0]!.runHours).toBe(13.5)
    expect(r.generators[1]!.runHours).toBeNull()
  })
  it('compares typed consumption with hours × liters per hour', () => {
    const r = blank('2026-10-30')
    r.generators[0]!.runs = [{ id: 'a', runNo: 1, start: '06:00', end: '16:00' }]
    r.generators[1]!.runs = [{ id: 'b', runNo: 1, start: '16:00', end: '21:00' }]
    r.fuel[0]!.consumption = 1100
    applyAutoFigures(r, null)
    const map = new Map(gens.map((g) => [g.id, g]))
    expect(expectedConsumption(r, map)).toBe(800) // 10 h × 60 + 5 h × 40
    const alert = computeAlerts(r, { history: [], generators: map, fuelNames: new Map([[1, 'سولار']]), settings: defaultAlertSettings })
      .find((a) => a.kind === 'expected_consumption')
    expect(alert?.level).toBe('danger')
    expect(alert?.title).toBe('الاستهلاك أعلى من المتوقع')
    r.fuel[0]!.consumption = 820
    expect(computeAlerts(r, { history: [], generators: map, fuelNames: new Map(), settings: defaultAlertSettings }).some((a) => a.kind === 'expected_consumption')).toBe(false)
  })
})
