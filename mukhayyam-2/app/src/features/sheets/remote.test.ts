import { describe, expect, it } from 'vitest'
import { emptyZoneRun, newSheet, type DistributionSheet } from '../distribution/model'
import { sheetFromRow, sheetToRows, type SheetRow } from '../distribution/remote'
import { emptyRun, newReport, type SiteReport } from '../generation/model'
import { reportFromRow, reportToRows, type ReportRow } from '../generation/remote'

// What the server would send back for the rows we send: the same columns, times as HH:MM:SS,
// lines nested under their parent, in no particular order.
const asServerTime = (t: unknown) => (typeof t === 'string' ? `${t}:00` : t)
const shuffle = <T,>(xs: T[]) => [...xs].reverse()

function serverReport(r: SiteReport): ReportRow {
  const { header, children } = reportToRows(r)
  const [fuel, logs, runs, maintenance] = children.map((c) => c.rows as unknown as Record<string, unknown>[])
  return {
    ...(header as object),
    status: r.status,
    created_by: r.createdBy,
    submitted_by: r.submittedBy,
    submitted_at: r.submittedAt,
    approved_by: r.approvedBy,
    approved_at: r.approvedAt,
    returned_reason: r.returnedReason,
    recorded_offline: r.recordedOffline,
    updated_at: r.updatedAt,
    site_report_fuel: shuffle(fuel!),
    generator_day_logs: shuffle(logs!).map((l) => ({
      ...l,
      generator_runs: shuffle(runs!.filter((x) => x.log_id === l.id)).map((x) => ({
        ...x,
        start_time: asServerTime(x.start_time),
        end_time: asServerTime(x.end_time),
      })),
    })),
    maintenance_logs: shuffle(maintenance!),
  } as unknown as ReportRow
}

function serverSheet(s: DistributionSheet): SheetRow {
  const { header, children } = sheetToRows(s)
  const [entries, runs] = children.map((c) => c.rows as unknown as Record<string, unknown>[])
  return {
    ...(header as object),
    status: s.status,
    created_by: s.createdBy,
    submitted_by: s.submittedBy,
    submitted_at: s.submittedAt,
    approved_by: s.approvedBy,
    approved_at: s.approvedAt,
    returned_reason: s.returnedReason,
    recorded_offline: s.recordedOffline,
    updated_at: s.updatedAt,
    zone_day_entries: shuffle(entries!).map((e) => ({
      ...e,
      zone_runs: shuffle(runs!.filter((x) => x.entry_id === e.id)).map((x) => ({
        ...x,
        start_time: asServerTime(x.start_time),
        end_time: asServerTime(x.end_time),
      })),
    })),
  } as unknown as SheetRow
}

const fuelTypes = [
  { id: 1, name: 'سولار صناعي', isActive: true, sortOrder: 1 },
  { id: 2, name: 'سولار إسرائيلي', isActive: true, sortOrder: 2 },
]
const generators = [1, 2, 3].map((id) => ({
  id,
  name: `المولد ${id}`,
  brand: 'Perkins',
  model: null,
  capacityKva: 500,
  litersPerHour: null,
  isActive: true,
  sortOrder: id,
}))

describe('generation report <-> server rows', () => {
  it('comes back exactly as typed', () => {
    const r = newReport('2026-10-30', fuelTypes, generators, 'op', null, '2026-10-30T08:00:00.000Z')
    r.fuel[0] = { ...r.fuel[0]!, openingBalance: 2600, receivedQty: 2000.25, totalQty: 4600.25, closingBalance: 3600, consumption: 1000.25, shipmentNo: '14520', notes: 'وصلت 10:15' }
    r.generators[0] = {
      ...r.generators[0]!,
      runs: [{ ...emptyRun(1), start: '06:00', end: '09:30' }, { ...emptyRun(2), start: '20:00', end: '01:00' }],
      runHours: 8.5,
      loadUnit: 'kW',
      loads: [120, 118.5, 122],
      temperatureC: 88,
      oilPressure: 45,
      oilPressureUnit: 'psi',
      notes: 'صوت غريب',
    }
    r.generators[1] = { ...r.generators[1]!, didRun: false, runs: [] }
    r.generators[2] = { ...r.generators[2]!, runs: [emptyRun(1)] } // a draft with empty times
    r.maintenance = [
      { id: 'm1', generatorId: 1, oilNewLiters: 40, oilUsedLiters: 38, types: ['oil_change', 'oil_filter'], description: 'تغيير زيت' },
      { id: 'm2', generatorId: null, oilNewLiters: null, oilUsedLiters: null, types: [], description: '' },
    ]
    r.generalNotes = 'لا شيء'
    expect(reportFromRow(serverReport(r))).toEqual(r)
  })

  it('sends empty text and times as empty, never as blank strings', () => {
    const r = newReport('2026-10-30', fuelTypes, generators, 'op', null, '2026-10-30T08:00:00.000Z')
    const { header, children } = reportToRows(r)
    expect(header.general_notes).toBeNull()
    const run = children.find((c) => c.table === 'generator_runs')!.rows[0] as unknown as Record<string, unknown>
    expect(run.start_time).toBeNull()
    expect(children.find((c) => c.table === 'generator_runs')!.parentIds).toHaveLength(3)
  })
})

describe('distribution sheet <-> server rows', () => {
  it('comes back exactly as typed, including unsupplied zones and six runs', () => {
    const zones = [1, 2, 3].map((id) => ({ id, name: `منطقة ${id}`, isActive: true, sortOrder: id }))
    const s = newSheet('2026-10-30', zones, 'sup', null, '2026-10-30T08:00:00.000Z')
    s.zones[0] = {
      ...s.zones[0]!,
      supplyHours: 14,
      runs: Array.from({ length: 6 }, (_, i) => ({ ...emptyZoneRun(i + 1, i % 2 ? 'kW' : 'A'), start: '06:00', end: '08:00', loads: [100 + i, 95, 98.5] as [number, number, number] })),
    }
    s.zones[1] = { ...s.zones[1]!, supplied: false, supplyHours: null, runs: [] }
    s.notes = 'صيانة المحوّل'
    s.status = 'submitted'
    s.submittedAt = '2026-10-30T14:00:00.000Z'
    s.submittedBy = 'sup'
    expect(sheetFromRow(serverSheet(s))).toEqual(s)
  })
})
