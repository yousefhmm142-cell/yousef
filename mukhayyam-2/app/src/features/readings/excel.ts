import { parseSheet, type ParsedSheet, type ReadingRow } from './model'

// The company's Excel file: read it, and give it back with this week's readings in its own column.
// Nothing else in the file is touched (titles, merged cells, formats, the other columns).

const cellValue = (v: unknown): unknown => {
  if (v && typeof v === 'object') {
    const o = v as { richText?: Array<{ text: string }>; text?: unknown; result?: unknown }
    if (o.richText) return o.richText.map((t) => t.text).join('')
    if ('result' in o) return o.result ?? ''
    if ('text' in o) return String(o.text ?? '')
  }
  return v ?? ''
}

export interface ReadFile extends ParsedSheet {
  sheetName: string
  base64: string
}

const toBase64 = (buf: ArrayBuffer) => {
  const bytes = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))

export async function readReadingsFile(file: File): Promise<ReadFile> {
  const { Workbook } = await import('exceljs')
  const buf = await file.arrayBuffer()
  const wb = new Workbook()
  await wb.xlsx.load(buf)
  // The sheet with the most subscribers (usually the only one).
  let best: { sheet: ParsedSheet; name: string } | null = null
  for (const ws of wb.worksheets) {
    const cells: unknown[][] = []
    for (let r = 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r)
      const line: unknown[] = []
      for (let c = 1; c <= Math.max(8, row.cellCount); c++) line.push(cellValue(row.getCell(c).value))
      cells.push(line)
    }
    const sheet = parseSheet(cells)
    if (!best || sheet.rows.length > best.sheet.rows.length) best = { sheet, name: ws.name }
  }
  if (!best || !best.sheet.rows.length) throw new Error('no_rows')
  return { ...best.sheet, sheetName: best.name, base64: toBase64(buf) }
}

/** The same file, with each reading in its line; rows without a number (مفصول، لا يوجد عداد…) stay empty. */
export async function exportReadings(source: string, sheetName: string | null, col: number, rows: Pick<ReadingRow, 'sheetRow' | 'reading'>[]): Promise<Blob> {
  const { Workbook } = await import('exceljs')
  const wb = new Workbook()
  await wb.xlsx.load(fromBase64(source).buffer as ArrayBuffer)
  const ws = (sheetName && wb.getWorksheet(sheetName)) || wb.worksheets[0]
  if (!ws) throw new Error('no_sheet')
  for (const r of rows) {
    const cell = ws.getRow(r.sheetRow).getCell(col)
    cell.value = r.reading
  }
  const out = await wb.xlsx.writeBuffer()
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}
