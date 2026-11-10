import { describe, expect, it } from 'vitest'
import { areaKey, areaOf, parseCode, parseSheet, splitNamePhone, summarizeAreas, type ReadingRow } from './model'

describe('readings', () => {
  it('reads the code in both orders, with Arabic digits and the fak number', () => {
    expect(parseCode('1_شرقية 31')).toEqual({ seq: 1, board: 'شرقية 31', fak: null })
    expect(parseCode('5_شرقية 33 (164697)')).toEqual({ seq: 5, board: 'شرقية 33', fak: '164697' })
    expect(parseCode('(164679) شقاقي ٢٨_39')).toEqual({ seq: 39, board: 'شقاقي 28', fak: '164679' })
    expect(parseCode('7_شرقية 40 (069227)').fak).toBe('069227')
  })
  it('boards that share a name are one area', () => {
    expect(areaOf('المقبرة 5')).toBe('المقبرة')
    expect(areaOf('شمال المقبرة 3')).toBe('المقبرة')
    expect(areaOf('شرقية 31')).toBe('شرقية')
    expect(areaKey('مقبرة')).toBe(areaKey('المقبرة'))
  })
  it('splits name and phone', () => {
    expect(splitNamePhone('احمد سالم درويش\n0599130796')).toEqual({ name: 'احمد سالم درويش', phone: '0599130796' })
    expect(splitNamePhone('هاني')).toEqual({ name: 'هاني', phone: null })
  })
  it('reads the blocks of the company sheet', () => {
    const t = ['\nعن شهر 10/2026', '', '', '']
    const h = ['#', 'الاسم', 'القراءة السابقة', 'القراءة الحالية', 'الاستهلاك']
    const s = parseSheet([
      [], t, h,
      ['1_المقبرة 5', 'أحمد\n0599000001', 108.1, null],
      ['2_المقبرة 5', 'محمود\n0599000002', '576.3', null],
      [], [], t, h,
      ['3_شمال مقبرة 3 (164697)', 'سامي\n0599000003', 92.2, null],
      ['خربطة', 'x', 1, null],
    ])
    expect(s.title).toContain('عن شهر 10/2026')
    expect(s.currentCol).toBe(4)
    expect(s.rows.map((r) => [r.sheetRow, r.area, r.board, r.prev])).toEqual([[4, 'المقبرة', 'المقبرة 5', 108.1], [5, 'المقبرة', 'المقبرة 5', 576.3], [10, 'المقبرة', 'شمال مقبرة 3', 92.2]])
    expect(s.skipped).toEqual([11])
    const rows = s.rows.map((r, i): ReadingRow => ({ ...r, id: String(i), batchId: 'b', mode: null, assigneeId: null, reading: i === 0 ? 111 : null, state: null, note: null, enteredAt: null }))
    expect(summarizeAreas(rows)).toMatchObject([{ area: 'المقبرة', total: 3, done: 1, boards: ['المقبرة 5', 'شمال مقبرة 3'] }])
  })
})
