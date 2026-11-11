import { rememberRejected } from '../../data/rejected'
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
interface RollRow { id: string; from_no: number; to_no: number; received_on: string; note: string | null; header_text?: string | null; sheet_label?: string | null; sheet_pos?: number | null; sheet_col?: number | null; sheet_width?: number | null; sheet_tab?: string | null }
interface BatchRow { id: string; roll_id: string; batch_no: number; technician_id: string | null; issued_on: string; note: string | null; original_seals?: number[] | null; block_from?: number | null; block_ord?: number | null; label?: string | null; usage_ord?: number | null; usage_fill?: string | null }

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

const SEAL_COLS = 'seal_no,roll_id,status,batch_id,batch_pos,technician_id,issued_on,used_on,details,board_no,updated_at'
const CURSOR = 'pull:seals'
const READY = 'seals:ready'
const PAGE = 1000
let loading: Promise<void> | null = null

/** A short fingerprint of what was last written, so an unchanged list is not rewritten (and the page not redrawn). */
const stamp = (rows: unknown[]) => {
  const t = JSON.stringify(rows)
  let h = 5381
  for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0
  return `${rows.length}:${h}`
}

/**
 * Brings the seals up to date. The very first time everything is read in parallel (the rolls tell
 * how many seals there are); after that only what changed since the last look.
 */
export async function refreshSeals(afterWrite = false): Promise<void> {
  if (isDemo) return
  // A read already under way may have started before our own write: wait for it, then read again.
  if (loading && afterWrite) await loading.catch(() => undefined)
  // Things written without internet go first, or the server's older copy would cover them.
  if (!flushing && (await getSealQueue()).length > 0) await flushSealQueue()
  return readSeals()
}

function readSeals(): Promise<void> {
  const sb = getSupabase()
  if (!sb || !navigator.onLine) return Promise.resolve()
  if (loading) return loading
  loading = (async () => {
    let cursor = await getMeta<string>(CURSOR)
    // Rolls and batches are few: read them whole, so a deleted one disappears here too.
    const [rolls, batches, counted] = await Promise.all([
      sb.from('seal_rolls').select('*').order('from_no'),
      sb.from('seal_batches').select('*'),
      sb.from('seals').select('seal_no', { count: 'exact', head: true }),
    ])
    if (rolls.error || batches.error || counted.error) return
    const rollRows = (rolls.data ?? []) as RollRow[]
    const batchRows = (batches.data ?? []) as BatchRow[]

    const changed: SealRow[] = []
    // Every seal of every roll should be here; if the count is off for any reason, read everything again.
    const total = counted.count ?? rollRows.reduce((n, r) => n + (r.to_no - r.from_no + 1), 0)
    const heal = !!cursor && (await db.seals.count()) !== total
    if (heal) cursor = undefined
    if (!cursor) {
      const pages = await Promise.all(
        Array.from({ length: Math.ceil(total / PAGE) }, (_, i) => sb.from('seals').select(SEAL_COLS).order('seal_no').range(i * PAGE, i * PAGE + PAGE - 1)),
      )
      if (pages.some((r) => r.error)) return
      for (const r of pages) changed.push(...((r.data ?? []) as SealRow[]))
      changed.sort((a, b) => a.updated_at.localeCompare(b.updated_at))
    } else {
      for (;;) {
        let q = sb.from('seals').select(SEAL_COLS).order('updated_at', { ascending: true }).order('seal_no').limit(PAGE)
        if (cursor) q = q.gte('updated_at', cursor)
        const { data, error } = await q
        if (error) return
        const rows = (data ?? []) as SealRow[]
        changed.push(...rows)
        const last = rows.at(-1)?.updated_at
        if (rows.length < PAGE || !last || last === cursor) break
        cursor = last
      }
    }

    const rollsNow = rollRows.map((r): SealRoll => ({ id: r.id, fromNo: r.from_no, toNo: r.to_no, receivedOn: r.received_on, note: r.note ?? '', headerText: r.header_text ?? null, sheetLabel: r.sheet_label ?? null, sheetPos: r.sheet_pos ?? null, sheetCol: r.sheet_col ?? null, sheetWidth: r.sheet_width == null ? null : Number(r.sheet_width), sheetTab: r.sheet_tab ?? null }))
    const batchesNow = batchRows.map((b): SealBatch => ({ id: b.id, rollId: b.roll_id, batchNo: b.batch_no, technicianId: b.technician_id, issuedOn: b.issued_on, note: b.note ?? '', originalSeals: b.original_seals ?? null, blockFrom: b.block_from ?? null, blockOrd: b.block_ord ?? null, label: b.label ?? null, usageOrd: b.usage_ord ?? null, usageFill: b.usage_fill ?? null }))
    const rollStamp = stamp(rollsNow)
    const batchStamp = stamp(batchesNow)
    const [oldRoll, oldBatch] = await Promise.all([getMeta<string>('seals:rolls'), getMeta<string>('seals:batches')])
    const rollsChanged = rollStamp !== oldRoll
    const batchesChanged = batchStamp !== oldBatch

    await db.transaction('rw', db.sealRolls, db.sealBatches, db.seals, db.meta, async () => {
      if (rollsChanged) {
        await db.sealRolls.clear()
        await db.sealRolls.bulkPut(rollsNow)
        await setMeta('seals:rolls', rollStamp)
      }
      if (batchesChanged) {
        await db.sealBatches.clear()
        await db.sealBatches.bulkPut(batchesNow)
        await setMeta('seals:batches', batchStamp)
      }
      if (heal) await db.seals.clear()
      if (changed.length) await db.seals.bulkPut(changed.map(sealFromRow))
      if (rollsChanged || batchesChanged) {
        // Seals of a roll that no longer exists, and seals whose batch was removed.
        const rollIds = new Set(rollRows.map((r) => r.id))
        const batchIds = new Set(batchRows.map((b) => b.id))
        const gone = (await db.seals.toArray()).filter((s) => !rollIds.has(s.rollId)).map((s) => s.sealNo)
        if (gone.length) await db.seals.bulkDelete(gone)
        const orphans = (await db.seals.where('batchId').notEqual('').toArray()).filter((s) => s.batchId && !batchIds.has(s.batchId))
        if (orphans.length) await db.seals.bulkPut(orphans.map((s) => ({ ...s, batchId: null })))
      }
      const newest = changed.at(-1)?.updated_at
      if (newest) await setMeta(CURSOR, newest)
      await setMeta(READY, true)
    })
  })().finally(() => {
    loading = null
  })
  return loading
}

/** False until the seals have been read from the server once on this device. */
export function useSealsReady(): boolean {
  return useLiveQuery(async () => !!(await getMeta<boolean>(READY)), [], false) ?? false
}

// ---------- Live: what one accountant does shows on the other's screen at once ----------
// Every write tells the others over a shared channel («changed»); the database's own change feed does
// the same when the project has it on (update-17.sql). The timer below is only the last resort.
type Channel = { send(m: { type: 'broadcast'; event: string; payload: object }): unknown; unsubscribe(): unknown }
let channel: Channel | null = null
let listeners = 0
let nudge: number | undefined

const refreshSoon = () => {
  window.clearTimeout(nudge)
  nudge = window.setTimeout(() => void refreshSeals(true), 150)
}

function openChannel() {
  const sb = getSupabase()
  if (isDemo || !sb || channel) return
  try {
    const ch = sb.channel('m2-seals', { config: { broadcast: { self: false } } })
    ch.on('broadcast', { event: 'changed' }, refreshSoon)
    for (const table of ['seals', 'seal_batches', 'seal_rolls']) ch.on('postgres_changes', { event: '*', schema: 'public', table }, refreshSoon)
    ch.subscribe()
    channel = ch as unknown as Channel
  } catch {
    channel = null
  }
}

function closeChannel() {
  const sb = getSupabase()
  if (channel && sb) void sb.removeChannel(channel as never)
  channel = null
}

/** Tells everyone else with the seals open that something changed. */
function announce() {
  openChannel()
  try {
    channel?.send({ type: 'broadcast', event: 'changed', payload: {} })
  } catch {
    // The others catch up on their next look.
  }
}

/** Opens fresh, and stays fresh while the page is open (someone else may be entering too). */
export function useSealsLive() {
  useEffect(() => {
    void refreshSeals()
    if (listeners++ === 0) openChannel()
    const id = window.setInterval(() => document.visibilityState === 'visible' && void refreshSeals(), 8_000)
    const wake = () => document.visibilityState === 'visible' && void refreshSeals()
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('online', wake)
    return () => {
      if (--listeners === 0) closeChannel()
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
  const sheets = useLiveQuery(async () => new Map((await db.employees.toArray()).flatMap((e) => (e.sealsSheet ? [[e.id, e.sealsSheet] as [string, string]] : []))), [])
  return data ? { ...data, names, sheets: sheets ?? new Map() } : undefined
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

// ---------- Working without internet ----------
// What she writes is kept on this device at once and shown as done; the server gets it as soon as the
// internet is there, in the same order. Rolls (rare, and others depend on them) still need internet.
interface QueuedOp {
  id: string
  fn: string
  args: Record<string, unknown>
  /** A batch made here before the server knew it: the later steps that name it are renamed after sending. */
  tmp?: string
}
const QUEUE = 'seals:queue'
const TMP = 'tmp-'
const OFFLINE_OK = new Set(['seal_issue', 'seal_record', 'seal_add_to_batch', 'seal_assign_batch', 'seal_update_batch', 'seal_return_to_stock', 'seal_unissue', 'seal_delete_batch'])
const SEND_LIMIT_MS = 12_000

export const getSealQueue = async () => (await getMeta<QueuedOp[]>(QUEUE)) ?? []
let lock: Promise<unknown> = Promise.resolve()
const locked = <T,>(job: () => Promise<T>): Promise<T> => {
  const run = lock.then(job, job)
  lock = run.catch(() => undefined)
  return run
}

/** Tells the toast layer something (the toasts live in React; this file does not). */
const say = (text: string, tone: 'ok' | 'danger' = 'ok') => window.dispatchEvent(new CustomEvent('m2-toast', { detail: { text, tone } }))

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Gaza' })

/** The same change on this device's copy, so the screen shows it straight away. */
async function applyLocal(fn: string, args: Record<string, unknown>, opId: string): Promise<{ result: unknown; tmp?: string }> {
  const nums = (args.p_seals ?? []) as number[]
  const clear = { status: 'in_stock' as SealStatus, batchId: null, batchPos: null, technicianId: null, issuedOn: null, usedOn: null, details: '', boardNo: '' }
  const dropEmptyBatches = async (ids: (string | null)[]) => {
    for (const id of new Set(ids.filter(Boolean) as string[])) {
      const b = await db.sealBatches.get(id)
      if (b && (await db.seals.where('batchId').equals(id).count()) === 0 && (b.originalSeals === null || id.startsWith(TMP))) await db.sealBatches.delete(id)
    }
  }
  switch (fn) {
    case 'seal_record': {
      const no = args.p_seal as number
      const st = args.p_status as SealStatus
      const line = String(args.p_details ?? '')
      await db.seals.update(no, st === 'issued' ? { status: st, usedOn: null, details: '', boardNo: '' } : { status: st, usedOn: (args.p_date as string | null) ?? today(), details: line })
      return { result: null }
    }
    case 'seal_issue': {
      const first = await db.seals.get(nums[0]!)
      const rollId = first?.rollId ?? ''
      const mine = (await db.sealBatches.where('id').notEqual('').toArray()).filter((b) => b.rollId === rollId)
      const batchNo = Math.max(0, ...mine.map((b) => b.batchNo)) + 1
      const tmp = `${TMP}${opId}`
      await db.sealBatches.put({ id: tmp, rollId, batchNo, technicianId: (args.p_technician as string | null) ?? null, issuedOn: args.p_issued_on as string, note: String(args.p_note ?? ''), originalSeals: nums, blockFrom: null, blockOrd: null, label: null, usageOrd: null, usageFill: null })
      await Promise.all(nums.map((n, i) => db.seals.update(n, { status: 'issued', batchId: tmp, batchPos: i + 1, technicianId: (args.p_technician as string | null) ?? null, issuedOn: args.p_issued_on as string, usedOn: null, details: '', boardNo: '' })))
      return { result: { batch_id: tmp, batch_no: batchNo, roll_id: rollId, count: nums.length }, tmp }
    }
    case 'seal_add_to_batch': {
      const id = args.p_batch as string
      const b = await db.sealBatches.get(id)
      const pos = Math.max(0, ...(await db.seals.where('batchId').equals(id).toArray()).map((x) => x.batchPos ?? 0))
      await Promise.all(nums.map((n, i) => db.seals.update(n, { status: 'issued', batchId: id, batchPos: pos + i + 1, technicianId: b?.technicianId ?? null, issuedOn: b?.issuedOn ?? null, usedOn: null, details: '', boardNo: '' })))
      if (b) await db.sealBatches.update(id, { originalSeals: null })
      return { result: nums.length }
    }
    case 'seal_assign_batch': {
      const id = args.p_batch as string
      await db.sealBatches.update(id, { technicianId: args.p_technician as string })
      await db.seals.where('batchId').equals(id).modify({ technicianId: args.p_technician as string })
      return { result: null }
    }
    case 'seal_update_batch': {
      const id = args.p_batch as string
      await db.sealBatches.update(id, { technicianId: args.p_technician as string, issuedOn: args.p_issued_on as string })
      await db.seals.where('batchId').equals(id).modify({ technicianId: args.p_technician as string, issuedOn: args.p_issued_on as string })
      return { result: null }
    }
    case 'seal_return_to_stock':
    case 'seal_unissue': {
      const was = (await db.seals.bulkGet(nums)).map((x) => x?.batchId ?? null)
      await Promise.all(nums.map((n) => db.seals.update(n, clear)))
      await dropEmptyBatches(was)
      return { result: nums.length }
    }
    case 'seal_delete_batch': {
      const id = args.p_batch as string
      await db.seals.where('batchId').equals(id).modify(clear)
      await db.sealBatches.delete(id)
      return { result: 0 }
    }
    default:
      return { result: null }
  }
}

async function queueOp<T>(fn: string, args: Record<string, unknown>, notify: boolean): Promise<T> {
  const op: QueuedOp = { id: crypto.randomUUID(), fn, args }
  const done = await applyLocal(fn, args, op.id)
  if (done.tmp) op.tmp = done.tmp
  await locked(async () => setMeta(QUEUE, [...(await getSealQueue()), op]))
  if (notify) say('انحفظ على جهازك · بانتظار الإنترنت، وبينرسل لحاله لما يرجع')
  else void flushSealQueue()
  return done.result as T
}

async function send<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const sb = client()
  const res = await sb.rpc(fn, args).abortSignal(AbortSignal.timeout(SEND_LIMIT_MS))
  if (res.error) fail(res.error, res.status)
  await refreshSeals(true)
  announce()
  return res.data as T
}

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  if (!OFFLINE_OK.has(fn) || isDemo || !getSupabase()) return send<T>(fn, args)
  const waiting = (await getSealQueue()).length > 0
  if (!navigator.onLine) return queueOp<T>(fn, args, true)
  // Earlier things still waiting: this one goes behind them, so the order stays as written.
  if (waiting) return queueOp<T>(fn, args, false)
  try {
    return await send<T>(fn, args)
  } catch (e) {
    if (e instanceof SealError && e.code === 'offline') return queueOp<T>(fn, args, true)
    throw e
  }
}

let flushing: Promise<void> | null = null
/** Sends what was written without internet, one by one, oldest first. */
export function flushSealQueue(): Promise<void> {
  if (flushing) return flushing
  flushing = (async () => {
    const sb = getSupabase()
    if (isDemo || !sb || !navigator.onLine) return
    let sent = 0
    let refused = 0
    for (;;) {
      const op = (await getSealQueue())[0]
      if (!op) break
      const res = await sb.rpc(op.fn, op.args).abortSignal(AbortSignal.timeout(SEND_LIMIT_MS * 2))
      if (res.error) {
        let code = ''
        try { fail(res.error, res.status) } catch (e) { code = e instanceof SealError ? e.code : '' }
        // No internet or the server is busy: keep it and try again later.
        if (code === 'offline' || code === 'not_installed' || code === 'unknown') break
        if (!(await rememberRejected({ source:'seals', id:op.id, label:op.fn==='seal_issue' ? 'صرف دفعة أختام' : op.fn==='seal_record' ? 'تسجيل شغل ختم' : 'تعديل أختام', code, payload:{ fn:op.fn,args:op.args } }))) { say('سجل العمليات المرفوضة ممتلئ. راجعه من حسابي؛ العملية بعدها بالطابور.','danger'); break }
        refused++
      } else sent++
      const real = op.tmp && !res.error ? (res.data as { batch_id?: string } | null)?.batch_id : undefined
      await locked(async () => {
        const rest = (await getSealQueue()).filter((o) => o.id !== op.id)
        await setMeta(QUEUE, op.tmp && real ? rest.map((o) => (o.args.p_batch === op.tmp ? { ...o, args: { ...o.args, p_batch: real } } : o)) : rest)
      })
    }
    if (sent + refused > 0 && (await getSealQueue()).length === 0) {
      // The names given here to batches are gone now: the server's own list replaces them.
      await db.sealBatches.filter((b) => b.id.startsWith(TMP)).delete()
      await setMeta('seals:batches', '')
      if (loading) await loading.catch(() => undefined)
      await readSeals()
      announce()
      if (sent > 0) say(`وصل المدير ${sent} ${sent > 10 ? 'عملية' : 'عمليات'} على الأختام`)
      if (refused > 0) say(`${refused} من عمليات الأختام ما انقبلت (تعارضت مع شي تغيّر). تفاصيلها محفوظة في حسابي.`, 'danger')
    }
  })().finally(() => {
    flushing = null
  })
  return flushing
}

/** Called once when the app starts: sends what is waiting whenever the internet is back. */
export function startSealQueue() {
  const go = () => void flushSealQueue()
  window.addEventListener('online', go)
  window.setInterval(() => navigator.onLine && go(), 20_000)
  go()
}

export const addRoll = (fromNo: number, toNo: number | null, receivedOn: string, note: string) =>
  call<string>('seal_add_roll', { p_from: fromNo, p_to: toNo, p_received: receivedOn, p_note: note || null })

export const issueBatch = (technicianId: string | null, issuedOn: string, seals: number[], note = '') =>
  call<{ batch_id: string; batch_no: number; roll_id: string; count: number }>('seal_issue', { p_technician: technicianId, p_issued_on: issuedOn, p_seals: seals, p_note: note || null })

/** Gives a prepared batch its name. */
export const assignBatch = (batchId: string, technicianId: string) => call<void>('seal_assign_batch', { p_batch: batchId, p_technician: technicianId })

export const unissue = (seals: number[]) => call<number>('seal_unissue', { p_seals: seals })

export const recordSeal = (sealNo: number, status: 'used' | 'damaged' | 'lost' | 'issued', usedOn: string | null, details: string) =>
  call<void>('seal_record', { p_seal: sealNo, p_status: status, p_date: usedOn, p_details: details })

export const deleteRoll = (rollId: string) => call<void>('seal_delete_roll', { p_roll: rollId })

export const updateBatch = (batchId: string, technicianId: string, issuedOn: string) =>
  call<void>('seal_update_batch', { p_batch: batchId, p_technician: technicianId, p_issued_on: issuedOn })

/** Adds new seals (still in stock, from the batch's own roll) to a batch already made. */
export const addToBatch = (batchId: string, seals: number[]) => call<number>('seal_add_to_batch', { p_batch: batchId, p_seals: seals })

export const deleteBatch = (batchId: string) => call<number>('seal_delete_batch', { p_batch: batchId })

/** Takes seals back to the stock; a used one loses its record. */
export const returnToStock = (seals: number[]) => call<number>('seal_return_to_stock', { p_seals: seals })

export const updateRoll = (rollId: string, receivedOn: string, note: string) =>
  call<void>('seal_update_roll', { p_roll: rollId, p_received: receivedOn, p_note: note || null })

export const importTechnician = async (name: string, sheet: string | null = null) => {
  const sb = client()
  const res = await sb.rpc('seal_import_technician', { p_name: name, p_sheet: sheet })
  if (res.error) fail(res.error, res.status)
  return res.data as string
}

export const importUsage = async (rows: unknown[]) => {
  const sb = client()
  const res = await sb.rpc('seal_import_usage', { p: rows })
  if (res.error) fail(res.error, res.status)
  return res.data as number
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
