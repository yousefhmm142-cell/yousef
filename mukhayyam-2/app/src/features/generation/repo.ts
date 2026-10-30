import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../data/db'
import { serverNow } from '../../lib/clock'
import type { ISODate } from '../../lib/dates'
import type { Employee } from '../../types'
import {
  defaultAlertSettings,
  isEditableStatus,
  type AlertSettings,
  type FuelType,
  type Generator,
  type SiteReport,
} from './model'

// Every read and write of the generation report goes through this file, so connecting the
// server later only means adding the send/receive step here.

const nowIso = () => serverNow().toISOString()
const bySortOrder = <T extends { sortOrder: number; id: number }>(a: T, b: T) => a.sortOrder - b.sortOrder || a.id - b.id

export class ReportStateError extends Error {}

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

export async function lastReportBefore(date: ISODate): Promise<SiteReport | null> {
  return (await db.siteReports.where('reportDate').below(date).last()) ?? null
}

// ---------- Writing (site operator) ----------
export async function saveDraft(report: SiteReport): Promise<void> {
  await db.transaction('rw', db.siteReports, async () => {
    const current = await db.siteReports.get(report.id)
    if (current && !isEditableStatus(current.status)) {
      throw new ReportStateError('This report was already sent')
    }
    await db.siteReports.put({ ...report, updatedAt: nowIso() })
  })
}

export async function submitReport(report: SiteReport, by: Employee, offline: boolean): Promise<SiteReport> {
  if (!isEditableStatus(report.status)) throw new ReportStateError('This report was already sent')
  const sent: SiteReport = {
    ...report,
    status: 'submitted',
    submittedBy: by.id,
    submittedAt: nowIso(),
    returnedReason: null,
    recordedOffline: offline,
    updatedAt: nowIso(),
  }
  await db.siteReports.put(sent)
  return sent
}

// ---------- Writing (manager) ----------
async function transition(id: string, from: SiteReport['status'], change: (r: SiteReport) => SiteReport) {
  await db.transaction('rw', db.siteReports, async () => {
    const r = await db.siteReports.get(id)
    if (!r || r.status !== from) throw new ReportStateError('The report changed; reload and try again')
    await db.siteReports.put({ ...change(r), updatedAt: nowIso() })
  })
}

export const approveReport = (id: string, by: Employee) =>
  transition(id, 'submitted', (r) => ({ ...r, status: 'approved', approvedBy: by.id, approvedAt: nowIso() }))

export function returnReport(id: string, reason: string) {
  const text = reason.trim()
  if (!text) throw new ReportStateError('A reason is needed')
  return transition(id, 'submitted', (r) => ({ ...r, status: 'returned', returnedReason: text, approvedBy: null, approvedAt: null }))
}

// ---------- Settings: generators ----------
export async function saveGenerator(input: Omit<Generator, 'id' | 'sortOrder'> & { id?: number }): Promise<void> {
  await db.transaction('rw', db.generators, async () => {
    const all = await db.generators.toArray()
    const name = input.name.trim()
    if (all.some((g) => g.name === name && g.id !== input.id)) throw new ReportStateError('duplicate_name')
    if (input.id !== undefined) {
      const existing = all.find((g) => g.id === input.id)
      if (!existing) throw new ReportStateError('missing')
      await db.generators.put({ ...existing, ...input, id: input.id, name })
    } else {
      const id = Math.max(0, ...all.map((g) => g.id)) + 1
      const sortOrder = Math.max(0, ...all.map((g) => g.sortOrder)) + 1
      await db.generators.put({ ...input, id, sortOrder, name })
    }
  })
}
