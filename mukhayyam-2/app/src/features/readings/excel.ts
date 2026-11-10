import { parseSheet, type ParsedRow, type ReadingRow } from './model'

// The company's Excel files: read them, and give each back with this week's readings in its own column.
// Nothing else in a file is touched (titles, merged cells, formats, the other columns).

const cellValue = (v: unknown): unknown => {
  if (v && typeof v === 'object') {
    const o = v as { richText?: Array<{ text: string }>; text?: unknown; result?: unknown }
    if (o.richText) return o.richText.map((t) => t.text).join('')
    if ('result' in o) return o.result ?? ''
    if ('text' in o) return String(o.text ?? '')
  }
  return v ?? ''
}

export interface ReadFile {
  title: string
  rows: ParsedRow[]
  /** Lines with a code that could not be read («sheet: line»). */
  skipped: string[]
  currentCol: number
  base64: string
}

const toBase64 = (buf: ArrayBuffer) => {
  const bytes = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))

/** Every sheet that holds subscribers, one after the other. */
export async function readReadingsFile(file: File): Promise<ReadFile> {
  const { Workbook } = await import('exceljs')
  const buf = await file.arrayBuffer()
  const wb = new Workbook()
  await wb.xlsx.load(buf)
  const out: ReadFile = { title: '', rows: [], skipped: [], currentCol: 4, base64: '' }
  for (const ws of wb.worksheets) {
    const cells: unknown[][] = []
    for (let r = 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r)
      const line: unknown[] = []
      for (let c = 1; c <= Math.max(8, row.cellCount); c++) line.push(cellValue(row.getCell(c).value))
      cells.push(line)
    }
    const sheet = parseSheet(cells)
    if (!sheet.rows.length) continue
    if (!out.rows.length) { out.title = sheet.title; out.currentCol = sheet.currentCol }
    for (const r of sheet.rows) out.rows.push({ ...r, sheet: ws.name, ord: out.rows.length + 1 })
    out.skipped.push(...sheet.skipped.map((n) => (wb.worksheets.length > 1 ? `${ws.name}: ${n}` : String(n))))
  }
  if (!out.rows.length) throw new Error('no_rows')
  out.base64 = toBase64(buf)
  return out
}

/** One file, with each reading in its line; rows without a number (مفصول، لا يوجد عداد…) stay empty. */
export async function fillReadings(source: string, col: number, rows: Pick<ReadingRow, 'sheetRow' | 'reading' | 'sheet'>[], fallbackSheet?: string | null): Promise<ArrayBuffer> {
  const { Workbook } = await import('exceljs')
  const wb = new Workbook()
  await wb.xlsx.load(fromBase64(source).buffer as ArrayBuffer)
  for (const r of rows) {
    const ws = (r.sheet && wb.getWorksheet(r.sheet)) || (fallbackSheet && wb.getWorksheet(fallbackSheet)) || wb.worksheets[0]
    if (!ws) continue
    ws.getRow(r.sheetRow).getCell(col).value = r.reading
  }
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer
}

export const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const filled = (name: string) => `${name.replace(/\.xls[xm]?$/i, '')} - معبأ.xlsx`

/** All the week's files: one file as it is, several in one zip. */
export async function exportWeek(files: Array<{ name: string; source: string; col: number; sheet?: string | null; rows: Pick<ReadingRow, 'sheetRow' | 'reading' | 'sheet'>[] }>, zipName: string): Promise<{ data: ArrayBuffer | Blob; name: string; mime: string }> {
  if (files.length === 1) {
    const f = files[0]!
    return { data: await fillReadings(f.source, f.col, f.rows, f.sheet), name: filled(f.name), mime: XLSX }
  }
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  const used = new Set<string>()
  for (const f of files) {
    let name = filled(f.name)
    for (let i = 2; used.has(name); i++) name = filled(`${f.name.replace(/\.xls[xm]?$/i, '')} (${i})`)
    used.add(name)
    zip.file(name, await fillReadings(f.source, f.col, f.rows, f.sheet))
  }
  return { data: await zip.generateAsync({ type: 'blob' }), name: `${zipName}.zip`, mime: 'application/zip' }
}
