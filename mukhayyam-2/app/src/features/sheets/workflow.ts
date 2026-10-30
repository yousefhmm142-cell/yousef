import type Dexie from 'dexie'
import { serverNow } from '../../lib/clock'
import type { Employee } from '../../types'
import type { Tone } from '../../ui/primitives'

// The life of every daily paper form that moved into the app (generation report, distribution
// sheet): typed on site as a draft, sent to the manager, then approved or returned with a reason.
// The server enforces the same steps (supabase/migrations, sheet_guard).

export type SheetStatus = 'draft' | 'submitted' | 'returned' | 'approved'

export interface SheetMeta {
  id: string
  status: SheetStatus
  createdBy: string
  submittedBy: string | null
  submittedAt: string | null
  approvedBy: string | null
  approvedAt: string | null
  returnedReason: string | null
  /** Sent while the phone had no internet; the manager sees a mark. */
  recordedOffline: boolean
  updatedAt: string
}

export const statusInfo: Record<SheetStatus, { label: string; tone: Tone }> = {
  draft: { label: 'قيد التعبئة', tone: 'neutral' },
  submitted: { label: 'بانتظار الاعتماد', tone: 'warn' },
  returned: { label: 'أُعيد للتصحيح', tone: 'danger' },
  approved: { label: 'معتمد', tone: 'ok' },
}

export const isEditableStatus = (s: SheetStatus) => s === 'draft' || s === 'returned'

export const newId = () => crypto.randomUUID()

export const nowIso = () => serverNow().toISOString()

export function blankMeta(createdBy: string, now: string): Omit<SheetMeta, 'id'> {
  return {
    status: 'draft',
    createdBy,
    submittedBy: null,
    submittedAt: null,
    approvedBy: null,
    approvedAt: null,
    returnedReason: null,
    recordedOffline: false,
    updatedAt: now,
  }
}

export class SheetStateError extends Error {}

/** The part of a device table these steps need; any Dexie table of sheets fits it. */
interface SheetTable<T extends SheetMeta> {
  db: Dexie
  name: string
  get(id: string): PromiseLike<T | undefined>
  put(doc: T): PromiseLike<unknown>
}

/** Saves typing on a draft; refuses once the sheet was sent, so a late autosave cannot undo a send. */
export async function saveDraftIn<T extends SheetMeta>(table: SheetTable<T>, doc: T): Promise<void> {
  await table.db.transaction('rw', table.name, async () => {
    const current = await table.get(doc.id)
    if (current && !isEditableStatus(current.status)) throw new SheetStateError('already_sent')
    await table.put({ ...doc, updatedAt: nowIso() })
  })
}

export async function submitIn<T extends SheetMeta>(table: SheetTable<T>, doc: T, by: Employee, offline: boolean): Promise<T> {
  if (!isEditableStatus(doc.status)) throw new SheetStateError('already_sent')
  const sent: T = {
    ...doc,
    status: 'submitted',
    submittedBy: by.id,
    submittedAt: nowIso(),
    returnedReason: null,
    recordedOffline: offline,
    updatedAt: nowIso(),
  }
  await table.put(sent)
  return sent
}

async function transition<T extends SheetMeta>(table: SheetTable<T>, id: string, change: (doc: T) => T) {
  await table.db.transaction('rw', table.name, async () => {
    const doc = await table.get(id)
    if (!doc || doc.status !== 'submitted') throw new SheetStateError('changed')
    await table.put({ ...change(doc), updatedAt: nowIso() })
  })
}

export function approveIn<T extends SheetMeta>(table: SheetTable<T>, id: string, by: Employee) {
  return transition(table, id, (d) => ({ ...d, status: 'approved', approvedBy: by.id, approvedAt: nowIso() }))
}

export function returnIn<T extends SheetMeta>(table: SheetTable<T>, id: string, reason: string) {
  const text = reason.trim()
  if (!text) return Promise.reject(new SheetStateError('reason_needed'))
  return transition(table, id, (d) => ({ ...d, status: 'returned', returnedReason: text, approvedBy: null, approvedAt: null }))
}
