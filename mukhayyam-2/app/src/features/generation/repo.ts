import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../data/db'
import { syncSoon } from '../../data/sync'
import { saveListItem } from '../../data/admin'
import { addDays, type ISODate } from '../../lib/dates'
import type { Employee } from '../../types'
import { approveIn, isEditableStatus, returnIn, saveDraftIn, SheetStateError, submitIn } from '../sheets/workflow'
import {
  defaultAlertSettings,
  type AlertSettings,
  type FuelType,
  type Generator,
  type SiteReport,
} from './model'

// Every read and write of the generation report goes through this file. Writes land on the
// device first; data/sync.ts then sends them to the server (real mode only).

export const bySortOrder = <T extends { sortOrder: number; id: number }>(a: T, b: T) => a.sortOrder - b.sortOrder || a.id - b.id

/** Kept under this name for the settings screen. */
export { SheetStateError as ReportStateError }

// ---------- Reading ----------
export function useGenerators(): Generator[] | undefined {
  return useLiveQuery(async () => (await db.generators.toArray()).sort(bySortOrder), [])
}

export function useFuelTypes(): FuelType[] | undefined {
  return useLiveQuery(async () => (await db.fuelTypes.toArray()).sort(bySortOrder), [])
}

export function useAlertSettings(): AlertSettings {
  return useLiveQuery(() => db.alertSettings.get(1), []) ?? defaultAlertSettings
}

/** undefined while loading, null when there is no report for that day. */
export function useReport(date: ISODate): SiteReport | null | undefined {
  return useLiveQuery(async () => (await db.siteReports.where('reportDate').equals(date).first()) ?? null, [date])
}

/** Reports already sent before a day (waiting, returned or approved), newest first: the basis for averages and alerts. */
export function useHistoryBefore(date: ISODate, limit = 60): SiteReport[] | undefined {
  return useLiveQuery(
    async () =>
      (await db.siteReports.where('reportDate').below(date).reverse().toArray())
        .filter((r) => r.status !== 'draft')
        .slice(0, limit),
    [date, limit],
  )
}

export function useAllReports(): SiteReport[] | undefined {
  return useLiveQuery(async () => (await db.siteReports.orderBy('reportDate').reverse().toArray()), [])
}

/** The newest report that is not a draft; the manager opens on it. */
export function useLatestSentReport(): SiteReport | null | undefined {
  return useLiveQuery(
    async () =>
      (await db.siteReports.orderBy('reportDate').reverse().filter((r) => r.status !== 'draft').first()) ?? null,
    [],
  )
}

export function useEmployeeNames(): Map<string, string> {
  const rows = useLiveQuery(() => db.employees.toArray(), [])
  return new Map((rows ?? []).map((e) => [e.id, e.fullName]))
}

/** Earlier days (last two weeks) started or returned but not sent. */
export function useUnsentBefore(date: ISODate) {
  return useLiveQuery(
    async () =>
      (await db.siteReports.where('reportDate').between(addDays(date, -14), date).toArray())
        .filter((r) => isEditableStatus(r.status))
        .map((r) => ({ id: r.id, date: r.reportDate, status: r.status })),
    [date],
  )
}

export async function lastReportBefore(date: ISODate): Promise<SiteReport | null> {
  return (await db.siteReports.where('reportDate').below(date).last()) ?? null
}

// ---------- Writing ----------
export const saveDraft = (report: SiteReport) => saveDraftIn<SiteReport>(db.siteReports, report).then(() => syncSoon())
export const submitReport = (report: SiteReport, by: Employee, offline: boolean) =>
  submitIn<SiteReport>(db.siteReports, report, by, offline).then((sent) => (syncSoon(true), sent))
export const approveReport = (id: string, by: Employee) => approveIn<SiteReport>(db.siteReports, id, by).then(() => syncSoon(true))
export const returnReport = (id: string, reason: string) => returnIn<SiteReport>(db.siteReports, id, reason).then(() => syncSoon(true))

// ---------- Settings: generators ----------
export async function saveGenerator(input: Omit<Generator, 'id' | 'sortOrder'> & { id?: number }): Promise<void> {
  const name = input.name.trim()
  await saveListItem<Generator>(db.generators, 'generators', { ...input, name }, (g) => ({
    name: g.name,
    brand: g.brand,
    model: g.model,
    capacity_kva: g.capacityKva,
    liters_per_hour: g.litersPerHour,
    is_active: g.isActive,
  }))
}
