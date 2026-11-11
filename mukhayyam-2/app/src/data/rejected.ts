import { db, getMeta } from './db'
import type { Employee } from '../types'

export interface RejectedWrite {
  id: string
  source: 'actions' | 'seals'
  label: string
  code: string
  at: string
  payload: Record<string, unknown>
}
const keyOf = (owner: string) => `sync:rejected:${owner}`
const PRIVATE = /password|pin|token|secret|auth_user|source_b64|anon_key|api.?key|authorization|cookie|credential|url/i
export function safeRejectedValue(value: unknown): unknown {
  if (typeof value === 'string')
    return value
      .replace(/(\/(?:t|a)\/)[^/?#\s]+(?:[?#][^\s]*)?/g, '$1[محجوب]')
      .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g, '[محجوب]')
  if (Array.isArray(value)) return value.map(safeRejectedValue)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => !PRIVATE.test(k))
        .map(([k, v]) => [k, safeRejectedValue(v)]),
    )
  return value
}
export const rejectedWrites = async (owner: string) => (await getMeta<RejectedWrite[]>(keyOf(owner))) ?? []
/** Save before removing a refused queue item. Full storage/history keeps it queued. */
export async function rememberRejected(write: Omit<RejectedWrite, 'at'>): Promise<boolean> {
  const owner = (await getMeta<Employee>('profile'))?.id
  if (!owner) return false
  return db.transaction('rw', db.meta, async () => {
    const rows = await rejectedWrites(owner)
    if (rows.some((r) => r.id === write.id && r.source === write.source)) return true
    if (rows.length >= 1000) return false
    await db.meta.put({
      key: keyOf(owner),
      value: [...rows, { ...write, at: new Date().toISOString(), payload: safeRejectedValue(write.payload) }],
    })
    return true
  })
}
export async function dismissRejected(owner: string, id: string, source: RejectedWrite['source']) {
  await db.transaction('rw', db.meta, async () => {
    await db.meta.put({
      key: keyOf(owner),
      value: (await rejectedWrites(owner)).filter((r) => r.id !== id || r.source !== source),
    })
  })
}
