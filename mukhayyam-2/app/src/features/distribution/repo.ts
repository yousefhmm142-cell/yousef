import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../data/db'
import { addDays, type ISODate } from '../../lib/dates'
import type { Employee } from '../../types'
import { bySortOrder } from '../generation/repo'
import { approveIn, isEditableStatus, returnIn, saveDraftIn, SheetStateError, submitIn } from '../sheets/workflow'
import type { DistributionSheet, Zone } from './model'

// Every read and write of the distribution sheet goes through this file, so connecting the
// server later only means adding the send/receive step here.

export function useZones(): Zone[] | undefined {
  return useLiveQuery(async () => (await db.zones.toArray()).sort(bySortOrder), [])
}

/** undefined while loading, null when there is no sheet for that day. */
export function useSheet(date: ISODate): DistributionSheet | null | undefined {
  return useLiveQuery(async () => (await db.distributionSheets.where('sheetDate').equals(date).first()) ?? null, [date])
}

export function useAllSheets(): DistributionSheet[] | undefined {
  return useLiveQuery(() => db.distributionSheets.orderBy('sheetDate').reverse().toArray(), [])
}

/** The newest sheet that is not a draft; the manager opens on it. */
export function useLatestSentSheet(): DistributionSheet | null | undefined {
  return useLiveQuery(
    async () => (await db.distributionSheets.orderBy('sheetDate').reverse().filter((s) => s.status !== 'draft').first()) ?? null,
    [],
  )
}

/** Earlier days (last two weeks) started or returned but not sent. */
export function useUnsentSheetsBefore(date: ISODate) {
  return useLiveQuery(
    async () =>
      (await db.distributionSheets.where('sheetDate').between(addDays(date, -14), date).toArray())
        .filter((s) => isEditableStatus(s.status))
        .map((s) => ({ id: s.id, date: s.sheetDate, status: s.status })),
    [date],
  )
}

export async function lastSheetBefore(date: ISODate): Promise<DistributionSheet | null> {
  return (await db.distributionSheets.where('sheetDate').below(date).last()) ?? null
}

export const saveSheetDraft = (sheet: DistributionSheet) => saveDraftIn<DistributionSheet>(db.distributionSheets, sheet)
export const submitSheet = (sheet: DistributionSheet, by: Employee, offline: boolean) => submitIn<DistributionSheet>(db.distributionSheets, sheet, by, offline)
export const approveSheet = (id: string, by: Employee) => approveIn<DistributionSheet>(db.distributionSheets, id, by)
export const returnSheet = (id: string, reason: string) => returnIn<DistributionSheet>(db.distributionSheets, id, reason)

// ---------- Settings: zones ----------
export async function saveZone(input: { id?: number; name: string; isActive: boolean }): Promise<void> {
  await db.transaction('rw', db.zones, async () => {
    const all = await db.zones.toArray()
    const name = input.name.trim()
    if (all.some((z) => z.name === name && z.id !== input.id)) throw new SheetStateError('duplicate_name')
    if (input.id !== undefined) {
      const existing = all.find((z) => z.id === input.id)
      if (!existing) throw new SheetStateError('missing')
      await db.zones.put({ ...existing, name, isActive: input.isActive })
    } else {
      const id = Math.max(0, ...all.map((z) => z.id)) + 1
      const sortOrder = Math.max(0, ...all.map((z) => z.sortOrder)) + 1
      await db.zones.put({ id, name, isActive: input.isActive, sortOrder })
    }
  })
}
