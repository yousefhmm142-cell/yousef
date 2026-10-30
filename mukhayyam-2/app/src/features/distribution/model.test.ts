import { describe, expect, it } from 'vitest'
import { defaultAlertSettings } from '../generation/model'
import { phaseImbalancePct } from '../sheets/loads'
import { computeZoneAlerts } from './alerts'
import { missingInZone, newSheet, reconcileSheet, runSegments, sheetTotals, type Zone } from './model'

const zones: Zone[] = [
  { id: 1, name: 'المخيم القديم', isActive: true, sortOrder: 1 },
  { id: 2, name: 'الرازي', isActive: true, sortOrder: 2 },
  { id: 3, name: 'منطقة موقوفة', isActive: false, sortOrder: 3 },
]
const names = new Map(zones.map((z) => [z.id, z.name]))

describe('a new sheet', () => {
  it('lists every active zone with one empty run', () => {
    const s = newSheet('2026-10-30', zones, 'e1', null, '')
    expect(s.zones.map((z) => z.zoneId)).toEqual([1, 2])
    expect(s.zones[0]!.runs).toHaveLength(1)
    expect(s.status).toBe('draft')
  })
  it('keeps the load unit from the last sheet, never its figures', () => {
    const prev = newSheet('2026-10-29', zones, 'e1', null, '')
    prev.zones[1]!.runs[0]!.loadUnit = 'kW'
    prev.zones[1]!.supplyHours = 7
    const s = newSheet('2026-10-30', zones, 'e1', prev, '')
    expect(s.zones[1]!.runs[0]!.loadUnit).toBe('kW')
    expect(s.zones[1]!.supplyHours).toBeNull()
  })
  it('gains a zone switched on later and keeps what was typed', () => {
    const s = newSheet('2026-10-30', zones.slice(0, 1), 'e1', null, '')
    s.zones[0]!.supplyHours = 6
    const next = reconcileSheet(s, zones)
    expect(next.zones.map((z) => z.zoneId)).toEqual([1, 2])
    expect(next.zones[0]!.supplyHours).toBe(6)
    expect(reconcileSheet(next, zones)).toBe(next)
  })
})

describe('what is missing', () => {
  it('asks for hours, times and loads of a supplied zone only', () => {
    const s = newSheet('2026-10-30', zones, 'e1', null, '')
    expect(missingInZone(s.zones[0]!)).toEqual(['عدد الساعات', 'وقت التشغيلة الأولى', 'أحمال التشغيلة الأولى'])
    s.zones[0]!.supplied = false
    expect(missingInZone(s.zones[0]!)).toEqual([])
  })
})

describe('the day bar', () => {
  it('splits a run that goes past midnight', () => {
    expect(runSegments({ start: '20:00', end: '01:00' })).toEqual([[1200, 1440], [0, 60]])
    expect(runSegments({ start: '06:00', end: '09:30' })).toEqual([[360, 570]])
    expect(runSegments({ start: '', end: '09:00' })).toEqual([])
  })
})

describe('totals and alerts', () => {
  it('adds hours of supplied zones and counts runs', () => {
    const s = newSheet('2026-10-30', zones, 'e1', null, '')
    s.zones[0]!.supplyHours = 6
    s.zones[0]!.runs[0]!.start = '06:00'
    s.zones[1]!.supplied = false
    s.zones[1]!.supplyHours = 9
    expect(sheetTotals(s)).toEqual({ totalHours: 6, suppliedZones: 1, runs: 1 })
  })
  it('flags phase imbalance and a zone without power', () => {
    expect(phaseImbalancePct([140, 95, 132])).toBeCloseTo(32.1, 1)
    const s = newSheet('2026-10-30', zones, 'e1', null, '')
    s.zones[0]!.runs[0]!.loads = [140, 95, 132]
    s.zones[1]!.supplied = false
    const alerts = computeZoneAlerts(s, names, defaultAlertSettings)
    expect(alerts.map((a) => a.level)).toEqual(['warn', 'warn'])
    expect(alerts[0]!.title).toContain('المخيم القديم')
    s.zones[0]!.runs[0]!.loads = [150, 80, 140]
    expect(computeZoneAlerts(s, names, defaultAlertSettings)[0]!.level).toBe('danger')
  })
})
