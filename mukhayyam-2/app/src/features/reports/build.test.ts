import { describe, expect, it } from 'vitest'
import { buildReport, taskMatrix } from './build'
import type { Task } from '../tasks/model'
import type { Employee } from '../../types'

const emp = (id: string, fullName: string): Employee => ({ id, fullName, phone: null, role: 'technician', isActive: true, tracksAttendance: false })
const task = (id: string, assigneeId: string, typeId: number, createdAt: string): Task => ({
  id, number: 1, typeId, assigneeId, createdBy: null, details: '', subscriberName: '', subscriberPhone: null, zoneId: null, location: '', priority: 'normal',
  expectedMinutes: 30, status: 'done', sentAt: null, seenAt: null, startedAt: null, completedAt: null, cancelledAt: null, completionNotes: '', cancelReason: '', linkToken: id, createdAt,
})

describe('reports', () => {
  it('counts tasks per technician and type with totals', () => {
    const s = taskMatrix(
      [task('a', 'q', 1, ''), task('b', 'q', 1, ''), task('c', 'm', 4, '')],
      [emp('q', 'قصي'), emp('m', 'مجد')],
      [{ id: 1, name: 'شد كوابل', isActive: true, sortOrder: 1 }, { id: 4, name: 'تبديل ساعة', isActive: true, sortOrder: 4 }, { id: 9, name: 'فصل ووصل', isActive: true, sortOrder: 9 }],
      'k', 't',
    )
    expect(s.columns).toEqual(['الفني', 'شد كوابل', 'تبديل ساعة', 'المجموع'])
    expect(s.rows).toEqual([['قصي', 2, null, 2], ['مجد', null, 1, 1]])
    expect(s.total).toEqual(['المجموع', 2, 1, 3])
  })
  it('warehouse: balance at the start, in, out, balance at the end', () => {
    const sections = buildReport({
      from: '2026-10-24', to: '2026-10-30', today: '2026-10-30', nowMin: 600,
      reports: [], sheets: [], tasks: [], punches: [], leaves: [], holidays: [], employees: [], schedules: [], generators: [], fuelTypes: [], zones: [], taskTypes: [],
      items: [{ id: 1, name: 'عداد', unit: 'قطعة', minQty: 5, isActive: true, sortOrder: 1 }],
      moves: [
        { id: '1', itemId: 1, kind: 'in', qty: 30, at: '2026-10-10T08:00:00Z', note: '', ref: '', taskId: null, createdBy: null },
        { id: '2', itemId: 1, kind: 'out', qty: 4, at: '2026-10-25T08:00:00Z', note: '', ref: '', taskId: null, createdBy: null },
        { id: '3', itemId: 1, kind: 'in', qty: 10, at: '2026-10-29T08:00:00Z', note: '', ref: '', taskId: null, createdBy: null },
      ],
    })
    expect(sections.find((s) => s.key === 'stock')!.rows[0]).toEqual(['عداد', 'قطعة', 30, 10, 4, 36, 5])
  })
})
