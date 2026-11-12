import { describe, expect, it } from 'vitest'
import { defaultAlertSettings, type SiteReport } from '../generation/model'
import type { DistributionSheet } from '../distribution/model'
import type { Task } from '../tasks/model'
import type { Seal } from '../seals/model'
import { buildAttention, type AttentionInput } from './attention'

const report = (reportDate: string, status: SiteReport['status'], consumption = 1000, closing = 5000, maint: string[] = []) =>
  ({
    id: reportDate, reportDate, status,
    fuel: [{ fuelTypeId: 1, consumption, closingBalance: closing, receivedQty: 0 }],
    generators: [{ generatorId: 1, didRun: true, runHours: 12 }],
    maintenance: maint.length ? [{ generatorId: 1, types: maint }] : [],
  }) as unknown as SiteReport
const sheet = (sheetDate: string, status: DistributionSheet['status']) => ({ sheetDate, status, zones: [] }) as unknown as DistributionSheet
const task = (n: number, sentMinAgo: number, expected = 30): Task =>
  ({ id: `t${n}`, number: n, typeId: 1, assigneeId: 'a', assigneeIds: ['a'], status: 'sent', sentAt: new Date(Date.parse('2026-11-12T10:00:00Z') - sentMinAgo * 60_000).toISOString(), createdAt: '2026-11-12T08:00:00Z', expectedMinutes: expected, subscriberName: 'سلمى' }) as unknown as Task

const base = (over: Partial<AttentionInput> = {}): AttentionInput => ({
  now: new Date('2026-11-12T10:00:00Z'),
  today: '2026-11-12',
  gazaHour: 12,
  reports: [report('2026-11-11', 'approved')],
  sheets: [sheet('2026-11-11', 'approved')],
  tasks: [],
  generators: [{ id: 1, name: 'المولد 1', brand: 'Cummins', model: null, capacityKva: 500, litersPerHour: 80, isActive: true, sortOrder: 1 }],
  settings: defaultAlertSettings,
  names: new Map([['a', 'خالد']]),
  seals: [],
  readings: null,
  smsBalance: null,
  rejected: [],
  typeName: () => 'تفتيش',
  ...over,
})

describe('attention', () => {
  it('is empty when nothing waits', () => {
    expect(buildAttention(base())).toEqual([])
  })

  it('lists papers waiting for approval, each linking to its day', () => {
    const a = buildAttention(base({ reports: [report('2026-11-10', 'submitted'), report('2026-11-11', 'submitted')], sheets: [sheet('2026-11-11', 'submitted')] }))
    const r = a.find((x) => x.key === 'reports')!
    expect(r.title).toContain('2 تقارير توليد')
    expect(r.lines.map((l) => l.to)).toEqual(['/generation/2026-11-10', '/generation/2026-11-11'])
    expect(a.find((x) => x.key === 'sheets')!.lines[0]!.to).toBe('/distribution/2026-11-11')
  })

  it('flags yesterday missing only after ten', () => {
    const missing = { reports: [], sheets: [] }
    expect(buildAttention(base({ ...missing, gazaHour: 9 })).map((x) => x.key)).toEqual([])
    expect(buildAttention(base({ ...missing, gazaHour: 10 })).map((x) => x.key)).toEqual(['late-report', 'late-sheet'])
  })

  it('lists tasks past their time', () => {
    const a = buildAttention(base({ tasks: [task(5, 60), task(6, 10)] }))
    const l = a.find((x) => x.key === 'late')!
    expect(l.tone).toBe('danger')
    expect(l.lines).toEqual([{ text: '#5 · تفتيش · خالد · سلمى' }])
  })

  it('warns when diesel runs low', () => {
    const a = buildAttention(base({ reports: [report('2026-11-10', 'approved', 1000, 3000), report('2026-11-11', 'approved', 1000, 1200)] }))
    expect(a.find((x) => x.key === 'fuel')!.tone).toBe('warn')
  })

  it('lists maintenance that is due', () => {
    const old = report('2026-10-01', 'approved', 1000, 50000, ['oil_filter'])
    const days = Array.from({ length: 25 }, (_, i) => report(`2026-10-${String(i + 2).padStart(2, '0')}`, 'approved', 1000, 50000))
    const a = buildAttention(base({ reports: [old, ...days, report('2026-11-11', 'approved', 1000, 50000)] }))
    expect(a.find((x) => x.key === 'maintenance')!.lines.some((l) => l.text === 'المولد 1: فلتر زيت')).toBe(true)
  })

  it('counts old seals per technician, and says nothing to someone without seals', () => {
    const s = (n: number, issuedOn: string, technicianId: string | null) => ({ sealNo: n, status: 'issued', issuedOn, technicianId }) as unknown as Seal
    const seals = [s(1, '2026-10-01', 'a'), s(2, '2026-10-02', 'a'), s(3, '2026-11-10', 'a'), s(4, '2026-10-01', null)]
    const a = buildAttention(base({ seals }))
    expect(a.find((x) => x.key === 'seals')!.lines).toEqual([{ text: 'بدون اسم: 1 ختم' }, { text: 'خالد: 2 ختم' }])
    expect(buildAttention(base({ seals: null })).some((x) => x.key === 'seals')).toBe(false)
  })

  it('names areas with no reader, a low SMS balance and refused writes, dangers first', () => {
    const a = buildAttention(base({ readings: { title: 'أسبوع 2', unassigned: ['الشوافعة'] }, smsBalance: 5, rejected: [{ label: 'قراءة طبلون 3', code: '42501' }] }))
    expect(a.map((x) => [x.key, x.tone])).toEqual([['sms', 'danger'], ['rejected', 'danger'], ['readings', 'info']])
  })
})
