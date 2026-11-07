import { useEffect, useState } from 'react'
import { isDemo } from '../../config'
import { getMeta, setMeta } from '../../data/db'
import { getSupabase } from '../../data/supabase'

// The office's list of subscribers (name, area, board, phone): typing part of a name fills the task.
// Kept on this device as a compact list so the search is instant and works without internet.

export interface Subscriber {
  /** Name */ n: string
  /** Area */ a: string
  /** Board (طبلون) */ b: string
  /** Phone */ p: string
}

const KEY = 'subs:list'

/** Arabic letters folded so «أحمد»/«احمد», «ة»/«ه» and «ى»/«ي» match. */
export const fold = (s: string) =>
  s
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim()

const words = (s: string) => fold(s).split(' ').filter(Boolean)

/**
 * Subscribers whose name holds every typed word (each as the start of one of the name's words), so two,
 * three or four parts of the name all work. Best matches first; at most `limit`.
 */
export function searchSubscribers(list: Subscriber[], query: string, limit = 6): Subscriber[] {
  const q = words(query)
  if (!q.length || q.join('').length < 2) return []
  const scored: Array<[number, Subscriber]> = []
  for (const s of list) {
    const w = words(s.n)
    let score = 0
    let ok = true
    for (const t of q) {
      const exact = w.indexOf(t)
      if (exact >= 0) { score += 3 + (exact === 0 ? 1 : 0); continue }
      if (w.some((x) => x.startsWith(t))) { score += 1; continue }
      ok = false
      break
    }
    if (ok) scored.push([score - w.length * 0.01, s])
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, limit).map((x) => x[1])
}

let memory: Subscriber[] | null = null
const listeners = new Set<(l: Subscriber[]) => void>()
const announce = (l: Subscriber[]) => { memory = l; for (const f of listeners) f(l) }

/** Reads the list from the server (in pages) and keeps it on this device. */
export async function refreshSubscribers(): Promise<void> {
  const sb = getSupabase()
  if (isDemo || !sb || !navigator.onLine) return
  const all: Subscriber[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('subscribers').select('full_name, area, board, phone').order('id').range(from, from + 999)
    if (error) return
    for (const r of (data ?? []) as Array<{ full_name: string; area: string | null; board: string | null; phone: string | null }>)
      all.push({ n: r.full_name, a: r.area ?? '', b: r.board ?? '', p: r.phone ?? '' })
    if (!data || data.length < 1000) break
  }
  await setMeta(KEY, all)
  announce(all)
}

export function useSubscribers(): Subscriber[] {
  const [list, setList] = useState<Subscriber[]>(memory ?? [])
  useEffect(() => {
    listeners.add(setList)
    if (!memory) void getMeta<Subscriber[]>(KEY).then((l) => l && !memory && announce(l))
    void refreshSubscribers()
    return () => void listeners.delete(setList)
  }, [])
  return list
}

// ---------- Reading the office's file (Excel, CSV, or Excel saved as a web page) ----------
const HEAD = {
  n: ['اسم المشترك', 'الاسم', 'اسم', 'المشترك', 'الزبون', 'name'],
  a: ['منطقة 2', 'المنطقة 2', 'المنطقة', 'منطقة', 'area'],
  b: ['الطبلون', 'طبلون', 'رقم الطبلون', 'لوحة', 'board'],
  p: ['رقم الجوال', 'الجوال', 'جوال', 'موبايل', 'الهاتف', 'هاتف', 'phone', 'mobile'],
} as const

function columnsOf(header: string[]): Record<keyof typeof HEAD, number> {
  const h = header.map((x) => fold(String(x ?? '')).toLowerCase())
  const pick = (keys: readonly string[]) => {
    for (const k of keys) { const i = h.findIndex((x) => x === fold(k).toLowerCase()); if (i >= 0) return i }
    for (const k of keys) { const i = h.findIndex((x) => x.includes(fold(k).toLowerCase())); if (i >= 0) return i }
    return -1
  }
  // «منطقة 2» first: the file may also hold another area column.
  return { n: pick(HEAD.n), a: pick(HEAD.a), b: pick(HEAD.b), p: pick(HEAD.p) }
}

function fromTable(rows: string[][]): Subscriber[] {
  const headAt = rows.findIndex((r) => { const c = columnsOf(r); return c.n >= 0 && (c.p >= 0 || c.b >= 0 || c.a >= 0) })
  if (headAt < 0) throw new Error('no_header')
  const c = columnsOf(rows[headAt]!)
  const cell = (r: string[], i: number) => (i >= 0 ? String(r[i] ?? '').trim() : '')
  const seen = new Set<string>()
  const out: Subscriber[] = []
  for (const r of rows.slice(headAt + 1)) {
    const n = cell(r, c.n).replace(/\s+/g, ' ')
    if (n.length < 2) continue
    const s = { n, a: cell(r, c.a), b: cell(r, c.b), p: cell(r, c.p).replace(/[^0-9]/g, '') }
    const key = `${fold(s.n)}|${s.p}|${s.b}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
  }
  return out
}

/** The rows of an Excel/CSV/HTML file, as a list of subscribers (columns found by their titles). */
export async function readSubscribersFile(file: File): Promise<Subscriber[]> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.xlsx')) {
    const { Workbook } = await import('exceljs')
    const wb = new Workbook()
    await wb.xlsx.load(await file.arrayBuffer())
    const ws = wb.worksheets[0]
    if (!ws) throw new Error('empty')
    const rows: string[][] = []
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals = (row.values as unknown[]).slice(1).map((v) => (v && typeof v === 'object' && 'text' in (v as object) ? String((v as { text: unknown }).text) : v && typeof v === 'object' && 'result' in (v as object) ? String((v as { result: unknown }).result ?? '') : String(v ?? '')))
      rows.push(vals)
    })
    return fromTable(rows)
  }
  const text = await file.text()
  if (name.endsWith('.csv') || name.endsWith('.txt')) {
    return fromTable(text.split(/\r?\n/).map((l) => l.split(/[,\t;]/)))
  }
  // Excel «Save as web page»: the sheet's own file (…files/sheet001.htm) holds the table.
  const doc = new DOMParser().parseFromString(text, 'text/html')
  const table = [...doc.querySelectorAll('table')].sort((a, b) => b.rows.length - a.rows.length)[0]
  if (!table) throw new Error(doc.querySelector('frameset') ? 'frameset' : 'no_table')
  return fromTable([...table.rows].map((r) => [...r.cells].map((c) => (c.textContent ?? '').replace(/\s+/g, ' ').trim())))
}

export async function importSubscribers(list: Subscriber[]): Promise<number> {
  const sb = getSupabase()
  if (!sb) throw new Error('offline')
  const { data, error } = await sb.rpc('subscribers_import', { p: list })
  if (error) throw new Error(error.code === '42501' ? 'not_allowed' : 'failed')
  await refreshSubscribers()
  return data as number
}
