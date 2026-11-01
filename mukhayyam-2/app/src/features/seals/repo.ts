import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect } from 'react'
import { isDemo } from '../../config'
import { db, getMeta, setMeta } from '../../data/db'
import { getSupabase } from '../../data/supabase'
import { useEmployeeNames } from '../generation/repo'
import type { Seal, SealBatch, SealData, SealRoll, SealStatus } from './model'

// Seals live on the server (everyone sees the same numbers); this device keeps a copy so searching
// is instant. Writing needs internet and goes through server functions that check every rule.

export class SealError extends Error {
  constructor(public code: string, public arg?: string) {
    super(arg ? `${code}:${arg}` : code)
  }
}

const isoDate = (d: string | null) => d ?? null

interface SealRow {
  seal_no: number
  roll_id: string
  status: SealStatus
  batch_id: string | null
  batch_pos: number | null
  technician_id: string | null
  issued_on: string | null
  used_on: string | null
  details: string | null
  board_no: string | null
  updated_at: string
}
interface RollRow { id: string; from_no: number; to_no: number; received_on: string; note: string | null }
interface BatchRow { id: string; roll_id: string; batch_no: number; technician_id: string; issued_on: string; note: string | null }

const sealFromRow = (r: SealRow): Seal => ({
  sealNo: r.seal_no,
  rollId: r.roll_id,
  status: r.status,
  batchId: r.batch_id,
  batchPos: r.batch_pos,
  technicianId: r.technician_id,
  issuedOn: isoDate(r.issued_on),
  usedOn: isoDate(r.used_on),
  details: r.details ?? '',
  boardNo: r.board_no ?? '',
})

function client() {
  const sb = getSupabase()
  if (!sb) throw new SealError('unknown')
  if (!navigator.onLine) throw new SealError('offline')
  return sb
}

const CURSOR = 'pull:seals'
let loading: Promise<void> | null = null

/** Brings the seals up to date: everything on the first look, then only what changed since. */
export function refreshSeals(): Promise<void> {
  if (isDemo) return Promise.resolve()
  const sb = getSupabase()
  if (!sb || !navigator.onLine) return Promise.resolve()
  if (loading) return loading
  loading = (async () => {
    // Rolls and batches are few: read them whole, so a deleted one disappears here too.
    const [rolls, batches] = await Promise.all([
      sb.from('seal_rolls').select('id, from_no, to_no, received_on, note').order('from_no'),
      sb.from('seal_batches').select('id, roll_id, batch_no, technician_id, issued_on, note'),
    ])
    if (rolls.error || batches.error) return
    const rollRows = (rolls.data ?? []) as RollRow[]
    const batchRows = (batches.data ?? []) as BatchRow[]

    let cursor = await getMeta<string>(CURSOR)
    const changed: SealRow[] = []
    for (;;) {
      let q = sb.from('seals').select('*').order('updated_at', { ascending: true }).order('seal_no').limit(1000)
      if (cursor) q = q.gte('updated_at', cursor)
      const { data, error } = await q
      if (error) return
      const rows = (data ?? []) as SealRow[]
      changed.push(...rows)
      const last = rows.at(-1)?.updated_at
      if (rows.length < 1000 || !last || last === cursor) break
      cursor = last
    }

    await db.transaction('rw', db.sealRolls, db.sealBatches, db.seals, db.meta, async () => {
      await db.sealRolls.clear()
      await db.sealRolls.bulkPut(rollRows.map((r): SealRoll => ({ id: r.id, fromNo: r.from_no, toNo: r.to_no, receivedOn: r.received_on, note: r.note ?? '' })))
      await db.sealBatches.clear()
      await db.sealBatches.bulkPut(batchRows.map((b): SealBatch => ({ id: b.id, rollId: b.roll_id, batchNo: b.batch_no, technicianId: b.technician_id, issuedOn: b.issued_on, note: b.note ?? '' })))
      if (changed.length) await db.seals.bulkPut(changed.map(sealFromRow))
      // Seals of a roll that no longer exists, and seals whose batch was removed.
      const rollIds = new Set(rollRows.map((r) => r.id))
      const batchIds = new Set(batchRows.map((b) => b.id))
      const gone = (await db.seals.toArray()).filter((s) => !rollIds.has(s.rollId)).map((s) => s.sealNo)
      if (gone.length) await db.seals.bulkDelete(gone)
      const orphans = (await db.seals.where('batchId').notEqual('').toArray()).filter((s) => s.batchId && !batchIds.has(s.batchId))
      if (orphans.length) await db.seals.bulkPut(orphans.map((s) => ({ ...s, batchId: null })))
      const newest = changed.at(-1)?.updated_at
      if (newest) await setMeta(CURSOR, newest)
    })
  })().finally(() => {
    loading = null
  })
  return loading
}

/** Opens fresh, and stays fresh while the page is open (someone else may be entering too). */
export function useSealsLive() {
  useEffect(() => {
    void refreshSeals()
    const id = window.setInterval(() => document.visibilityState === 'visible' && void refreshSeals(), 20_000)
    const wake = () => document.visibilityState === 'visible' && void refreshSeals()
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('online', wake)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('online', wake)
    }
  }, [])
}

export function useSealData(): SealData | undefined {
  const names = useEmployeeNames()
  const data = useLiveQuery(async () => {
    const [rolls, batches, seals] = await Promise.all([db.sealRolls.toArray(), db.sealBatches.toArray(), db.seals.toArray()])
    return { rolls: rolls.sort((a, b) => b.receivedOn.localeCompare(a.receivedOn) || b.fromNo - a.fromNo), batches, seals }
  }, [])
  return data ? { ...data, names } : undefined
}

/** People seals can be handed to: active technicians. */
export function useTechnicians() {
  return useLiveQuery(async () => (await db.employees.toArray()).filter((e) => e.role === 'technician' && e.isActive).sort((a, b) => a.fullName.localeCompare(b.fullName, 'ar')), []) ?? []
}

// ---------- Writing (through the server's functions) ----------
function fail(error: { code?: string; message?: string }, status: number): never {
  if (status === 0 || !error.code) throw new SealError('offline')
  const m = /^([a-z_]+)(?::(.*))?$/.exec(error.message ?? '')
  if (error.code === '42501') throw new SealError('not_allowed')
  if (error.code === 'PGRST202') throw new SealError('not_installed')
  throw new SealError(m?.[1] ?? 'unknown', m?.[2])
}

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const sb = client()
  const res = await sb.rpc(fn, args)
  if (res.error) fail(res.error, res.status)
  await refreshSeals()
  return res.data as T
}

export const addRoll = (fromNo: number, toNo: number | null, receivedOn: string, note: string) =>
  call<string>('seal_add_roll', { p_from: fromNo, p_to: toNo, p_received: receivedOn, p_note: note || null })

export const issueBatch = (technicianId: string, issuedOn: string, seals: number[], note = '') =>
  call<{ batch_id: string; batch_no: number; roll_id: string; count: number }>('seal_issue', { p_technician: technicianId, p_issued_on: issuedOn, p_seals: seals, p_note: note || null })

export const unissue = (seals: number[]) => call<number>('seal_unissue', { p_seals: seals })

export const recordSeal = (sealNo: number, status: 'used' | 'damaged' | 'lost' | 'issued', usedOn: string | null, details: string) =>
  call<void>('seal_record', { p_seal: sealNo, p_status: status, p_date: usedOn, p_details: details })

export const deleteRoll = (rollId: string) => call<void>('seal_delete_roll', { p_roll: rollId })

export const updateBatch = (batchId: string, technicianId: string, issuedOn: string) =>
  call<void>('seal_update_batch', { p_batch: batchId, p_technician: technicianId, p_issued_on: issuedOn })

export const deleteBatch = (batchId: string) => call<number>('seal_delete_batch', { p_batch: batchId })

/** Takes seals back to the stock; a used one loses its record. */
export const returnToStock = (seals: number[]) => call<number>('seal_return_to_stock', { p_seals: seals })

export const updateRoll = (rollId: string, receivedOn: string, note: string) =>
  call<void>('seal_update_roll', { p_roll: rollId, p_received: receivedOn, p_note: note || null })

export const importTechnician = async (name: string) => {
  const sb = client()
  const res = await sb.rpc('seal_import_technician', { p_name: name })
  if (res.error) fail(res.error, res.status)
  return res.data as string
}

export const importRoll = async (payload: unknown) => {
  const sb = client()
  const res = await sb.rpc('seal_import_roll', { p: payload })
  if (res.error) fail(res.error, res.status)
  return res.data as { skipped?: boolean; batches?: number; issued?: number; outside?: number; used?: number; unmatched?: number }
}

const messages: Record<string, string> = {
  offline: 'يحتاج إنترنت. اتصل وحاول مرة أخرى.',
  not_allowed: 'ما عندك صلاحية لهذا الإجراء.',
  not_installed: 'قاعدة البيانات تحتاج آخر تحديث. شغّل ملف update-catchup.sql في Supabase.',
  bad_range: 'الأرقام غير صحيحة: «من» أصغر من أو تساوي «إلى»، وبحد أقصى 1000 ختم.',
  bad_date: 'التاريخ غير صحيح.',
  roll_overlap: 'هذه الأرقام داخلة في رول مسجّل من قبل.',
  no_seals: 'اكتب أرقام الأختام.',
  duplicate_seal: 'في رقم مكرر بالقائمة.',
  bad_technician: 'الأختام تُصرف للفنيين فقط.',
  mixed_rolls: 'الدفعة الواحدة من رول واحد. اصرف كل رول لحاله.',
  already_used: 'لا يمكن إرجاع ختم استُخدم.',
  roll_in_use: 'لا يمكن حذف رول خرجت منه أختام. احذف دفعاته أولاً.',
  missing: 'لم أجده، حدّث الصفحة.',
  bad_status: 'الحالة غير صحيحة.',
}
export function sealErrorText(e: unknown): string {
  if (!(e instanceof SealError)) return 'تعذّر الحفظ. حاول مرة أخرى.'
  if (e.code === 'unknown_seal') return `الرقم ${e.arg} غير موجود في أي رول مسجّل.`
  if (e.code === 'not_available') return `الختم ${e.arg} ليس في المخزن (انصرف من قبل أو تالف).`
  if (e.code === 'not_issued') return `الختم ${e.arg} لم يُصرف لفني بعد.`
  return messages[e.code] ?? 'تعذّر الحفظ. حاول مرة أخرى.'
}
