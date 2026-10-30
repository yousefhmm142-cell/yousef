import type { ISODate } from '../../lib/dates'
import { sum } from '../../lib/numbers'
import { emptyLoads, type LoadUnit, type Loads } from '../sheets/loads'
import { blankMeta, newId, type SheetMeta } from '../sheets/workflow'

// The device keeps one day's sheet as a single document; the server stores it in
// distribution_sheets, zone_day_entries (hours per zone) and zone_runs (supabase/migrations).
// Every figure is typed by the distribution supervisor, as on the paper form.

export interface Zone {
  id: number
  name: string
  isActive: boolean
  sortOrder: number
}

export interface ZoneRun {
  id: string
  runNo: number
  /** "HH:MM"; an end earlier than the start means the run went past midnight. */
  start: string
  end: string
  loadUnit: LoadUnit
  loads: Loads
}

export interface ZoneEntry {
  id: string
  zoneId: number
  /** False when the zone got no power that day; its hours and runs are then not asked for. */
  supplied: boolean
  supplyHours: number | null
  runs: ZoneRun[]
}

export interface DistributionSheet extends SheetMeta {
  sheetDate: ISODate
  zones: ZoneEntry[]
  notes: string
}

export const MAX_ZONE_RUNS = 6
export const RUN_NAMES = ['الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة'] as const

export function emptyZoneRun(runNo: number, loadUnit: LoadUnit = 'A'): ZoneRun {
  return { id: newId(), runNo, start: '', end: '', loadUnit, loads: emptyLoads() }
}

function emptyEntry(zone: Zone, previous: DistributionSheet | null): ZoneEntry {
  const unit = previous?.zones.find((z) => z.zoneId === zone.id)?.runs[0]?.loadUnit ?? 'A'
  return { id: newId(), zoneId: zone.id, supplied: true, supplyHours: null, runs: [emptyZoneRun(1, unit)] }
}

/** A blank sheet with every active zone listed. Only the load unit carries over, never figures. */
export function newSheet(sheetDate: ISODate, zones: Zone[], createdBy: string, previous: DistributionSheet | null, now: string): DistributionSheet {
  return {
    ...blankMeta(createdBy, now),
    id: newId(),
    sheetDate,
    zones: zones.filter((z) => z.isActive).map((z) => emptyEntry(z, previous)),
    notes: '',
  }
}

/** Adds zones made active after this draft was started; nothing typed is removed. */
export function reconcileSheet(sheet: DistributionSheet, zones: Zone[]): DistributionSheet {
  const missing = zones.filter((z) => z.isActive && !sheet.zones.some((e) => e.zoneId === z.id))
  return missing.length ? { ...sheet, zones: [...sheet.zones, ...missing.map((z) => emptyEntry(z, null))] } : sheet
}

export function sheetTotals(sheet: DistributionSheet) {
  const supplied = sheet.zones.filter((z) => z.supplied)
  return {
    totalHours: sum(supplied.map((z) => z.supplyHours)),
    suppliedZones: supplied.length,
    runs: supplied.reduce((n, z) => n + z.runs.filter((r) => r.start || r.end).length, 0),
  }
}

/** What is still empty in one zone, in plain words. */
export function missingInZone(entry: ZoneEntry): string[] {
  if (!entry.supplied) return []
  const out: string[] = []
  if (entry.supplyHours === null) out.push('عدد الساعات')
  entry.runs.forEach((r, i) => {
    if (!r.start || !r.end) out.push(`وقت التشغيلة ${RUN_NAMES[i]}`)
    if (r.loads.some((l) => l === null)) out.push(`أحمال التشغيلة ${RUN_NAMES[i]}`)
  })
  return out
}

export const crossesMidnight = (run: Pick<ZoneRun, 'start' | 'end'>) => !!run.start && !!run.end && run.end < run.start

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

/** Where a run sits on a 24-hour bar, in minutes from midnight; a run past midnight becomes two pieces. */
export function runSegments(run: Pick<ZoneRun, 'start' | 'end'>): Array<[number, number]> {
  if (!run.start || !run.end) return []
  const a = minutes(run.start)
  const b = minutes(run.end)
  if (a === b) return []
  return b > a ? [[a, b]] : [[a, 24 * 60], [0, b]]
}
