import { useLiveQuery } from 'dexie-react-hooks'
import { isDemo } from '../../config'
import { db } from '../../data/db'
import { getSupabase } from '../../data/supabase'
import { flushActions, getActions, onActionsSent, runOrQueue } from '../../data/actions'
import { serverNow } from '../../lib/clock'
import { bySortOrder } from '../generation/repo'
import { SheetStateError } from '../sheets/workflow'
import type { MoveKind, StockMove } from './model'

// The warehouse lives on the server; managers' devices keep a copy for reading. Entering stock
// needs internet. Demo mode keeps everything here.

interface MoveRow {
  id: string
  item_id: number
  kind: MoveKind
  qty: number
  at: string
  note: string | null
  ref: string | null
  task_id: string | null
  created_by: string | null
}
const moveFromRow = (r: MoveRow): StockMove => ({
  id: r.id,
  itemId: r.item_id,
  kind: r.kind,
  qty: Number(r.qty),
  at: r.at,
  note: r.note ?? '',
  ref: r.ref ?? '',
  taskId: r.task_id,
  createdBy: r.created_by,
})

export const useStockItems = () => useLiveQuery(async () => (await db.stockItems.toArray()).sort(bySortOrder), [])
export const useStockMoves = () => useLiveQuery(async () => (await db.stockMoves.toArray()).sort((a, b) => b.at.localeCompare(a.at)), [])

export async function refreshStock(): Promise<void> {
  if (isDemo) return
  const sb = getSupabase()
  if (!sb || !navigator.onLine) return
  await flushActions()
  const waiting = new Set((await getActions()).filter((a) => a.table === 'stock_moves').map((a) => String(a.row?.id ?? a.rowId)))
  const rows: MoveRow[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('stock_moves').select('id, item_id, kind, qty, at, note, ref, task_id, created_by').order('at').range(from, from + 999)
    if (error || !data) return
    rows.push(...(data as MoveRow[]))
    if (data.length < 1000) break
  }
  await db.transaction('rw', db.stockMoves, async () => {
    const mine = (await db.stockMoves.toArray()).filter((m) => waiting.has(m.id))
    await db.stockMoves.clear()
    await db.stockMoves.bulkPut([...rows.map(moveFromRow).filter((m) => !waiting.has(m.id)), ...mine])
  })
}

/** A receipt or a hand-out; taskId ties materials to a field task. */
export async function addMove(input: { itemId: number; kind: MoveKind; qty: number; ref?: string; note?: string; taskId?: string | null }, by: string) {
  if (!(input.qty > 0)) throw new SheetStateError('bad_qty')
  if (isDemo) {
    await db.stockMoves.put({ id: crypto.randomUUID(), itemId: input.itemId, kind: input.kind, qty: input.qty, at: serverNow().toISOString(), note: input.note ?? '', ref: input.ref ?? '', taskId: input.taskId ?? null, createdBy: by })
    return
  }
  const id = crypto.randomUUID()
  const local = () => db.stockMoves.put({ id, itemId: input.itemId, kind: input.kind, qty: input.qty, at: serverNow().toISOString(), note: input.note ?? '', ref: input.ref ?? '', taskId: input.taskId ?? null, createdBy: by }).then(() => undefined)
  try {
    if ((await runOrQueue({ table: 'stock_moves', op: 'insert', row: { id, item_id: input.itemId, kind: input.kind, qty: input.qty, ref: input.ref || null, note: input.note || null, task_id: input.taskId ?? null }, label: 'حركة مخزن' }, local)) === 'sent') { await local(); void refreshStock() }
  } catch {
    throw new SheetStateError('unknown')
  }
}

export async function deleteMove(id: string) {
  if (isDemo) return void (await db.stockMoves.delete(id))
  try {
    await runOrQueue({ table: 'stock_moves', op: 'delete', rowId: id, label: 'حذف حركة مخزن' }, () => db.stockMoves.delete(id).then(() => undefined))
    await db.stockMoves.delete(id)
  } catch {
    throw new SheetStateError('unknown')
  }
}

onActionsSent(refreshStock)
