import { toLatinDigits } from '../../lib/phone'
import { fold } from '../tasks/subscribers'

// Weekly meter readings: the company's sheet comes in as Excel, every subscriber gets this week's
// reading (in the app or on paper), and the same file goes back with the «القراءة الحالية» column filled.

export type ReadingState = 'disconnected' | 'no_meter' | 'other'
export const STATES: Array<{ value: ReadingState; label: string }> = [
  { value: 'disconnected', label: 'مفصول' },
  { value: 'no_meter', label: 'لا يوجد عداد' },
  { value: 'other', label: 'مشكلة أخرى' },
]
export const stateLabel = (s: string | null | undefined) => STATES.find((x) => x.value === s)?.label ?? ''

export interface ReadingRow {
  id: string
  batchId: string
  ord: number
  sheetRow: number
  code: string
  area: string
  board: string
  fak: string | null
  subscriber: string
  phone: string | null
  prev: number | null
  mode: 'app' | 'paper' | null
  assigneeId: string | null
  reading: number | null
  state: ReadingState | null
  note: string | null
  enteredAt: string | null
  fileId?: string | null
  sheet?: string | null
}

export interface ReadingBatch {
  id: string
  title: string
  periodFrom: string | null
  periodTo: string | null
  fileName: string | null
  sheetName: string | null
  currentCol: number | null
  status: 'open' | 'approved'
  createdAt: string
}

export const isDone = (r: Pick<ReadingRow, 'reading' | 'state'>) => r.reading !== null || r.state !== null

/** One cell of «#»: «1_شرقية 31», «5_شرقية 33 (164697)» or, on the printed sheet, «(164679) شقاقي ٢٨_39». */
export function parseCode(raw: string): { seq: number | null; board: string; fak: string | null } {
  let s = toLatinDigits(String(raw ?? '')).replace(/\s+/g, ' ').trim()
  let fak: string | null = null
  s = s.replace(/\(\s*([0-9]+)\s*\)/, (_, d: string) => { fak = d; return ' ' }).replace(/\s+/g, ' ').trim()
  const parts = s.split('_').map((x) => x.trim()).filter(Boolean)
  let seq: number | null = null
  let board = s
  if (parts.length >= 2) {
    const i = parts.findIndex((p) => /^\d+$/.test(p))
    if (i >= 0) { seq = Number(parts[i]); board = parts.filter((_, j) => j !== i).join(' ') }
  }
  return { seq, board: board.replace(/\s+/g, ' ').trim(), fak }
}

const DIRECTIONS = ['شمال', 'جنوب', 'شرق', 'غرب', 'وسط', 'شمالي', 'جنوبي', 'شرقي', 'غربي']

/**
 * The area of a board: its name without the number and without «شمال/جنوب…», so boards that share a
 * name are one area («المقبرة 5» and «شمال المقبرة 3» are both «المقبرة»).
 */
export function areaOf(board: string): string {
  const words = toLatinDigits(board).replace(/[0-9]+/g, ' ').replace(/[-–_/]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  const kept = words.filter((w, i) => !(words.length > 1 && DIRECTIONS.includes(fold(w)) && (i === 0 || i === words.length - 1)))
  const name = (kept.length ? kept : words).join(' ')
  return name || 'بدون منطقة'
}

/** A key that treats «أ/ا», «ة/ه» and a leading «ال» alike, so «مقبرة» and «المقبرة» fall together. */
export const areaKey = (area: string) => fold(area).split(' ').map((w) => (w.startsWith('ال') && w.length > 3 ? w.slice(2) : w)).join(' ')

/** The cell «الاسم» holds the name and, on the next line, the phone. */
export function splitNamePhone(raw: string): { name: string; phone: string | null } {
  const text = toLatinDigits(String(raw ?? ''))
  const m = text.match(/0?5\d{8}/)
  const phone = m ? (m[0].length === 9 ? `0${m[0]}` : m[0]) : null
  const name = (m ? text.replace(m[0], ' ') : text).replace(/\s+/g, ' ').trim()
  return { name, phone }
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = toLatinDigits(String(v)).replace(/٫/g, '.').replace(/[^0-9.\-]/g, '')
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

export interface ParsedRow {
  sheet?: string
  ord: number
  sheetRow: number
  code: string
  area: string
  board: string
  fak: string | null
  subscriber: string
  phone: string | null
  prev: number | null
}

export interface ParsedSheet {
  title: string
  rows: ParsedRow[]
  /** Rows with a code that could not be read, by their line in the sheet. */
  skipped: number[]
  currentCol: number
}

const HEAD_PREV = ['القراءة السابقة', 'السابقة']
const HEAD_CUR = ['القراءة الحالية', 'الحالية']

/**
 * The company's sheet, as rows of cells (index 0 = column A). Blocks repeat: a title («عن شهر 10/2026»),
 * the header (# | الاسم | القراءة السابقة | القراءة الحالية …) and the subscribers of one board.
 */
export function parseSheet(cells: unknown[][]): ParsedSheet {
  let title = ''
  let cols = { code: 0, name: 1, prev: 2, cur: 3 }
  let inBlock = false
  const rows: ParsedRow[] = []
  const skipped: number[] = []
  const areaNames = new Map<string, string>()
  cells.forEach((line, i) => {
    const text = line.map((c) => String(c ?? '').replace(/\s+/g, ' ').trim())
    const isHead = text.some((t) => t === '#') && text.some((t) => HEAD_PREV.includes(t))
    if (isHead) {
      const find = (keys: string[]) => text.findIndex((t) => keys.includes(t))
      cols = { code: text.indexOf('#'), name: Math.max(0, text.findIndex((t) => t === 'الاسم' || t === 'اسم المشترك')), prev: find(HEAD_PREV), cur: find(HEAD_CUR) }
      if (cols.cur < 0) cols.cur = cols.prev + 1
      inBlock = true
      return
    }
    if (!title) { const t = text.find((x) => /عن شهر/.test(x)); if (t) title = t }
    if (!inBlock) return
    const codeCell = text[cols.code] ?? ''
    if (!codeCell) return
    if (/عن شهر/.test(codeCell)) return
    const code = parseCode(codeCell)
    if (!code.board || code.seq === null) { skipped.push(i + 1); return }
    const who = splitNamePhone(String(line[cols.name] ?? ''))
    const raw = areaOf(code.board)
    const key = areaKey(raw)
    if (!areaNames.has(key)) areaNames.set(key, raw)
    rows.push({ ord: rows.length + 1, sheetRow: i + 1, code: codeCell, area: areaNames.get(key)!, board: code.board, fak: code.fak, subscriber: who.name, phone: who.phone, prev: num(line[cols.prev]) })
  })
  return { title, rows, skipped, currentCol: cols.cur + 1 }
}

/** By area, then board (its number in order), then the subscriber's number on the sheet. */
export function sortRows<T extends Pick<ReadingRow, 'area' | 'board' | 'ord'>>(rows: T[]): T[] {
  const boardNo = (b: string) => Number(toLatinDigits(b).match(/\d+/)?.[0] ?? 0)
  return [...rows].sort((a, b) => a.area.localeCompare(b.area, 'ar') || a.board.replace(/\d+/g, '').localeCompare(b.board.replace(/\d+/g, ''), 'ar') || boardNo(a.board) - boardNo(b.board) || a.ord - b.ord)
}

export interface AreaSummary {
  area: string
  boards: string[]
  total: number
  done: number
  mode: 'app' | 'paper' | null
  assigneeId: string | null
  mixed: boolean
}

export function summarizeAreas(rows: ReadingRow[]): AreaSummary[] {
  const map = new Map<string, AreaSummary>()
  for (const r of sortRows(rows)) {
    let a = map.get(r.area)
    if (!a) { a = { area: r.area, boards: [], total: 0, done: 0, mode: r.mode, assigneeId: r.assigneeId, mixed: false }; map.set(r.area, a) }
    if (!a.boards.includes(r.board)) a.boards.push(r.board)
    a.total++
    if (isDone(r)) a.done++
    if (a.mode !== r.mode || a.assigneeId !== r.assigneeId) a.mixed = true
  }
  return [...map.values()]
}

/** A typed reading: Arabic digits and «٫» work; only digits and one point are kept. */
export { cleanDecimalInput as cleanReading, parseDecimal as parseReading } from '../../lib/numbers'

/** Over this many units in one week is worth a second look (not refused). */
export const BIG_USE = 300
