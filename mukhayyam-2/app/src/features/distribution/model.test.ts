import { describe, expect, it } from 'vitest'
import { defaultAlertSettings } from '../generation/model'
import { loadAverage, phaseImbalancePct } from '../sheets/loads'
import { computeZoneAlerts } from './alerts'
import { applyAutoHours, hoursFromZoneRuns, missingInZone, newSheet, reconcileSheet, runLoad, runSegments, sheetTotals, type Zone } from './model'

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
  it('asks for times and the hourly loads of a supplied zone only (the hours come from the times)', () => {
    const s = newSheet('2026-10-30', zones, 'e1', null, '')
    expect(missingInZone(s.zones[0]!)).toEqual(['وقت التشغيلة الأولى', 'الأحمال حسب الساعة'])
    s.zones[0]!.bands[1] = [100, 110, 105]
    expect(missingInZone(s.zones[0]!)).toEqual(['وقت التشغيلة الأولى'])
    s.zones[0]!.supplied = false
    expect(missingInZone(s.zones[0]!)).toEqual([])
  })
})

describe('loads by hour', () => {
  it('a run carries the hours it overlaps: samples, mean and the worst phase gap', () => {
    const s = newSheet('2026-10-30', zones, 'e1', null, '')
    const z = s.zones[0]!
    z.bands[0] = [100, 100, 100]
    z.bands[1] = [150, 90, 120]
    z.bands[2] = [200, 200, 200]
    const r = runLoad(z, { start: '08:00', end: '11:00', loads: [null, null, null], extra: [] })
    expect(r.samples).toEqual([100, 120])
    expect(r.avg).toBe(110)
    expect(Math.round(r.gapPct!)).toBe(40)
    expect(runLoad(z, { start: '', end: '', loads: [null, null, null], extra: [] }).samples).toEqual([])
  })
  it('a sheet from before (no hourly table) still reads the run\'s own readings', () => {
    const s = newSheet('2026-10-30', zones, 'e1', null, '')
    const z = s.zones[0]!
    expect(runLoad(z, { start: '08:00', end: '11:00', loads: [100, 110, 120], extra: [] }).avg).toBe(110)
  })
  it('an older draft without the table gets an empty one', () => {
    const s = newSheet('2026-10-30', zones, 'e1', null, '')
    const old = { ...s, zones: s.zones.map(({ bands: _b, ...z }) => z) } as unknown as typeof s
    expect(reconcileSheet(old, zones).zones[0]!.bands).toHaveLength(6)
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

describe('hours and averages worked out for her', () => {
  it('adds the run times, past midnight too', () => {
    expect(hoursFromZoneRuns([{ start: '06:00', end: '09:30' }])).toBe(3.5)
    expect(hoursFromZoneRuns([{ start: '06:00', end: '09:30' }, { start: '20:00', end: '01:00' }])).toBe(8.5)
    expect(hoursFromZoneRuns([{ start: '06:00', end: '' }])).toBeNull()
    expect(hoursFromZoneRuns([])).toBeNull()
  })
  it('fills the hours of every zone from its runs', () => {
    const s = newSheet('2026-10-30', zones, 'e1', null, '')
    s.zones[0]!.runs[0]!.start = '08:00'
    s.zones[0]!.runs[0]!.end = '11:15'
    expect(applyAutoHours(s).zones[0]!.supplyHours).toBe(3.25)
    s.zones[0]!.supplied = false
    expect(applyAutoHours(s).zones[0]!.supplyHours).toBeNull()
  })
  it('means the three phases to one decimal', () => {
    expect(loadAverage([350, 310, 365])).toBe(341.7)
    expect(loadAverage([100, null, 100])).toBeNull()
  })
})
