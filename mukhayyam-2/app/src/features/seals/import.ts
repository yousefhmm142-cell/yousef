import type ExcelJSType from 'exceljs'
import { fold, parseSealNumbers } from './model'

// Reads her two Excel files so the old work moves into the system once:
//  - «اختام جديد»: sheets of rolls; each line a batch (date, batch word, receiver, numbers joined by -);
//  - «اختام متفرقة»: a sheet per technician; each line a seal (date, number, state, details).

export interface ParsedBatch {
  date: string
  tech: string
  seals: number[]
}
export interface ParsedRoll {
  from: number
  to: number
  receivedOn: string
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
}

type Cell = ExcelJSType.CellValue

/** Plain text of a cell: strings, numbers, formulas' results, rich text. */
export function cellText(v: Cell): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((t) => t.text).join('')
    if ('result' in v) return cellText(v.result as Cell)
    if ('text' in v) return String(v.text)
    return ''
  }
  return String(v)
}

/** A date cell, or text like 30/7/2026 (day first), as 2026-07-30. */
export function cellDate(v: Cell): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10)
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
    batches: ParsedBatch[]
    damaged: number[]
  }
  const blocks: Block[] = []

  for (const ws of wb.worksheets) {
    let cur: (Block & { cols: { date: number; tech: number; seals: number } }) | null = null
    ws.eachRow({ includeEmpty: false }, (row) => {
      const raw = row.values as Cell[]
      const cells = raw.map((v) => cellText(v).trim())
      const iDate = cells.indexOf('التاريخ')
      const iBatch = cells.indexOf('الدفعه')
      if (iDate > 0 && iBatch > 0) {
        const iTech = cells.indexOf('المستلم')
        cur = { header: cells.slice(iTech + 1).join(' '), cols: { date: iDate, tech: iTech, seals: iTech + 1 }, batches: [], damaged: [] }
        blocks.push(cur)
        return
      }
      if (!cur) return
      const tech = cells[cur.cols.tech] ?? ''
      const seals = parseSealNumbers(cells[cur.cols.seals] ?? '').numbers
      if (!seals.length) return
      if (fold(tech).includes('تالف')) cur.damaged.push(...seals)
      else if (tech) cur.batches.push({ date: cellDate(raw[cur.cols.date]!), tech, seals })
    })
  }

  // Each batch goes to the roll most of its numbers belong to, wherever on the sheet it was written.
  const rolls = new Map<number, ParsedRoll>()
  const suspicious: Suspicious[] = []
  const rollFor = (from: number, received: string): ParsedRoll => {
    let r = rolls.get(from)
    if (!r) rolls.set(from, (r = { from, to: from + 99, receivedOn: received, batches: [], damaged: [] }))
    else if (!r.receivedOn) r.receivedOn = received
    return r
  }
  for (const blk of blocks) {
    const received = receivedOf(blk.header)
    for (const b of blk.batches) {
      const dom = dominantBlock(b.seals)
      const r = rollFor(dom.from, received)
      const inside = b.seals.filter((n) => n >= dom.from && n <= dom.to)
      for (const n of b.seals) if (n < dom.from || n > dom.to) suspicious.push({ no: n, tech: b.tech, date: b.date, roll: dom.from })
      r.batches.push({ ...b, seals: inside })
    }
    for (const n of blk.damaged) rollFor(blockOf(n).from, received).damaged.push(n)
  }
  for (const r of rolls.values()) {
    const first = r.batches.map((b) => b.date).filter(Boolean).sort()[0] ?? ''
    // The date she wrote when receiving the roll, else the first day anything was taken from it.
    if (!r.receivedOn || r.receivedOn > first) r.receivedOn = r.receivedOn && first ? (r.receivedOn < first ? r.receivedOn : first) : r.receivedOn || first
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
      const details = cols.details > 0 ? (cells[cols.details] ?? '') : ''
      const status = statusOf(cols.state > 0 ? cells[cols.state] ?? '' : '') ?? (details ? 'used' : null)
      if (!status) return
      const row2: ParsedUsage = { no: seal, status, usedOn: cols.date > 0 ? cellDate(raw[cols.date]!) : '', details, sheet: ws.name.trim() }
      if (bySeal.has(seal)) repeated++
      bySeal.set(seal, row2)
    })
  }
  return { rows: [...bySeal.values()], repeated }
}

// ---------- Putting the two together ----------
export interface ImportPlan {
  rolls: Array<{ payload: ParsedRoll; usage: ParsedUsage[] }>
  technicians: string[]
  /** Usage lines whose seal is in none of the rolls. */
  stray: ParsedUsage[]
  totals: { rolls: number; batches: number; seals: number; usage: number }
}

export function planImport(rolls: ParsedRoll[], usage: ParsedUsage[]): ImportPlan {
  const placed = new Set<number>()
  const plan: ImportPlan['rolls'] = rolls.map((r) => {
    const mine = usage.filter((u) => u.no >= r.from && u.no <= r.to)
    mine.forEach((u) => placed.add(u.no))
    return { payload: r, usage: mine }
  })
  const technicians = [...new Set(rolls.flatMap((r) => r.batches.map((b) => b.tech)))].sort((a, b) => a.localeCompare(b, 'ar'))
  return {
    rolls: plan,
    technicians,
    stray: usage.filter((u) => !placed.has(u.no)),
    totals: {
      rolls: rolls.length,
      batches: rolls.reduce((n, r) => n + r.batches.length, 0),
      seals: rolls.reduce((n, r) => n + r.batches.reduce((m, b) => m + b.seals.length, 0), 0),
      usage: usage.length,
    },
  }
}
