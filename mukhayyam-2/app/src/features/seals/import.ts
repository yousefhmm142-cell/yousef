import type ExcelJSType from 'exceljs'
import { fold, parseSealNumbers } from './model'

// Reads her two Excel files so the old work moves into the system once:
//  - «اختام جديد»: sheets of rolls; each line a batch (date, batch word, receiver, numbers joined by -);
//  - «اختام متفرقة»: a sheet per technician; each line a seal (date, number, state, details).

export interface ParsedBatch {
  date: string
  tech: string
  seals: number[]
  /** The word written for it, the roll whose heading it sat under, and its row among that block's lines. */
  label: string
  blockFrom: number
  ord: number
  /** Where its first seal sits on the technician's sheet of the usage file. */
  usageOrd?: number | null
  usageFill?: string | null
}
export interface ParsedRoll {
  from: number
  to: number
  receivedOn: string
  /** The heading as written in the file, and where the roll sits (the sheet and its place on it). */
  headerText: string
  sheetLabel: string
  sheetPos: number
  sheetCol: number
  sheetWidth: number | null
  sheetTab: string | null
  batches: ParsedBatch[]
  damaged: number[]
}
export interface ParsedUsage {
  no: number
  status: 'used' | 'damaged' | 'lost'
  usedOn: string
  details: string
  sheet: string
}
export interface UsageParse {
  rows: ParsedUsage[]
  /** Seals written twice: the later (or the one with a state) is kept. */
  repeated: number
  /** The seal numbers of each sheet in the order written (blank state too). */
  order: Record<string, number[]>
  /** The cell colour (ARGB) of each of those lines. */
  fills: Record<string, string[]>
}

type Cell = ExcelJSType.CellValue

/** Plain text of a cell: strings, numbers, formulas' results, rich text. */
export function cellText(v: Cell): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10)
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((t) => t.text).join('')
    if ('result' in v) return cellText(v.result as Cell)
    if ('text' in v) return String(v.text)
    return ''
  }
  return String(v)
}

/** The colour a cell is filled with, as ARGB (her files use the Office palette). */
export function fillOf(c: ExcelJSType.Cell): string {
  const g = (c.fill as { fgColor?: { argb?: string; theme?: number } } | undefined)?.fgColor
  if (!g) return ''
  if (g.argb) return g.argb.toUpperCase()
  return g.theme === 4 ? 'FFDEEBF7' : g.theme === 5 ? 'FFFBE5D6' : g.theme === 3 ? 'FFADB9CA' : ''
}

/** A date cell, or text like 30/7/2026 (day first), as 2026-07-30. */
export function cellDate(v: Cell): string {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10)
  const m = /(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{2,4})/.exec(cellText(v))
  if (!m) return ''
  const y = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3])
  return `${y}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`
}

/** The roll a set of seals belongs to: rolls start at xx01 and hold 100 (181301-181400). */
const blockOf = (n: number) => {
  const from = Math.floor((n - 1) / 100) * 100 + 1
  return { from, to: from + 99 }
}


const receivedOf = (header: string) => {
  const m = /تاريخ\s*الاستلام\s*([\d/.-]+)/.exec(header)
  return m ? cellDate(m[1]!) : ''
}

/** The roll most of a batch's numbers belong to (a stray typo does not move it). */
function dominantBlock(seals: number[]): { from: number; to: number } {
  const count = new Map<number, number>()
  for (const n of seals) count.set(blockOf(n).from, (count.get(blockOf(n).from) ?? 0) + 1)
  const [from] = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]!
  return { from, to: from + 99 }
}

export interface Suspicious {
  no: number
  tech: string
  date: string
  roll: number
}

export interface IssueParse {
  rolls: ParsedRoll[]
  /** Numbers that do not belong to the roll of their batch (typing slips); left out. */
  suspicious: Suspicious[]
}

export async function parseIssueWorkbook(ExcelJS: typeof ExcelJSType, data: ArrayBuffer): Promise<IssueParse> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(data)
  interface Block {
    header: string
    sheet: string
    pos: number
    col: number
    width: number | null
    tab: string | null
    batches: ParsedBatch[]
    damaged: number[]
  }
  const blocks: Block[] = []

  for (const ws of wb.worksheets) {
    let cur: (Block & { cols: { date: number; tech: number; seals: number } }) | null = null
    const iLabel = (b: { cols: { tech: number } }) => b.cols.tech - 1
    let pos = 0
    ws.eachRow({ includeEmpty: false }, (row) => {
      const raw = row.values as Cell[]
      const cells = raw.map((v) => cellText(v).trim())
      const iDate = cells.indexOf('التاريخ')
      const iBatch = cells.indexOf('الدفعه')
      if (iDate > 0 && iBatch > 0) {
        const iTech = cells.indexOf('المستلم')
        cur = { header: cells.slice(iTech + 1).join(' '), sheet: ws.name.trim(), pos: pos++, col: iDate, width: ws.getColumn(iTech + 1).width ?? null, tab: (ws.properties.tabColor as { argb?: string } | undefined)?.argb ?? null, cols: { date: iDate, tech: iTech, seals: iTech + 1 }, batches: [], damaged: [] }
        blocks.push(cur)
        return
      }
      if (!cur) return
      const tech = cells[cur.cols.tech] ?? ''
      const seals = parseSealNumbers(cells[cur.cols.seals] ?? '').numbers
      if (!seals.length) return
      if (fold(tech).includes('تالف')) cur.damaged.push(...seals)
      else if (tech) cur.batches.push({ date: cellDate(raw[cur.cols.date]!), tech, seals, label: cells[iLabel(cur)] ?? '', blockFrom: 0, ord: cur.batches.length })
    })
  }

  // The same person written with and without a space («بشارالشافعي» / «بشار الشافعي») is one technician.
  const squash = (s: string) => fold(s).replace(/\s+/g, '')
  const spelled = new Map<string, string>()
  for (const blk of blocks)
    for (const b of blk.batches) {
      const k = squash(b.tech)
      const cur = spelled.get(k)
      if (!cur || b.tech.length > cur.length) spelled.set(k, b.tech)
    }
  for (const blk of blocks) for (const b of blk.batches) b.tech = spelled.get(squash(b.tech))!

  // Each block belongs to the roll most of its numbers belong to; its heading is that roll's heading.
  // A line whose numbers mostly belong to another roll is kept under the block it was written in.
  const rolls = new Map<number, ParsedRoll>()
  const rollFor = (from: number, blk: Block | null): ParsedRoll => {
    let r = rolls.get(from)
    if (!r) rolls.set(from, (r = { from, to: from + 99, receivedOn: blk ? receivedOf(blk.header) : '', headerText: blk?.header ?? '', sheetLabel: blk?.sheet ?? '', sheetPos: blk?.pos ?? 0, sheetCol: blk?.col ?? 1, sheetWidth: blk?.width ?? null, sheetTab: blk?.tab ?? null, batches: [], damaged: [] }))
    return r
  }
  const own = new Map<Block, number>()
  for (const blk of blocks) {
    const all = [...blk.batches.flatMap((b) => b.seals), ...blk.damaged]
    if (!all.length) continue
    const from = dominantBlock(all).from
    own.set(blk, from)
    rollFor(from, blk)
  }
  for (const blk of blocks) {
    for (const b of blk.batches) {
      const roll = rollFor(dominantBlock(b.seals).from, null)
      roll.batches.push({ ...b, seals: [...b.seals], blockFrom: own.get(blk) ?? roll.from })
    }
    for (const n of blk.damaged) rollFor(blockOf(n).from, null).damaged.push(n)
  }
  // A number written under another roll's batch is fine when its own roll is in the file (the seal
  // simply belongs to a batch of another roll); only numbers matching no roll are slips of the pen.
  const suspicious: Suspicious[] = []
  for (const r of rolls.values())
    for (const b of r.batches)
      for (const n of b.seals) if (!rolls.has(blockOf(n).from)) suspicious.push({ no: n, tech: b.tech, date: b.date, roll: r.from })
  for (const r of rolls.values()) {
    const first = r.batches.map((b) => b.date).filter(Boolean).sort()[0] ?? ''
    // The date she wrote when receiving the roll, else the first day anything was taken from it.
    r.receivedOn = r.receivedOn && first ? (r.receivedOn < first ? r.receivedOn : first) : r.receivedOn || first
  }
  return { rolls: [...rolls.values()].sort((a, b) => a.receivedOn.localeCompare(b.receivedOn) || a.from - b.from), suspicious }
}

const statusOf = (text: string): ParsedUsage['status'] | null => {
  const t = fold(text)
  if (!t) return null
  if (t.includes('تالف')) return 'damaged'
  if (t.includes('ضائع') || t.includes('مفقود')) return 'lost'
  return 'used' // «مستخدم» and its common misspellings
}

export async function parseUsageWorkbook(ExcelJS: typeof ExcelJSType, data: ArrayBuffer): Promise<UsageParse> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(data)
  const bySeal = new Map<number, ParsedUsage>()
  let repeated = 0
  const order: Record<string, number[]> = {}
  const fills: Record<string, string[]> = {}
  for (const ws of wb.worksheets) {
    let cols: { date: number; no: number; state: number; details: number } | null = null
    ws.eachRow({ includeEmpty: false }, (row) => {
      const raw = row.values as Cell[]
      const cells = raw.map((v) => cellText(v).trim())
      if (!cols) {
        const no = cells.indexOf('رقم الختم')
        if (no > 0) cols = { date: cells.indexOf('التاريخ'), no, state: cells.indexOf('المستخدم'), details: cells.indexOf('التفاصيل') }
        return
      }
      const seal = parseSealNumbers(cells[cols.no] ?? '').numbers[0]
      if (!seal) return
      (order[ws.name.trim()] ??= []).push(seal)
      ;(fills[ws.name.trim()] ??= []).push(fillOf(row.getCell(cols.no)))
      const details = cols.details > 0 ? (cells[cols.details] ?? '') : ''
      const status = statusOf(cols.state > 0 ? cells[cols.state] ?? '' : '') ?? (details ? 'used' : null)
      if (!status) return
      const row2: ParsedUsage = { no: seal, status, usedOn: cols.date > 0 ? cellDate(raw[cols.date]!) : '', details, sheet: ws.name.trim() }
      if (bySeal.has(seal)) repeated++
      bySeal.set(seal, row2)
    })
  }
  return { rows: [...bySeal.values()], repeated, order, fills }
}

// ---------- Putting the two together ----------
export interface ImportPlan {
  /** In an order where a roll comes after any roll one of its batches reaches into. */
  rolls: ParsedRoll[]
  usage: ParsedUsage[]
  /** Technician names in the issue file, and the sheet names in the usage file. */
  technicians: string[]
  usageSheets: string[]
  /** Usage lines whose seal is in none of the rolls. */
  stray: ParsedUsage[]
  /** Typing slips put right by looking at the usage file (a missing digit). */
  fixed: Array<{ typed: number; now: number; tech: string }>
  /** Numbers that match no roll and could not be put right. */
  unresolved: Suspicious[]
  totals: { rolls: number; batches: number; seals: number; usage: number }
}

/** Two numbers written one digit apart (a digit missing, added or changed). */
const withinOne = (a: string, b: string) => {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1)
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1)
}

/** The roll order for importing: a roll is imported after the rolls its batches borrow numbers from. */
function dependencyOrder(rolls: ParsedRoll[]): ParsedRoll[] {
  const byFrom = new Map(rolls.map((r) => [r.from, r]))
  const needs = (r: ParsedRoll) => new Set(r.batches.flatMap((b) => b.seals.map((n) => blockOf(n).from)).filter((f) => f !== r.from && byFrom.has(f)))
  const done = new Set<number>()
  const out: ParsedRoll[] = []
  let left = [...rolls]
  while (left.length) {
    const ready = left.filter((r) => [...needs(r)].every((f) => done.has(f)))
    const next = ready.length ? ready : [left[0]!]
    for (const r of next) {
      done.add(r.from)
      out.push(r)
    }
    left = left.filter((r) => !next.includes(r))
  }
  return out
}

/** The usage sheet that belongs to a technician: the same name, else one containing the other, else the same first name. */
export function sheetOf(tech: string, sheets: string[]): string | null {
  const key = (s: string) => fold(s).replace(/\s+/g, '')
  const t = key(tech)
  const hit = sheets.find((s) => key(s) === t) ?? sheets.find((s) => t.startsWith(key(s)) || key(s).startsWith(t))
  if (hit) return hit
  const first = fold(tech).split(/\s+/)[0]
  const same = sheets.filter((s) => fold(s).split(/\s+/)[0] === first)
  return same.length === 1 ? same[0]! : null
}

export function planImport(parsed: ParsedRoll[], usage: ParsedUsage[], suspicious: Suspicious[] = [], order: Record<string, number[]> = {}, fills: Record<string, string[]> = {}): ImportPlan {
  const rolls = parsed.map((r) => ({ ...r, batches: r.batches.map((b) => ({ ...b, seals: [...b.seals] })) }))
  const listed = new Set(rolls.flatMap((r) => r.batches.flatMap((b) => b.seals)))
  const fixed: ImportPlan['fixed'] = []
  const unresolved: Suspicious[] = []
  for (const s of suspicious) {
    const roll = rolls.find((r) => r.from === s.roll)
    const batch = roll?.batches.find((b) => b.tech === s.tech && b.date === s.date && b.seals.includes(s.no))
    // The number she meant is one the usage file knows in that roll and no batch lists.
    const guess = usage.map((u) => u.no).find((n) => roll && n >= roll.from && n <= roll.to && !listed.has(n) && withinOne(String(s.no), String(n)))
    if (batch && guess) {
      batch.seals[batch.seals.indexOf(s.no)] = guess
      listed.add(guess)
      fixed.push({ typed: s.no, now: guess, tech: s.tech })
    } else unresolved.push(s)
  }
  const sheetNames = Object.keys(order)
  for (const r of rolls)
    for (const b of r.batches) {
      const sheet = sheetOf(b.tech, sheetNames)
      const at = sheet ? order[sheet]!.indexOf(b.seals[0]!) : -1
      b.usageOrd = at >= 0 ? at : null
      b.usageFill = at >= 0 ? fills[sheet!]?.[at] || null : null
    }
  const ordered = dependencyOrder(rolls)
  const inRolls = (n: number) => rolls.some((r) => n >= r.from && n <= r.to)
  return {
    rolls: ordered,
    usage,
    technicians: [...new Set(rolls.flatMap((r) => r.batches.map((b) => b.tech)))].sort((a, b) => a.localeCompare(b, 'ar')),
    usageSheets: [...new Set(usage.map((u) => u.sheet))],
    stray: usage.filter((u) => !inRolls(u.no)),
    fixed,
    unresolved,
    totals: {
      rolls: rolls.length,
      batches: rolls.reduce((n, r) => n + r.batches.length, 0),
      seals: rolls.reduce((n, r) => n + r.batches.reduce((m, b) => m + b.seals.length, 0), 0),
      usage: usage.length,
    },
  }
}

/** What the server function takes for one roll: technicians by their ids. */
export function rollPayload(r: ParsedRoll, techId: (name: string) => string) {
  return {
    from: r.from,
    to: r.to,
    received_on: r.receivedOn,
    header_text: r.headerText,
    sheet_label: r.sheetLabel,
    sheet_pos: r.sheetPos,
    sheet_col: r.sheetCol,
    sheet_width: r.sheetWidth,
    sheet_tab: r.sheetTab,
    batches: r.batches.map((b) => ({ date: b.date || r.receivedOn, tech: techId(b.tech), seals: b.seals, label: b.label, block_from: b.blockFrom === r.from ? null : b.blockFrom, ord: b.ord, usage_ord: b.usageOrd ?? null, fill: b.usageFill ?? null })),
    damaged: r.damaged,
  }
}

export const usagePayload = (rows: ParsedUsage[]) => rows.map((u) => ({ no: u.no, status: u.status, used_on: u.usedOn, details: u.details }))
