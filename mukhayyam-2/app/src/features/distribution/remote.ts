import type { ISODate } from '../../lib/dates'
import type { LoadUnit } from '../sheets/loads'
import { fromTime, num, text, toTime, type ChildRows } from '../sheets/remote'
import type { SheetStatus } from '../sheets/workflow'
import type { DistributionSheet } from './model'

// The device keeps a day's sheet as one document; the server keeps it in distribution_sheets,
// zone_day_entries and zone_runs. These two functions translate between the shapes.

export const SHEET_SELECT =
  'id, sheet_date, status, notes, created_by, submitted_by, submitted_at, approved_by, approved_at,' +
  ' returned_reason, recorded_offline, updated_at, zone_day_entries(*, zone_runs(*))'

export interface SheetRow {
  id: string
  sheet_date: ISODate
  status: SheetStatus
  notes: string | null
  created_by: string | null
  submitted_by: string | null
  submitted_at: string | null
  approved_by: string | null
  approved_at: string | null
  returned_reason: string | null
  recorded_offline: boolean
  updated_at: string
  zone_day_entries: (EntryRow & { zone_runs: ZoneRunRow[] })[]
}

interface EntryRow {
  id: string
  sheet_id: string
  zone_id: number
  supplied: boolean
  supply_hours: number | null
}

interface ZoneRunRow {
  id: string
  entry_id: string
  run_no: number
  start_time: string | null
  end_time: string | null
  load_unit: LoadUnit
  load_l1: number | null
  load_l2: number | null
  load_l3: number | null
}

export function sheetToRows(s: DistributionSheet): { header: Record<string, unknown>; children: ChildRows[] } {
  return {
    header: { id: s.id, sheet_date: s.sheetDate, notes: text(s.notes) },
    children: [
      {
        table: 'zone_day_entries',
        parent: 'sheet_id',
        rows: s.zones.map<EntryRow>((z) => ({
          id: z.id,
          sheet_id: s.id,
          zone_id: z.zoneId,
          supplied: z.supplied,
          supply_hours: z.supplyHours,
        })),
      },
      {
        table: 'zone_runs',
        parent: 'entry_id',
        parentIds: s.zones.map((z) => z.id),
        rows: s.zones.flatMap((z) =>
          z.runs.map<ZoneRunRow>((r) => ({
            id: r.id,
            entry_id: z.id,
            run_no: r.runNo,
            start_time: toTime(r.start),
            end_time: toTime(r.end),
            load_unit: r.loadUnit,
            load_l1: r.loads[0],
            load_l2: r.loads[1],
            load_l3: r.loads[2],
          })),
        ),
      },
    ],
  }
}

export function sheetFromRow(row: SheetRow): DistributionSheet {
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
    sheetDate: row.sheet_date,
    notes: row.notes ?? '',
    zones: [...row.zone_day_entries]
      .sort((a, b) => a.zone_id - b.zone_id)
      .map((z) => ({
        id: z.id,
        zoneId: z.zone_id,
        supplied: z.supplied,
        supplyHours: num(z.supply_hours),
        runs: [...z.zone_runs]
          .sort((a, b) => a.run_no - b.run_no)
          .map((r) => ({
            id: r.id,
            runNo: r.run_no,
            start: fromTime(r.start_time),
            end: fromTime(r.end_time),
            loadUnit: r.load_unit,
            loads: [num(r.load_l1), num(r.load_l2), num(r.load_l3)],
          })),
      })),
  }
}
