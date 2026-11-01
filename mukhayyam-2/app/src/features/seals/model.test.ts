import { describe, expect, it } from 'vitest'
import { composeDetails, noFilters, ordinalWord, parseSealNumbers, rollStats, searchSeals, splitDetails, tokenize, type Seal, type SealBatch, type SealData, type SealRoll } from './model'

const roll: SealRoll = { id: 'r1', fromNo: 181301, toNo: 181400, receivedOn: '2026-07-30', note: '', headerText: null, sheetLabel: null, sheetPos: null, sheetCol: null }
const roll2: SealRoll = { id: 'r2', fromNo: 183001, toNo: 183100, receivedOn: '2026-08-03', note: '', headerText: null, sheetLabel: null, sheetPos: null, sheetCol: null }
const b1: SealBatch = { id: 'b1', rollId: 'r1', batchNo: 1, technicianId: 'q', issuedOn: '2026-07-30', note: '', originalSeals: null, blockFrom: null, blockOrd: null, label: null, usageOrd: null }
const b2: SealBatch = { id: 'b2', rollId: 'r1', batchNo: 2, technicianId: 'a', issuedOn: '2026-08-01', note: '', originalSeals: null, blockFrom: null, blockOrd: null, label: null, usageOrd: null }
const b3: SealBatch = { id: 'b3', rollId: 'r2', batchNo: 1, technicianId: 'a', issuedOn: '2026-08-03', note: '', originalSeals: null, blockFrom: null, blockOrd: null, label: null, usageOrd: null }
const seal = (no: number, over: Partial<Seal> = {}): Seal => ({ sealNo: no, rollId: no < 183000 ? 'r1' : 'r2', status: 'in_stock', batchId: null, batchPos: null, technicianId: null, issuedOn: null, usedOn: null, details: '', boardNo: '', ...over })
const data: SealData = {
  rolls: [roll, roll2],
  batches: [b1, b2, b3],
  seals: [
    seal(181365, { status: 'used', batchId: 'b1', batchPos: 1, technicianId: 'q', issuedOn: '2026-07-30', usedOn: '2026-08-02', details: 'طبلون 361 إعادة شبك (حمزة الداية)', boardNo: '361' }),
    seal(181388, { status: 'used', batchId: 'b1', batchPos: 2, technicianId: 'q', issuedOn: '2026-07-30', usedOn: '2026-07-30', details: 'طبلون 65 إضافة المشترك (محمد الأسمر)', boardNo: '65' }),
    seal(181355, { status: 'issued', batchId: 'b1', batchPos: 3, technicianId: 'q', issuedOn: '2026-07-30' }),
    seal(181381, { status: 'used', batchId: 'b2', batchPos: 1, technicianId: 'a', issuedOn: '2026-08-01', usedOn: '2026-08-01', details: 'طبلون 5 فصل خط (محمد أبو غفرة)', boardNo: '5' }),
    seal(183048, { status: 'damaged', batchId: 'b3', batchPos: 1, technicianId: 'a', issuedOn: '2026-08-03', usedOn: '2026-08-03', details: 'تالف' }),
    seal(183006, { status: 'damaged', usedOn: '2026-08-03', details: 'تالف' }),
    seal(181302),
    seal(181303),
  ],
  names: new Map([['q', 'قصي الشافعي'], ['a', 'أحمد طعيمة']]),
}
const find = (q: string, f = noFilters) => searchSeals(data, q, f, '2026-08-03')

describe('typing seal numbers', () => {
  it('reads dashes, spaces, lines and the WK letters on the seal', () => {
    expect(parseSealNumbers('181365-181388 181355\nWK206022').numbers).toEqual([181365, 181388, 181355, 206022])
  })
  it('reads Arabic digits', () => {
    expect(parseSealNumbers('١٨١٣٦٥').numbers).toEqual([181365])
  })
  it('reports repeats and short numbers', () => {
    const p = parseSealNumbers('181365 181365 12')
    expect(p.numbers).toEqual([181365])
    expect(p.duplicates).toEqual([181365])
    expect(p.bad).toEqual(['12'])
  })
})

describe('words and details', () => {
  it('names the batches like her Excel', () => {
    expect([1, 2, 10].map(ordinalWord)).toEqual(['الأولى', 'الثانية', 'العاشرة'])
    expect(ordinalWord(25)).toBe('رقم 25')
  })
  it('writes and reads the details line', () => {
    const line = composeDetails({ board: '361', work: 'إعادة شبك', subscriber: 'حمزة الداية' })
    expect(line).toBe('طبلون 361 إعادة شبك (حمزة الداية)')
    expect(splitDetails(line, '361')).toEqual({ board: '361', work: 'إعادة شبك', subscriber: 'حمزة الداية' })
  })
})

describe('search', () => {
  it('finds the whole roll by its first digits', () => {
    const { groups } = find('1813')
    expect(groups.map((g) => g.key).sort()).toEqual(['b1', 'b2', 'stock:r1'])
  })
  it('shows every seal of a batch, marking the one found', () => {
    const g = find('181355').groups[0]!
    expect(g.seals.map((s) => s.sealNo)).toEqual([181365, 181388, 181355])
    expect([...g.matched]).toEqual([181355])
  })
  it('finds a tableau by number, with or without the word', () => {
    expect(find('طبلون 361').groups[0]!.key).toBe('b1')
    expect(find('361').groups.map((g) => g.key)).toEqual(['b1'])
  })
  it('does not mix a tableau number with a seal prefix when the word is used', () => {
    expect(find('طبلون 18').groups).toHaveLength(0)
  })
  it('finds by technician name, spelled loosely', () => {
    expect(find('احمد').groups.map((g) => g.key).sort()).toEqual(['b2', 'b3'])
    expect(find('طعيمه').groups).toHaveLength(2)
  })
  it('finds by subscriber and by status word', () => {
    expect(find('الداية').groups[0]!.key).toBe('b1')
    expect(find('تالف').groups.map((g) => g.key).sort()).toEqual(['b3', 'stock:r2'])
  })
  it('combines words: technician + tableau', () => {
    expect(find('قصي 65').groups.map((g) => g.key)).toEqual(['b1'])
    expect(find('احمد 65').groups).toHaveLength(0)
  })
  it('filters by technician, status and period', () => {
    expect(find('', { ...noFilters, technicianId: 'a' }).groups.map((g) => g.key).sort()).toEqual(['b2', 'b3'])
    expect(find('', { ...noFilters, status: 'open' }).groups.map((g) => g.key)).toEqual(['b1'])
    expect(find('', { ...noFilters, period: 'today' }).groups.map((g) => g.key).sort()).toEqual(['b3', 'stock:r2'])
  })
  it('lists the latest batches when nothing is typed, newest first', () => {
    expect(find('').groups.map((g) => g.key)).toEqual(['b3', 'b2', 'b1'])
  })
  it('sorts groups', () => {
    expect(searchSeals(data, '', noFilters, '2026-08-03', 'oldest').groups.map((g) => g.key)).toEqual(['b1', 'b2', 'b3'])
    expect(searchSeals(data, '', noFilters, '2026-08-03', 'seal').groups.map((g) => g.key)).toEqual(['b1', 'b2', 'b3'])
    expect(searchSeals(data, '', noFilters, '2026-08-03', 'technician').groups.map((g) => g.technicianId)).toEqual(['a', 'a', 'q'])
  })
  it('splits the query into kinds', () => {
    expect(tokenize('1813 طبلون 361 أحمد').map((t) => t.kind).sort()).toEqual(['board', 'num', 'text'])
    expect(tokenize('WK206022')[0]).toEqual({ kind: 'num', value: '206022' })
  })
})

describe('roll balance', () => {
  it('counts the seals of a roll by state', () => {
    expect(rollStats(roll, data.seals, data.batches)).toMatchObject({ used: 3, issued: 1, inStock: 2, batches: 2 })
  })
})
