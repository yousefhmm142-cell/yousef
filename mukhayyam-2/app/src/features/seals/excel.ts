import type ExcelJSType from 'exceljs'
import { ordinalWord, type Seal, type SealBatch, type SealData, type SealRoll } from './model'

// Two Excel files, laid out exactly like the ones kept by hand until now:
//  - «اختام جديد»: one sheet per roll, a line per batch (date, batch word, receiver, the numbers);
//  - «اختام متفرقة»: one sheet per technician, a line per seal (date, number, state, details).

type ExcelJS = typeof ExcelJSType
const thin = { style: 'thin' as const }
const medium = { style: 'medium' as const }
const allSides = (style: { style: 'thin' | 'medium' }) => ({ top: style, left: style, bottom: style, right: style })

/** "2026-08-02" as a date at noon UTC, so no time zone moves it to another day. */
const asDate = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00Z`) : null)

const sheetName = (name: string, used: Set<string>) => {
  const base = (name.replace(/[\\/?*[\]:]/g, ' ').trim() || 'ورقة').slice(0, 31)
  let n = base
  for (let i = 2; used.has(n); i++) n = `${base.slice(0, 28)} ${i}`
  used.add(n)
  return n
}

/** «ورقة13» -> 13; anything else has no number. */
const sheetNo = (label: string) => Number(/(\d+)\s*$/.exec(label)?.[1] ?? NaN)

const dmy = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return `${d}/${m}/${y}`
}

/** How a technician is named in the files: the sheet name she used, else the full name. */
const fileName = (data: SealData, id: string) => {
  const sheet = data.sheets?.get(id)
  const full = data.names.get(id) ?? ''
  return sheet && sheet.trim().split(/\s+/).length >= 2 ? sheet : full
}

/** The numbers of a batch as the file shows them: the line as first written, until someone changes it. */
const batchNumbers = (data: SealData, b: SealBatch): number[] =>
  b.originalSeals ?? data.seals.filter((s) => s.batchId === b.id).sort((x, y) => (x.batchPos ?? 0) - (y.batchPos ?? 0)).map((s) => s.sealNo)

/**
 * The issue log, laid out like the old file: sheets «ورقة1», «ورقة2»... Rolls that shared a sheet
 * still do, one block under the other; a roll added in the system gets the next sheet.
 */
export function buildIssueWorkbook(ExcelJS: ExcelJS, data: SealData): ExcelJSType.Workbook {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'نظام مخيم 2'
  wb.created = new Date()
  const rollById = new Map(data.rolls.map((r) => [r.id, r]))
  const byReceived = (a: SealRoll, b: SealRoll) => a.receivedOn.localeCompare(b.receivedOn) || a.fromNo - b.fromNo
  const labelled = new Map<string, SealRoll[]>()
  const fresh: SealRoll[] = []
  for (const r of [...data.rolls].sort(byReceived)) {
    if (r.sheetLabel) (labelled.get(r.sheetLabel) ?? labelled.set(r.sheetLabel, []).get(r.sheetLabel)!).push(r)
    else fresh.push(r)
  }
  const sheets: Array<{ name: string; rolls: SealRoll[] }> = [...labelled.entries()]
    .sort((a, b) => (sheetNo(a[0]) || 1e9) - (sheetNo(b[0]) || 1e9) || a[0].localeCompare(b[0]))
    .map(([name, rolls]) => ({ name, rolls: rolls.sort((a, b) => (a.sheetPos ?? 0) - (b.sheetPos ?? 0) || byReceived(a, b)) }))
  let next = Math.max(0, ...sheets.map((s) => sheetNo(s.name) || 0)) + 1
  for (const r of fresh) sheets.push({ name: `ورقة${next++}`, rolls: [r] })

  const used = new Set<string>()
  for (const sh of sheets) {
    const ws = wb.addWorksheet(sheetName(sh.name, used), { views: [{ rightToLeft: true }] })
    ws.columns = [{ width: 12 }, { width: 13 }, { width: 20 }, { width: 81.4 }]
    let first = true
    for (const roll of sh.rolls) {
      const pad = Array<string>(Math.max(0, (roll.sheetCol ?? 1) - 1)).fill('')
      const put = (cells: unknown[]) => ws.addRow([...pad, ...cells])
      const at = (col: number) => col + pad.length
      // Blocks sit four lines apart, as in the old file.
      if (!first) for (let i = 0; i < 4; i++) ws.addRow([])
      first = false
      const head = put(['التاريخ', 'الدفعه', 'المستلم', roll.headerText ?? `تاريخ الاستلام ${dmy(roll.receivedOn)} الاختام (${roll.fromNo}-${roll.toNo})`])
      head.height = 15.75
      head.eachCell((c, col) => {
        if (col <= pad.length) return
        c.font = { name: 'Arial', size: 11, bold: true }
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } }
        c.border = allSides(medium)
        if (col === at(4)) c.alignment = { horizontal: 'center' }
      })
      // The lines of this block: the roll's own, plus lines of other rolls written under its heading.
      const lines = data.batches
        .filter((x) => (x.blockFrom ?? rollById.get(x.rollId)?.fromNo) === roll.fromNo)
        .sort((a, c) => (a.blockOrd ?? 1e6 + a.batchNo) - (c.blockOrd ?? 1e6 + c.batchNo) || a.issuedOn.localeCompare(c.issuedOn))
      let shown = 0
      for (const b of lines) {
        const numbers = batchNumbers(data, b)
        if (!numbers.length) continue
        shown++
        const row = put([asDate(b.issuedOn), b.label ?? ordinalWord(shown), fileName(data, b.technicianId), numbers.join('-')])
        row.height = 15
        row.eachCell({ includeEmpty: true }, (c, col) => {
          if (col <= pad.length) return
          c.font = { name: 'Arial', size: 11 }
          c.border = allSides(medium)
          if (col === at(1)) c.numFmt = 'mm-dd-yy'
        })
      }
      // Seals damaged before they were ever handed out.
      const spoiled = data.seals.filter((s) => s.rollId === roll.id && !s.batchId && (s.status === 'damaged' || s.status === 'lost')).sort((a, b) => a.sealNo - b.sealNo)
      if (spoiled.length) {
        ws.addRow([])
        for (const s of spoiled) {
          const r = put(['', '', s.status === 'lost' ? 'ضائع' : 'تالف', s.sealNo])
          r.eachCell((c) => (c.font = { name: 'Arial', size: 11 }))
          r.getCell(at(4)).alignment = { horizontal: 'right' }
        }
      }
    }
  }
  if (!sheets.length) wb.addWorksheet('ورقة1', { views: [{ rightToLeft: true }] }).addRow(['التاريخ', 'الدفعه', 'المستلم', 'الاختام'])
  return wb
}

const stateWord = (s: Seal) => (s.status === 'used' ? 'مستخدم' : s.status === 'damaged' ? 'تالف' : s.status === 'lost' ? 'ضائع' : '')

/**
 * The usage log: a sheet per technician named as before, a line for each seal handed to them in
 * the order of their batches (used, damaged or not yet used). A seal later handed on to someone
 * else stays on the first sheet as a blank line, exactly as in the old file.
 */
export function buildUsageWorkbook(ExcelJS: ExcelJS, data: SealData): ExcelJSType.Workbook {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'نظام مخيم 2'
  wb.created = new Date()
  const rollById = new Map<string, SealRoll>(data.rolls.map((r) => [r.id, r]))
  const sealByNo = new Map(data.seals.map((s) => [s.sealNo, s]))
  const batches = [...data.batches].sort(
    (a, b) =>
      (a.usageOrd ?? 1e9) - (b.usageOrd ?? 1e9) ||
      (rollById.get(a.rollId)?.receivedOn ?? '').localeCompare(rollById.get(b.rollId)?.receivedOn ?? '') ||
      a.rollId.localeCompare(b.rollId) ||
      a.batchNo - b.batchNo,
  )
  const byTech = new Map<string, SealBatch[]>()
  for (const b of batches) (byTech.get(b.technicianId) ?? byTech.set(b.technicianId, []).get(b.technicianId)!).push(b)
  const techs = [...byTech.keys()].sort((a, b) => (byTech.get(a)![0]!.issuedOn).localeCompare(byTech.get(b)![0]!.issuedOn) || (data.names.get(a) ?? '').localeCompare(data.names.get(b) ?? '', 'ar'))

  const used = new Set<string>()
  for (const id of techs) {
    const ws = wb.addWorksheet(sheetName(data.sheets?.get(id) ?? data.names.get(id) ?? 'فني', used), { views: [{ rightToLeft: true }] })
    ws.columns = [{ width: 12 }, { width: 11 }, { width: 12 }, { width: 77.1 }]
    const head = ws.addRow(['التاريخ', 'رقم الختم', 'المستخدم', 'التفاصيل'])
    head.height = 18
    head.eachCell((c, col) => {
      c.font = { name: 'Arial', size: 14 }
      c.border = allSides(thin)
      if (col === 4) c.alignment = { horizontal: 'center' }
    })
    let n = 0
    for (const b of byTech.get(id)!) {
      for (const no of batchNumbers(data, b)) {
        const s = sealByNo.get(no)
        const mine = !!s && s.technicianId === id && s.status !== 'in_stock'
        const r = ws.addRow([mine ? asDate(s.usedOn) : null, no, mine ? stateWord(s) : '', mine ? s.details : ''])
        n++
        r.eachCell({ includeEmpty: true }, (c, col) => {
          c.font = { name: 'Arial', size: 11 }
          c.border = allSides(thin)
          if (col === 1) c.numFmt = 'mm-dd-yy'
        })
      }
    }
    ws.autoFilter = { from: 'B1', to: `B${n + 1}` }
  }
  if (!techs.length) wb.addWorksheet('ورقة1', { views: [{ rightToLeft: true }] }).addRow(['التاريخ', 'رقم الختم', 'المستخدم', 'التفاصيل'])
  return wb
}

async function save(wb: ExcelJSType.Workbook, fileName: string) {
  const buf = await wb.xlsx.writeBuffer()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
}

const stampName = () => new Date().toISOString().slice(0, 10)

export async function downloadIssueLog(data: SealData) {
  const { default: ExcelJS } = await import('exceljs')
  await save(buildIssueWorkbook(ExcelJS, data), `seals-issue-${stampName()}.xlsx`)
}

export async function downloadUsageLog(data: SealData) {
  const { default: ExcelJS } = await import('exceljs')
  await save(buildUsageWorkbook(ExcelJS, data), `seals-usage-${stampName()}.xlsx`)
}
