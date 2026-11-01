import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { buildIssueWorkbook, buildUsageWorkbook } from './excel'
import { parseIssueWorkbook, parseUsageWorkbook, planImport } from './import'
import { ordinalWord, type Seal, type SealData } from './model'

// Her real files, when they are on this machine (they are not part of the repository).
const dir = process.env.SEALS_XLSX_DIR ?? '/tmp/m2-work/xl'
const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.xlsx')) : []
const issueFile = files.find((f) => f.startsWith('c7565'))
const usageFile = files.find((f) => f.startsWith('fce8'))
const buf = (f: string) => { const b = readFileSync(join(dir, f)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer }

describe.skipIf(!issueFile || !usageFile)('her real Excel files', () => {
  it('reads the issue file: 13 sheets, stacked rolls, damaged seals', async () => {
    const { rolls, suspicious } = await parseIssueWorkbook(ExcelJS, buf(issueFile!))
    expect(rolls.length).toBeGreaterThanOrEqual(20)
    const first = rolls[0]!
    expect(first).toMatchObject({ from: 181301, to: 181400 })
    expect(first.batches).toHaveLength(10)
    expect(first.batches[0]).toMatchObject({ date: '2026-07-30', tech: 'قصي الشافعي', seals: [181365, 181388, 181355, 181390, 181362, 181345, 181359, 181371, 181324, 181318] })
    const second = rolls.find((r) => r.from === 183001)!
    expect(second.damaged).toEqual([183006])
    // Typos in her headers (22440-224301, 221500-221401, a block written twice) still give clean 100-seal rolls.
    for (const r of rolls) {
      expect(r.to).toBeGreaterThan(r.from)
      expect(r.to - r.from).toBeLessThan(1000)
      for (const b of r.batches) expect(b.seals.every((n) => n >= r.from && n <= r.to)).toBe(true)
    }
    const sorted = [...rolls].sort((a, b) => a.from - b.from)
    sorted.forEach((r, i) => i > 0 && expect(r.from).toBeGreaterThan(sorted[i - 1]!.to))
    expect(suspicious.length).toBeGreaterThan(0)
    expect(suspicious.length).toBeLessThan(10)
    // Ten seals were handed out twice (taken back from one technician, given to another).
    const all = rolls.flatMap((r) => r.batches.flatMap((b) => b.seals))
    expect(all.length - new Set(all).size).toBe(10)
  })
  it('reads the usage file and matches it to the rolls', async () => {
    const { rolls } = await parseIssueWorkbook(ExcelJS, buf(issueFile!))
    const usage = await parseUsageWorkbook(ExcelJS, buf(usageFile!))
    expect(usage.rows.length).toBeGreaterThan(2000)
    const row = usage.rows.find((u) => u.no === 181365)!
    expect(row).toMatchObject({ status: 'used', usedOn: '2026-08-02', details: 'طبلون 361 إعادة شبك (حمزة الداية )' })
    const plan = planImport(rolls, usage.rows)
    expect(plan.totals.seals).toBeGreaterThan(1900)
    expect(plan.stray.length).toBeLessThan(usage.rows.length * 0.05)
  })
  it('exports the same layout back: the batch line and the usage line read like the originals', async () => {
    const { rolls } = await parseIssueWorkbook(ExcelJS, buf(issueFile!))
    const usage = await parseUsageWorkbook(ExcelJS, buf(usageFile!))
    const plan = planImport(rolls, usage.rows)
    const names = new Map<string, string>()
    const techId = (n: string) => { if (!names.has(n)) names.set(n, n); return n }
    const data: SealData = { rolls: [], batches: [], seals: [], names }
    plan.rolls.forEach(({ payload: r, usage: us }, i) => {
      data.rolls.push({ id: `r${i}`, fromNo: r.from, toNo: r.to, receivedOn: r.receivedOn, note: '' })
      r.batches.forEach((b, k) => {
        const bid = `r${i}b${k}`
        data.batches.push({ id: bid, rollId: `r${i}`, batchNo: k + 1, technicianId: techId(b.tech), issuedOn: b.date, note: '' })
        b.seals.forEach((no, pos) => {
          const u = us.find((x) => x.no === no)
          const s: Seal = { sealNo: no, rollId: `r${i}`, status: u ? u.status : 'issued', batchId: bid, batchPos: pos + 1, technicianId: techId(b.tech), issuedOn: b.date, usedOn: u?.usedOn || null, details: u?.details ?? '', boardNo: '' }
          data.seals.push(s)
        })
      })
    })
    const out1 = buildIssueWorkbook(ExcelJS, data)
    const ws = out1.worksheets[0]!
    expect(ws.getCell('A1').value).toBe('التاريخ')
    expect(ws.getCell('D1').value).toBe('الاختام من 181301-181400')
    expect(ws.getCell('B2').value).toBe(ordinalWord(1))
    expect(ws.getCell('C2').value).toBe('قصي الشافعي')
    expect(ws.getCell('D2').value).toBe('181365-181388-181355-181390-181362-181345-181359-181371-181324-181318')
    expect(ws.views[0]).toMatchObject({ rightToLeft: true })
    const out2 = buildUsageWorkbook(ExcelJS, data)
    const w2 = out2.getWorksheet('قصي الشافعي')!
    expect(w2.getCell('B1').value).toBe('رقم الختم')
    expect(w2.getCell('B2').value).toBe(181365)
    expect(w2.getCell('C2').value).toBe('مستخدم')
    expect(w2.getCell('D2').value).toBe('طبلون 361 إعادة شبك (حمزة الداية )')
    expect(w2.autoFilter).toBeTruthy()
    // a second round trip reads back the same numbers
    const bytes = await out1.xlsx.writeBuffer()
    const again = (await parseIssueWorkbook(ExcelJS, bytes as ArrayBuffer)).rolls
    expect(again.length).toBe(rolls.length)
    expect(again.reduce((n, r) => n + r.batches.length, 0)).toBe(plan.totals.batches)
  })
})
