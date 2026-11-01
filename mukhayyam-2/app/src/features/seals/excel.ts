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

/** The issue log: sheets «ورقة1», «ورقة2»... one per roll, oldest roll first. */
export function buildIssueWorkbook(ExcelJS: ExcelJS, data: SealData): ExcelJSType.Workbook {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'نظام مخيم 2'
  wb.created = new Date()
  const rolls = [...data.rolls].sort((a, b) => a.receivedOn.localeCompare(b.receivedOn) || a.fromNo - b.fromNo)
  const used = new Set<string>()
  rolls.forEach((roll, i) => {
    const ws = wb.addWorksheet(sheetName(`ورقة${i + 1}`, used), { views: [{ rightToLeft: true }] })
    ws.columns = [{ width: 12 }, { width: 13 }, { width: 20 }, { width: 81.4 }]
    const head = ws.addRow(['التاريخ', 'الدفعه', 'المستلم', `الاختام من ${roll.fromNo}-${roll.toNo}`])
    head.height = 15.75
    head.eachCell((c, col) => {
      c.font = { name: 'Arial', size: 11, bold: true }
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } }
      c.border = allSides(medium)
      if (col === 4) c.alignment = { horizontal: 'center' }
    })
    const batches = data.batches.filter((b) => b.rollId === roll.id).sort((a, b) => a.batchNo - b.batchNo)
    const sealsOf = (b: SealBatch) => data.seals.filter((s) => s.batchId === b.id).sort((a, c) => (a.batchPos ?? 0) - (c.batchPos ?? 0))
    for (const b of batches) {
      const row = ws.addRow([asDate(b.issuedOn), ordinalWord(b.batchNo), data.names.get(b.technicianId) ?? '', sealsOf(b).map((s) => s.sealNo).join('-')])
      row.height = 15
      row.eachCell({ includeEmpty: true }, (c, col) => {
        c.font = { name: 'Arial', size: 11 }
        c.border = allSides(medium)
        if (col === 1) c.numFmt = 'mm-dd-yy'
      })
    }
    // Seals damaged before they were ever handed out.
    const spoiled = data.seals.filter((s) => s.rollId === roll.id && !s.batchId && (s.status === 'damaged' || s.status === 'lost')).sort((a, b) => a.sealNo - b.sealNo)
    if (spoiled.length) {
      ws.addRow([])
      for (const s of spoiled) {
        const r = ws.addRow(['', '', s.status === 'lost' ? 'ضائع' : 'تالف', s.sealNo])
        r.eachCell((c) => (c.font = { name: 'Arial', size: 11 }))
        r.getCell(4).alignment = { horizontal: 'right' }
      }
    }
  })
  if (!rolls.length) wb.addWorksheet('ورقة1', { views: [{ rightToLeft: true }] }).addRow(['التاريخ', 'الدفعه', 'المستلم', 'الاختام'])
  return wb
}

const stateWord = (s: Seal) => (s.status === 'used' ? 'مستخدم' : s.status === 'damaged' ? 'تالف' : s.status === 'lost' ? 'ضائع' : '')

/** The usage log: one sheet per technician, a line per seal handed to them (used or not yet). */
export function buildUsageWorkbook(ExcelJS: ExcelJS, data: SealData): ExcelJSType.Workbook {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'نظام مخيم 2'
  wb.created = new Date()
  const batchById = new Map(data.batches.map((b) => [b.id, b]))
  const rollById = new Map<string, SealRoll>(data.rolls.map((r) => [r.id, r]))
  const byTech = new Map<string, Seal[]>()
  for (const s of data.seals) if (s.technicianId && s.status !== 'in_stock') (byTech.get(s.technicianId) ?? byTech.set(s.technicianId, []).get(s.technicianId)!).push(s)
  const order = (a: Seal, b: Seal) => {
    const ba = batchById.get(a.batchId ?? '')
    const bb = batchById.get(b.batchId ?? '')
    return (rollById.get(a.rollId)?.receivedOn ?? '').localeCompare(rollById.get(b.rollId)?.receivedOn ?? '') || a.rollId.localeCompare(b.rollId) || (ba?.batchNo ?? 0) - (bb?.batchNo ?? 0) || (a.batchPos ?? 0) - (b.batchPos ?? 0)
  }
  const used = new Set<string>()
  const techs = [...byTech.keys()].sort((a, b) => (data.names.get(a) ?? '').localeCompare(data.names.get(b) ?? '', 'ar'))
  for (const id of techs) {
    const ws = wb.addWorksheet(sheetName(data.names.get(id) ?? 'فني', used), { views: [{ rightToLeft: true }] })
    ws.columns = [{ width: 12 }, { width: 11 }, { width: 12 }, { width: 77.1 }]
    const head = ws.addRow(['التاريخ', 'رقم الختم', 'المستخدم', 'التفاصيل'])
    head.height = 18
    head.eachCell((c, col) => {
      c.font = { name: 'Arial', size: 14 }
      c.border = allSides(thin)
      if (col === 4) c.alignment = { horizontal: 'center' }
    })
    const seals = byTech.get(id)!.sort(order)
    for (const s of seals) {
      const r = ws.addRow([asDate(s.usedOn), s.sealNo, stateWord(s), s.details])
      r.eachCell({ includeEmpty: true }, (c, col) => {
        c.font = { name: 'Arial', size: 11 }
        c.border = allSides(thin)
        if (col === 1) c.numFmt = 'mm-dd-yy'
      })
    }
    ws.autoFilter = { from: 'B1', to: `B${seals.length + 1}` }
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
