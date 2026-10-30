import type { Section } from './build'

/** One Excel file, one right-to-left sheet per section, with a title and the period on top. */
export async function downloadExcel(sections: Section[], title: string, fileName: string): Promise<void> {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  wb.creator = 'نظام مخيم 2'
  wb.created = new Date()
  for (const s of sections) {
    const name = s.title.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31)
    const ws = wb.addWorksheet(name, { views: [{ rightToLeft: true, state: 'frozen', ySplit: 3 }] })
    ws.addRow([title]).font = { bold: true, size: 14 }
    ws.addRow([s.note ? `${s.title} · ${s.note}` : s.title]).font = { bold: true, color: { argb: 'FF8E1B2B' } }
    const head = ws.addRow(s.columns)
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    head.eachCell((c) => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8E1B2B' } }
      c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    })
    for (const row of s.rows) ws.addRow(row.map((c) => (c === null ? '' : c)))
    if (s.total) {
      const t = ws.addRow(s.total.map((c) => (c === null ? '' : c)))
      t.font = { bold: true }
      t.eachCell((c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2EDE6' } }))
    }
    s.columns.forEach((col, i) => {
      const longest = Math.max(col.length, ...s.rows.map((r) => String(r[i] ?? '').length))
      ws.getColumn(i + 1).width = Math.min(40, Math.max(10, longest + 2))
    })
  }
  const buf = await wb.xlsx.writeBuffer()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
}
