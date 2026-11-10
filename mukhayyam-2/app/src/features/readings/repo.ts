import { flushActions, getActions, runOrQueue } from '../../data/actions'
import { getMeta, setMeta } from '../../data/db'
import { getSupabase } from '../../data/supabase'
import type { ReadFile } from './excel'
import type { ReadingBatch, ReadingRow, ReadingState } from './model'

// Readings live on the server. Each phone keeps its own list (and what was typed) on the device,
// so a reader works the whole week without internet, closes the app, opens it again, and finds it all.

const COLS = 'id, batch_id, ord, sheet_row, code, area, board, fak, subscriber, phone, prev, mode, assignee_id, reading, state, note, entered_at, file_id, sheet'
type Raw = Record<string, unknown>
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))

const rowFrom = (r: Raw): ReadingRow => ({
  id: r.id as string,
  batchId: r.batch_id as string,
  ord: r.ord as number,
  sheetRow: r.sheet_row as number,
  code: (r.code as string) ?? '',
  area: (r.area as string) ?? '',
  board: (r.board as string) ?? '',
  fak: (r.fak as string | null) ?? null,
  subscriber: (r.subscriber as string) ?? '',
  phone: (r.phone as string | null) ?? null,
  prev: n(r.prev),
  mode: (r.mode as ReadingRow['mode']) ?? null,
  assigneeId: (r.assignee_id as string | null) ?? null,
  reading: n(r.reading),
  state: (r.state as ReadingState | null) ?? null,
  note: (r.note as string | null) ?? null,
  enteredAt: (r.entered_at as string | null) ?? null,
  fileId: (r.file_id as string | null) ?? null,
  sheet: (r.sheet as string | null) ?? null,
})
const batchFrom = (b: Raw): ReadingBatch => ({
  id: b.id as string,
  title: b.title as string,
  periodFrom: (b.period_from as string | null) ?? null,
  periodTo: (b.period_to as string | null) ?? null,
  fileName: (b.file_name as string | null) ?? null,
  sheetName: (b.sheet_name as string | null) ?? null,
  currentCol: (b.current_col as number | null) ?? null,
  status: b.status as ReadingBatch['status'],
  createdAt: b.created_at as string,
})

function server() {
  const sb = getSupabase()
  if (!sb || !navigator.onLine) throw new Error('offline')
  return sb
}

async function allRows(build: (from: number) => PromiseLike<{ data: Raw[] | null; error: unknown }>): Promise<ReadingRow[]> {
  const out: ReadingRow[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from)
    if (error) throw new Error('failed')
    out.push(...(data ?? []).map(rowFrom))
    if (!data || data.length < 1000) break
  }
  return out
}

/** What is still waiting to go up, laid over what the server said (so nothing typed ever disappears). */
async function withWaiting(rows: ReadingRow[]): Promise<ReadingRow[]> {
  const waiting = (await getActions()).filter((a) => a.table === 'reading_rows' && a.op === 'update')
  if (!waiting.length) return rows
  const byId = new Map(rows.map((r) => [r.id, r]))
  for (const a of waiting) {
    const r = byId.get(a.rowId!)
    if (r) Object.assign(r, { reading: n(a.row!.reading), state: a.row!.state ?? null, note: a.row!.note ?? null })
  }
  return rows
}

export interface MyReadings { batches: ReadingBatch[]; rows: ReadingRow[]; at: string | null }
const mineKey = (me: string) => `readings:mine:${me}`
const batchKey = (id: string) => `readings:batch:${id}`

/** The reader's list: from the device at once; from the server too when there is internet. */
export async function myReadingsSaved(me: string): Promise<MyReadings> {
  const saved = (await getMeta<MyReadings>(mineKey(me))) ?? { batches: [], rows: [], at: null }
  return { ...saved, rows: await withWaiting(saved.rows) }
}

export async function refreshMyReadings(me: string): Promise<MyReadings | null> {
  const sb = getSupabase()
  if (!sb || !navigator.onLine) return null
  try {
    const { data: bs, error } = await sb.from('reading_batches').select('*').eq('status', 'open').order('created_at', { ascending: false })
    if (error) return null
    const batches = (bs ?? []).map(batchFrom)
    const ids = batches.map((b) => b.id)
    const rows = ids.length
      ? await allRows((from) => sb.from('reading_rows').select(COLS).in('batch_id', ids).eq('assignee_id', me).eq('mode', 'app').order('ord').range(from, from + 999) as unknown as PromiseLike<{ data: Raw[] | null; error: unknown }>)
      : []
    const mine: MyReadings = { batches: batches.filter((b) => rows.some((r) => r.batchId === b.id)), rows, at: new Date().toISOString() }
    await setMeta(mineKey(me), mine)
    return { ...mine, rows: await withWaiting(rows.map((r) => ({ ...r }))) }
  } catch {
    return null
  }
}

/** One reading (or a state instead of it): kept here at once, sent when there is internet. */
export async function saveReading(row: ReadingRow, v: { reading: number | null; state: ReadingState | null; note: string | null }, cacheOf: { me?: string; batch?: string }) {
  const patch = { reading: v.reading, state: v.reading !== null ? null : v.state, note: v.note?.trim() || null }
  const local = async () => {
    for (const key of [cacheOf.me && mineKey(cacheOf.me), cacheOf.batch && batchKey(cacheOf.batch)].filter(Boolean) as string[]) {
      const saved = await getMeta<{ rows: ReadingRow[] }>(key)
      if (!saved) continue
      const r = saved.rows.find((x) => x.id === row.id)
      if (r) Object.assign(r, patch, { enteredAt: new Date().toISOString() })
      await setMeta(key, saved)
    }
  }
  await runOrQueue({ table: 'reading_rows', op: 'update', rowId: row.id, row: patch, label: `قراءة ${row.subscriber}`, quiet: true }, local, { background: true })
  return patch
}

export const flushReadings = () => flushActions()

// ---------- The office (مسؤول القراءات) ----------
export async function listBatches(): Promise<ReadingBatch[]> {
  const { data, error } = await server().from('reading_batches').select('id, title, period_from, period_to, file_name, sheet_name, current_col, status, created_at').order('created_at', { ascending: false }).limit(30)
  if (error) throw new Error('failed')
  return (data ?? []).map(batchFrom)
}

export async function batchSaved(id: string): Promise<ReadingRow[] | null> {
  const saved = await getMeta<{ rows: ReadingRow[] }>(batchKey(id))
  return saved ? withWaiting(saved.rows) : null
}

export async function loadBatchRows(id: string): Promise<ReadingRow[]> {
  const sb = server()
  const rows = await allRows((from) => sb.from('reading_rows').select(COLS).eq('batch_id', id).order('ord').range(from, from + 999) as unknown as PromiseLike<{ data: Raw[] | null; error: unknown }>)
  await setMeta(batchKey(id), { rows })
  return withWaiting(rows.map((r) => ({ ...r })))
}

export async function createBatch(title: string, me: string): Promise<string> {
  const id = crypto.randomUUID()
  const { error } = await server().from('reading_batches').insert({ id, title, created_by: me })
  if (error) throw new Error(error.code === '42501' ? 'not_allowed' : 'failed')
  return id
}

export interface WeekFile { id: string; name: string; rows: number; createdAt: string }

export async function listFiles(batchId: string): Promise<WeekFile[]> {
  const { data, error } = await server().from('reading_files').select('id, file_name, rows_count, created_at').eq('batch_id', batchId).order('created_at')
  if (error) throw new Error('failed')
  return (data ?? []).map((f) => ({ id: f.id as string, name: f.file_name as string, rows: f.rows_count as number, createdAt: f.created_at as string }))
}

/**
 * Adds files to a week. A board area already in the week (written a bit differently) keeps the
 * week's spelling, so «مقبرة» in one file and «المقبرة» in another stay one area.
 */
export async function addFiles(batchId: string, files: Array<{ read: ReadFile; name: string }>, me: string, areaFor: (area: string) => string): Promise<number> {
  const sb = server()
  const { data: last } = await sb.from('reading_rows').select('ord').eq('batch_id', batchId).order('ord', { ascending: false }).limit(1)
  let ord = ((last?.[0]?.ord as number | undefined) ?? 0)
  let added = 0
  for (const f of files) {
    const fileId = crypto.randomUUID()
    const { error } = await sb.from('reading_files').insert({ id: fileId, batch_id: batchId, file_name: f.name, source_b64: f.read.base64, current_col: f.read.currentCol, rows_count: f.read.rows.length, created_by: me })
    if (error) throw new Error('failed')
    const rows = f.read.rows.map((r) => ({ batch_id: batchId, file_id: fileId, sheet: r.sheet ?? null, ord: ++ord, sheet_row: r.sheetRow, code: r.code, area: areaFor(r.area), board: r.board, fak: r.fak, subscriber: r.subscriber, phone: r.phone, prev: r.prev }))
    for (let i = 0; i < rows.length; i += 500) {
      const res = await sb.from('reading_rows').insert(rows.slice(i, i + 500))
      if (res.error) {
        await sb.from('reading_files').delete().eq('id', fileId)
        throw new Error('failed')
      }
    }
    added += rows.length
  }
  return added
}

export async function deleteFile(id: string) {
  const { error } = await server().from('reading_files').delete().eq('id', id)
  if (error) throw new Error('failed')
}

/** The original files of the week (and, for a week from before files, the one file kept on the week). */
export async function weekSources(batchId: string): Promise<Array<{ id: string | null; name: string; source: string; col: number; sheet: string | null }>> {
  const sb = server()
  const { data, error } = await sb.from('reading_files').select('id, file_name, source_b64, current_col').eq('batch_id', batchId).order('created_at')
  if (error) throw new Error('failed')
  const out = (data ?? []).map((f) => ({ id: f.id as string | null, name: f.file_name as string, source: f.source_b64 as string, col: (f.current_col as number) ?? 4, sheet: null as string | null }))
  const old = await sb.from('reading_batches').select('source_b64, sheet_name, current_col, file_name').eq('id', batchId).single()
  if (old.data?.source_b64) out.unshift({ id: null, name: (old.data.file_name as string) ?? 'القراءات.xlsx', source: old.data.source_b64 as string, col: (old.data.current_col as number) ?? 4, sheet: (old.data.sheet_name as string | null) ?? null })
  return out
}

/** Who reads an area this week: a reader in the app, or on paper (typed in later by the office). */
export async function assignArea(batchId: string, area: string, mode: 'app' | 'paper' | null, assigneeId: string | null) {
  const { error } = await server().from('reading_rows').update({ mode, assignee_id: mode === 'app' ? assigneeId : null }).eq('batch_id', batchId).eq('area', area)
  if (error) throw new Error('failed')
}

/** Moves one board to another area (for a board whose name does not show where it belongs). */
export async function moveBoard(batchId: string, board: string, area: string) {
  const { error } = await server().from('reading_rows').update({ area }).eq('batch_id', batchId).eq('board', board)
  if (error) throw new Error('failed')
}

export async function setBatchStatus(id: string, status: 'open' | 'approved') {
  const { error } = await server().from('reading_batches').update({ status }).eq('id', id)
  if (error) throw new Error('failed')
}

export async function deleteBatch(id: string) {
  const { error } = await server().from('reading_batches').delete().eq('id', id)
  if (error) throw new Error('failed')
}
