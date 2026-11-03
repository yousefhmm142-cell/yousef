import { describe, expect, it } from 'vitest'
import { buildSealWork, sealWorkTotals } from './sealWork'

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
})
