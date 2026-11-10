import { describe, expect, it } from 'vitest'
import { taskMatrix } from './build'
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
})
