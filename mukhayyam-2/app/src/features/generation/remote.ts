import type { ISODate } from '../../lib/dates'
import type { SheetStatus } from '../sheets/workflow'
import { fromTime, num, text, toTime, type ChildRows } from '../sheets/remote'
import type { MaintenanceType, PressureUnit, SiteReport } from './model'
import type { LoadUnit } from '../sheets/loads'

// The device keeps a report as one document; the server keeps it in five tables
// (supabase/migrations). These two functions translate between the shapes, nothing else.

export const REPORT_SELECT =
  'id, report_date, status, general_notes, created_by, submitted_by, submitted_at, approved_by, approved_at,' +
  ' returned_reason, recorded_offline, updated_at,' +
  ' site_report_fuel(*), generator_day_logs(*, generator_runs(*)), maintenance_logs(*)'

export interface ReportRow {
  id: string
  report_date: ISODate
  status: SheetStatus
  general_notes: string | null
  created_by: string | null
  submitted_by: string | null
  submitted_at: string | null
  approved_by: string | null
  approved_at: string | null
  returned_reason: string | null
  recorded_offline: boolean
  updated_at: string
  site_report_fuel: FuelRow[]
  generator_day_logs: (LogRow & { generator_runs: RunRow[] })[]
  maintenance_logs: MaintenanceRow[]
}

interface FuelRow {
  id: string
  report_id: string
  fuel_type_id: number
  opening_balance: number | null
  received_qty: number | null
  total_qty: number | null
  closing_balance: number | null
  consumption: number | null
  shipment_no: string | null
  notes: string | null
}

interface LogRow {
  id: string
  report_id: string
  generator_id: number
  did_run: boolean
  run_hours: number | null
  load_unit: LoadUnit
  load_l1: number | null
  load_l2: number | null
  load_l3: number | null
  temperature_c: number | null
  oil_pressure: number | null
  oil_pressure_unit: PressureUnit
  notes: string | null
}

interface RunRow {
  id: string
  log_id: string
  run_no: number
  start_time: string | null
  end_time: string | null
}

interface MaintenanceRow {
  id: string
  report_id: string
  line_no: number
  generator_id: number | null
  oil_new_liters: number | null
  oil_used_liters: number | null
  maintenance_types: MaintenanceType[]
  description: string | null
}

/** The rows to send for one report. The header leaves out status: sending and approving are separate steps. */
export function reportToRows(r: SiteReport): { header: Record<string, unknown>; children: ChildRows[] } {
  return {
    header: { id: r.id, report_date: r.reportDate, general_notes: text(r.generalNotes) },
    children: [
      {
        table: 'site_report_fuel',
        parent: 'report_id',
        rows: r.fuel.map<FuelRow>((f) => ({
          id: f.id,
          report_id: r.id,
          fuel_type_id: f.fuelTypeId,
          opening_balance: f.openingBalance,
          received_qty: f.receivedQty,
          total_qty: f.totalQty,
          closing_balance: f.closingBalance,
          consumption: f.consumption,
          shipment_no: text(f.shipmentNo),
          notes: text(f.notes),
        })),
      },
      {
        table: 'generator_day_logs',
        parent: 'report_id',
        rows: r.generators.map<LogRow>((g) => ({
          id: g.id,
          report_id: r.id,
          generator_id: g.generatorId,
          did_run: g.didRun,
          run_hours: g.runHours,
          load_unit: g.loadUnit,
          load_l1: g.loads[0],
          load_l2: g.loads[1],
          load_l3: g.loads[2],
          temperature_c: g.temperatureC,
          oil_pressure: g.oilPressure,
          oil_pressure_unit: g.oilPressureUnit,
          notes: text(g.notes),
        })),
      },
      {
        table: 'generator_runs',
        parent: 'log_id',
        parentIds: r.generators.map((g) => g.id),
        rows: r.generators.flatMap((g) =>
          g.runs.map<RunRow>((run) => ({ id: run.id, log_id: g.id, run_no: run.runNo, start_time: toTime(run.start), end_time: toTime(run.end) })),
        ),
      },
      {
        table: 'maintenance_logs',
        parent: 'report_id',
        rows: r.maintenance.map<MaintenanceRow>((m, i) => ({
          id: m.id,
          report_id: r.id,
          line_no: i + 1,
          generator_id: m.generatorId,
          oil_new_liters: m.oilNewLiters,
          oil_used_liters: m.oilUsedLiters,
          maintenance_types: m.types,
          description: text(m.description),
        })),
      },
    ],
  }
}

/** A report as the server returns it (REPORT_SELECT), turned back into the device document. */
export function reportFromRow(row: ReportRow): SiteReport {
  return {
    id: row.id,
    status: row.status,
    createdBy: row.created_by ?? '',
    submittedBy: row.submitted_by,
    submittedAt: row.submitted_at,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    returnedReason: row.returned_reason,
    recordedOffline: row.recorded_offline,
    updatedAt: row.updated_at,
    reportDate: row.report_date,
    generalNotes: row.general_notes ?? '',
    fuel: [...row.site_report_fuel]
      .sort((a, b) => a.fuel_type_id - b.fuel_type_id)
      .map((f) => ({
        id: f.id,
        fuelTypeId: f.fuel_type_id,
        openingBalance: num(f.opening_balance),
        receivedQty: num(f.received_qty),
        totalQty: num(f.total_qty),
        closingBalance: num(f.closing_balance),
        consumption: num(f.consumption),
        shipmentNo: f.shipment_no ?? '',
        notes: f.notes ?? '',
      })),
    generators: [...row.generator_day_logs]
      .sort((a, b) => a.generator_id - b.generator_id)
      .map((g) => ({
        id: g.id,
        generatorId: g.generator_id,
        didRun: g.did_run,
        runs: [...g.generator_runs]
          .sort((a, b) => a.run_no - b.run_no)
          .map((run) => ({ id: run.id, runNo: run.run_no, start: fromTime(run.start_time), end: fromTime(run.end_time) })),
        runHours: num(g.run_hours),
        loadUnit: g.load_unit,
        loads: [num(g.load_l1), num(g.load_l2), num(g.load_l3)],
        temperatureC: num(g.temperature_c),
        oilPressure: num(g.oil_pressure),
        oilPressureUnit: g.oil_pressure_unit,
        notes: g.notes ?? '',
      })),
    maintenance: [...row.maintenance_logs]
      .sort((a, b) => a.line_no - b.line_no)
      .map((m) => ({
        id: m.id,
        generatorId: m.generator_id,
        oilNewLiters: num(m.oil_new_liters),
        oilUsedLiters: num(m.oil_used_liters),
        types: m.maintenance_types,
        description: m.description ?? '',
      })),
  }
}
