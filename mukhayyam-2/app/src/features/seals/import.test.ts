import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { buildIssueWorkbook, buildUsageWorkbook } from './excel'
import { cellText, parseIssueWorkbook, parseUsageWorkbook, planImport, rollPayload, usagePayload } from './import'
import type { Seal, SealData } from './model'

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
    const { rolls, suspicious } = await parseIssueWorkbook(ExcelJS, buf(issueFile!))
    const usage = await parseUsageWorkbook(ExcelJS, buf(usageFile!))
    expect(usage.rows.length).toBeGreaterThan(2000)
    const row = usage.rows.find((u) => u.no === 181365)!
    expect(row).toMatchObject({ status: 'used', usedOn: '2026-08-02', details: 'طبلون 361 إعادة شبك (حمزة الداية )' })
    const plan = planImport(rolls, usage.rows, suspicious, usage.order)
    expect(plan.totals.seals).toBeGreaterThan(1900)
    expect(plan.stray.length).toBeLessThan(usage.rows.length * 0.05)
  })

  // Import her two files the way the server does, export, and compare cell by cell with the originals.
  it('exports back her own two files, line for line', async () => {
    const { rolls, suspicious } = await parseIssueWorkbook(ExcelJS, buf(issueFile!))
    const usage = await parseUsageWorkbook(ExcelJS, buf(usageFile!))
    const plan = planImport(rolls, usage.rows, suspicious, usage.order)
    const ids = new Map<string, string>()
    const techId = (n: string) => ids.get(n) ?? (ids.set(n, `t:${n}`), `t:${n}`)
    const sheets = new Map<string, string>()
    for (const sh of plan.usageSheets) {
      const hit = plan.technicians.find((t) => t === sh || t.startsWith(sh) || sh.startsWith(t) || t.split(' ')[0] === sh.split(' ')[0])
      if (hit) sheets.set(techId(hit), sh)
    }
    const data: SealData = { rolls: [], batches: [], seals: [], names: new Map(), sheets }
    const bySeal = new Map<number, Seal>()
    plan.rolls.forEach((r, i) => {
      const p = rollPayload(r, techId)
      data.rolls.push({ id: `r${i}`, fromNo: p.from, toNo: p.to, receivedOn: p.received_on, note: '', headerText: p.header_text, sheetLabel: p.sheet_label, sheetPos: p.sheet_pos, sheetCol: p.sheet_col })
      for (let n = p.from; n <= p.to; n++) {
        const s: Seal = { sealNo: n, rollId: `r${i}`, status: 'in_stock', batchId: null, batchPos: null, technicianId: null, issuedOn: null, usedOn: null, details: '', boardNo: '' }
        bySeal.set(n, s)
        data.seals.push(s)
      }
      p.batches.forEach((b, k) => {
        const bid = `r${i}b${k}`
        data.batches.push({ id: bid, rollId: `r${i}`, batchNo: k + 1, technicianId: b.tech, issuedOn: b.date, note: '', originalSeals: b.seals, blockFrom: b.block_from, blockOrd: b.ord, label: b.label || null, usageOrd: b.usage_ord })
        b.seals.forEach((no, pos) => {
          const s = bySeal.get(no)
          if (s && (s.status === 'in_stock' || s.status === 'issued')) Object.assign(s, { status: 'issued', batchId: bid, batchPos: pos + 1, technicianId: b.tech, issuedOn: b.date, usedOn: null, details: '' })
        })
      })
      for (const no of p.damaged) { const s = bySeal.get(no); if (s?.status === 'in_stock') s.status = 'damaged' }
    })
    for (const u of usagePayload(plan.usage)) {
      const s = bySeal.get(u.no)
      if (s && (s.status === 'issued' || (u.status === 'damaged' && s.status === 'in_stock'))) Object.assign(s, { status: u.status, usedOn: u.used_on || null, details: u.details })
    }
    for (const [name, id] of ids) data.names.set(id, name)

    const grid = (ws: ExcelJS.Worksheet) => {
      const rows: string[] = []
      ws.eachRow({ includeEmpty: false }, (row) => { const v = (row.values as unknown[]).slice(1).map((x) => cellText(x as never).trim().replace(/(\d)\+(?=\d)/g, '$1-')); const k = v.findIndex(Boolean); rows.push(v.slice(Math.max(0, k)).join(' | ').replace(/(\s*\|\s*)+$/, '')) })
      return rows
    }
    const compare = async (orig: ArrayBuffer, made: ExcelJS.Workbook) => {
      const o = new ExcelJS.Workbook()
      await o.xlsx.load(orig)
      const bad: string[] = []
      const key = (n: string) => n.trim().replace(/\s+/g, '')
      for (const w of o.worksheets.filter((x) => x.rowCount > 0)) {
        const m = made.worksheets.find((x) => key(x.name) === key(w.name))
        if (!m) { bad.push(`missing sheet ${w.name}`); continue }
        const a = grid(w), b = grid(m)
        if (a.length !== b.length) {
          bad.push(`${w.name}: ${a.length} rows vs ${b.length}`)
          const cnt = new Map<string, number>()
          for (const l of a) cnt.set(l, (cnt.get(l) ?? 0) + 1)
          for (const l of b) cnt.set(l, (cnt.get(l) ?? 0) - 1)
          for (const [l, c] of cnt) if (c) bad.push(`   ${c > 0 ? 'MISSING' : 'EXTRA'} ×${Math.abs(c)}: ${l}`)
        }
        a.forEach((line, i) => line !== b[i] && bad.push(`${w.name} #${i + 1}: «${line}» vs «${b[i]}»`))
      }
      return bad
    }
    const badIssue = await compare(buf(issueFile!), buildIssueWorkbook(ExcelJS, data))
    const badUsage = await compare(buf(usageFile!), buildUsageWorkbook(ExcelJS, data))
    writeFileSync('/tmp/m2-work/roundtrip.txt', ['ISSUE', ...badIssue, 'USAGE', ...badUsage].join('\n'))
    // Same sheets, same lines, same order. Only her own slips differ (a misspelt «مستخدم», a broken
    // date, a stray character in a fifth cell, a name written with and without a space, one missing digit).
    for (const l of [...badIssue, ...badUsage]) expect(l).not.toMatch(/rows vs|MISSING|EXTRA/)
    expect(badIssue.length).toBeLessThanOrEqual(4)
    expect(badUsage.length).toBeLessThanOrEqual(16)
  })
})
