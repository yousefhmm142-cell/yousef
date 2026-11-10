import { describe, expect, it } from 'vitest'
import { buildSealWork, filterSealWork, splitWorkSubscriber, sealWorkTotals } from './sealWork'

const names = new Map([['a', 'قصي'], ['b', 'مجد']])
const row = (seal_no: number, technician_id: string, used_on: string, details: string, board_no = '') => ({ seal_no, technician_id, used_on, issued_on: null, details, board_no })

describe('seal work statement', () => {
  it('goes by date, merges equal work, and repeats a name', () => {
    const lines = buildSealWork(
      [
        row(2, 'a', '2026-11-02', 'طبلون 5 تفتيش', '5'),
        row(1, 'a', '2026-11-02', 'طبلون 5 تفتيش', '5'),
        row(3, 'a', '2026-11-02', 'فصل خط'),
        row(9, 'b', '2026-11-01', 'صيانة'),
        row(4, 'a', '2026-11-03', 'شد كابل'),
      ],
      names,
    )
    expect(lines.map((l) => [l.date, l.tech, l.seals.join('+')])).toEqual([
      ['2026-11-01', 'مجد', '9'],
      ['2026-11-02', 'قصي', '1+2'],
      ['2026-11-02', 'قصي', '3'],
      ['2026-11-03', 'قصي', '4'],
    ])
    expect(sealWorkTotals(lines)[0]).toEqual({ tech: 'قصي', seals: 4, jobs: 3 })
  })

  it('takes the subscriber out of the work when no brackets were used', () => {
    expect(splitWorkSubscriber('فك ساعة نوح كلاب', '')).toEqual({ work: 'فك ساعة', subscriber: 'نوح كلاب' })
    expect(splitWorkSubscriber('فصل خدمة عمر فرح الله', '')).toEqual({ work: 'فصل خدمة', subscriber: 'عمر فرح الله' })
    expect(splitWorkSubscriber('إعادة جميل العايدي', '')).toEqual({ work: 'إعادة', subscriber: 'جميل العايدي' })
    expect(splitWorkSubscriber('إضافة مشترك فارس عبد العزيز', '')).toEqual({ work: 'إضافة مشترك', subscriber: 'فارس عبد العزيز' })
    expect(splitWorkSubscriber('فك ساعة فحص', '')).toEqual({ work: 'فك ساعة فحص', subscriber: '' })
    expect(splitWorkSubscriber('تفتيش + صيانة', '')).toEqual({ work: 'تفتيش + صيانة', subscriber: '' })
    expect(splitWorkSubscriber('تفتيش', 'علي')).toEqual({ work: 'تفتيش', subscriber: 'علي' })
  })

  it('combines inclusive date limits, technician identity and Arabic subscriber search without changing the source', () => {
    const lines = buildSealWork([
      row(1, 'a', '2026-11-01', 'تفتيش (أَحْمَد  علي)'),
      row(2, 'a', '2026-11-02', 'تفتيش (أحمد علي)'),
      row(3, 'b', '2026-11-02', 'تفتيش (أحمد علي)'),
      row(4, 'a', '2026-11-03', 'تفتيش (سارة)'),
    ], names)
    const shown = filterSealWork(lines, { from: '2026-11-01', to: '2026-11-02', technician: 'a', subscriber: 'احمد علي' })
    expect(shown.flatMap((l) => l.seals)).toEqual([1, 2])
    expect(sealWorkTotals(shown)).toEqual([{ tech: 'قصي', seals: 2, jobs: 2 }])
    expect(lines).toHaveLength(4)
    expect(filterSealWork(lines, { subscriber: 'غير موجود' })).toEqual([])
    expect(filterSealWork(lines, { from: '2026-11-03', to: '2026-11-01' })).toEqual([])
    expect(filterSealWork(lines, { subscriber: '  ' })).toEqual(lines)
  })
})
