import type { ISODate } from '../../lib/dates'
import { sum } from '../../lib/numbers'
import type { LoadUnit, Loads } from '../sheets/loads'
import { blankMeta, newId, type SheetMeta } from '../sheets/workflow'

export { isEditableStatus, newId, statusInfo, type SheetStatus } from '../sheets/workflow'
export type { LoadUnit, Loads } from '../sheets/loads'

// The device keeps one report as a single document; the server stores the same data in
// site_reports, site_report_fuel, generator_day_logs, generator_runs and maintenance_logs
// (supabase/migrations), one line id per row.

export type PressureUnit = 'bar' | 'psi'
export type MaintenanceType =
  | 'oil_change'
  | 'oil_filter'
  | 'fuel_filter'
  | 'air_filter'
  | 'cooling'
  | 'battery'
  | 'belt'
  | 'electrical'
  | 'other'

export interface Generator {
  id: number
  name: string
  brand: string
  model: string | null
  capacityKva: number | null
  /** Diesel per running hour, set by the admin; used to check the consumption the site types. */
  litersPerHour: number | null
  isActive: boolean
  sortOrder: number
}

export interface FuelType {
  id: number
  name: string
  isActive: boolean
  sortOrder: number
}

export interface AlertSettings {
  id: 1
  fuelDaysWarn: number
  fuelDaysDanger: number
  consumptionWarnPct: number
  consumptionDangerPct: number
  tempWarnC: number
  tempDangerC: number
  oilWarnBar: number
  oilDangerBar: number
  loadWarnPct: number
  loadDangerPct: number
  imbalanceWarnPct: number
  imbalanceDangerPct: number
  oilChangeWarnHours: number
  oilChangeDueHours: number
  phaseVoltage: number
  /** Typed consumption vs hours × liters per hour: gap (%) that raises a warning / a red alert. */
  expectedWarnPct: number
  expectedDangerPct: number
}

export const defaultAlertSettings: AlertSettings = {
  id: 1,
  fuelDaysWarn: 2,
  fuelDaysDanger: 1,
  consumptionWarnPct: 20,
  consumptionDangerPct: 40,
  tempWarnC: 95,
  tempDangerC: 100,
  oilWarnBar: 2,
  oilDangerBar: 1.5,
  loadWarnPct: 80,
  loadDangerPct: 90,
  imbalanceWarnPct: 20,
  imbalanceDangerPct: 35,
  oilChangeWarnHours: 230,
  oilChangeDueHours: 250,
  phaseVoltage: 230,
  expectedWarnPct: 15,
  expectedDangerPct: 30,
}

export interface FuelLine {
  id: string
  fuelTypeId: number
  openingBalance: number | null
  receivedQty: number | null
  totalQty: number | null
  closingBalance: number | null
  consumption: number | null
  shipmentNo: string
  notes: string
}

export interface GeneratorRun {
  id: string
  runNo: number
  /** "HH:MM"; an end earlier than the start means the run went past midnight. */
  start: string
  end: string
}

export interface GeneratorLog {
  id: string
  generatorId: number
  didRun: boolean
  runs: GeneratorRun[]
  runHours: number | null
  loadUnit: LoadUnit
  loads: Loads
  temperatureC: number | null
  oilPressure: number | null
  oilPressureUnit: PressureUnit
  notes: string
}

export interface MaintenanceEntry {
  id: string
  generatorId: number | null
  oilNewLiters: number | null
  oilUsedLiters: number | null
  types: MaintenanceType[]
  description: string
}

export interface SiteReport extends SheetMeta {
  reportDate: ISODate
  fuel: FuelLine[]
  generators: GeneratorLog[]
  maintenance: MaintenanceEntry[]
  generalNotes: string
}

export const MAX_RUNS = 3

export const GENERATOR_BRANDS = [
  'Perkins', 'Cummins', 'Caterpillar', 'Volvo Penta', 'FG Wilson', 'MAN', 'Deutz', 'Mitsubishi',
  'Doosan', 'SDMO', 'Iveco', 'Scania', 'Baudouin', 'Weichai', 'Yuchai',
] as const

export const MAINTENANCE_TYPES: ReadonlyArray<{ value: MaintenanceType; label: string }> = [
  { value: 'oil_change', label: 'تغيير زيت' },
  { value: 'oil_filter', label: 'فلتر زيت' },
  { value: 'fuel_filter', label: 'فلتر سولار' },
  { value: 'air_filter', label: 'فلتر هواء' },
  { value: 'cooling', label: 'تبريد ورديتر' },
  { value: 'battery', label: 'بطارية' },
  { value: 'belt', label: 'سير' },
  { value: 'electrical', label: 'دينمو وكهرباء' },
  { value: 'other', label: 'أخرى' },
]

export const maintenanceLabel = (t: MaintenanceType) => MAINTENANCE_TYPES.find((m) => m.value === t)?.label ?? t

export function emptyRun(runNo: number): GeneratorRun {
  return { id: newId(), runNo, start: '', end: '' }
}

/**
 * A blank report with every active fuel type and generator already listed.
 * Only preferences carry over from the last report (load and pressure units), never figures.
 */
export function newReport(
  reportDate: ISODate,
  fuelTypes: FuelType[],
  generators: Generator[],
  createdBy: string,
  previous: SiteReport | null,
  now: string,
): SiteReport {
  const prevLog = (id: number) => previous?.generators.find((g) => g.generatorId === id)
  return {
    ...blankMeta(createdBy, now),
    id: newId(),
    reportDate,
    fuel: fuelTypes
      .filter((f) => f.isActive)
      .map((f) => ({
        id: newId(),
        fuelTypeId: f.id,
        openingBalance: null,
        receivedQty: null,
        totalQty: null,
        closingBalance: null,
        consumption: null,
        shipmentNo: '',
        notes: '',
      })),
    generators: generators
      .filter((g) => g.isActive)
      .map((g) => ({
        id: newId(),
        generatorId: g.id,
        // Most days the same generators run as the day before; the operator taps to change.
        didRun: prevLog(g.id)?.didRun ?? true,
        runs: [emptyRun(1)],
        runHours: null,
        loadUnit: prevLog(g.id)?.loadUnit ?? 'A',
        loads: [null, null, null],
        temperatureC: null,
        oilPressure: null,
        oilPressureUnit: prevLog(g.id)?.oilPressureUnit ?? 'bar',
        notes: '',
      })),
    maintenance: [],
    generalNotes: '',
  }
}

/**
 * Adds lines for fuel types or generators made active after this draft was started.
 * Nothing typed is ever removed. Returns the same object when nothing changed.
 */
export function reconcileReport(r: SiteReport, fuelTypes: FuelType[], generators: Generator[]): SiteReport {
  const missingFuel = fuelTypes.filter((f) => f.isActive && !r.fuel.some((l) => l.fuelTypeId === f.id))
  const missingGen = generators.filter((g) => g.isActive && !r.generators.some((l) => l.generatorId === g.id))
  if (!missingFuel.length && !missingGen.length) return r
  const blank = newReport(r.reportDate, missingFuel, missingGen, r.createdBy, null, r.updatedAt)
  return { ...r, fuel: [...r.fuel, ...blank.fuel], generators: [...r.generators, ...blank.generators] }
}

export function reportTotals(r: SiteReport) {
  const ran = r.generators.filter((g) => g.didRun)
  return {
    received: sum(r.fuel.map((f) => f.receivedQty)),
    remaining: sum(r.fuel.map((f) => f.closingBalance)),
    consumption: sum(r.fuel.map((f) => f.consumption)),
    runHours: sum(ran.map((g) => g.runHours)),
    generatorsRan: ran.length,
  }
}

/** True when the run went past midnight (e.g. 20:00 -> 01:00). */
export const crossesMidnight = (run: GeneratorRun) => !!run.start && !!run.end && run.end < run.start

/** Plain-language list of what is still empty, shown before sending. */
export function missingItems(r: SiteReport, fuelName: (id: number) => string, generatorName: (id: number) => string): string[] {
  const out: string[] = []
  for (const f of r.fuel) {
    if (f.openingBalance === null) out.push(`${fuelName(f.fuelTypeId)}: الرصيد الموجود`)
    if (f.consumption === null) out.push(`${fuelName(f.fuelTypeId)}: الاستهلاك`)
  }
  for (const g of r.generators) {
    if (!g.didRun) continue
    const name = generatorName(g.generatorId)
    if (g.runs.length === 0 || g.runs.some((run) => !run.start || !run.end)) out.push(`${name}: أوقات التشغيل`)
    if (g.loads.some((l) => l === null)) out.push(`${name}: الأحمال`)
  }
  for (const m of r.maintenance) {
    if (m.generatorId === null) out.push('صيانة بدون اسم المولد')
  }
  return out
}

/** Generator readings in bar, whatever unit the operator used. */
export const toBar = (value: number, unit: PressureUnit) => (unit === 'psi' ? value / 14.5038 : value)

/** Apparent power drawn, from three phase currents (A) or three phase powers (kW, power factor 0.8). */
export function loadKva(loads: Loads, unit: LoadUnit, phaseVoltage: number): number | null {
  if (loads.some((l) => l === null)) return null
  const total = sum(loads)
  return unit === 'A' ? (phaseVoltage * total) / 1000 : total / 0.8
}

// ---------- Figures the report works out by itself ----------
// Only these: the operator still types what was received, what was used, the run times and
// readings. Everything below is shown greyed out and saved with the report.

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h! * 60 + m!
}

/** Length of one run in minutes (a run past midnight counts into the next day). */
export function runMinutes(run: GeneratorRun): number | null {
  if (!run.start || !run.end) return null
  const d = minutes(run.end) - minutes(run.start)
  return d >= 0 ? d : d + 24 * 60
}

/** Running hours of a generator from its run times, to one decimal; null until a run is complete. */
export function hoursFromRuns(log: GeneratorLog): number | null {
  const parts = log.runs.map(runMinutes).filter((m): m is number => m !== null)
  if (!parts.length) return null
  return Math.round((parts.reduce((a, b) => a + b, 0) / 60) * 10) / 10
}

const add = (...xs: Array<number | null>) => (xs.every((x) => x === null) ? null : xs.reduce<number>((a, x) => a + (x ?? 0), 0))
const round1 = (n: number) => Math.round(n * 10) / 10

/**
 * Fills the worked-out figures in place:
 * opening balance = yesterday's remaining (when there is a report before), total = opening + received,
 * remaining = total − consumption, running hours = sum of the run times.
 */
export function applyAutoFigures(r: SiteReport, previous: SiteReport | null): SiteReport {
  for (const line of r.fuel) {
    const before = previous?.fuel.find((f) => f.fuelTypeId === line.fuelTypeId)?.closingBalance
    if (before !== null && before !== undefined) line.openingBalance = before
    line.totalQty = add(line.openingBalance, line.receivedQty)
    line.closingBalance = line.totalQty !== null && line.consumption !== null ? round1(line.totalQty - line.consumption) : null
  }
  for (const log of r.generators) log.runHours = log.didRun ? hoursFromRuns(log) : null
  return r
}

/** True when yesterday's remaining gives today's opening balance (the box is then not typed). */
export const openingFromPrevious = (line: FuelLine, previous: SiteReport | null) => {
  const before = previous?.fuel.find((f) => f.fuelTypeId === line.fuelTypeId)?.closingBalance
  return before !== null && before !== undefined
}

/** Diesel the generators should have used: hours × liters per hour. Null if no generator has a rate. */
export function expectedConsumption(r: SiteReport, generators: Map<number, Generator>): number | null {
  let total = 0
  let known = false
  for (const log of r.generators) {
    const rate = generators.get(log.generatorId)?.litersPerHour
    if (!log.didRun || !rate || log.runHours === null) continue
    total += log.runHours * rate
    known = true
  }
  return known ? Math.round(total) : null
}
