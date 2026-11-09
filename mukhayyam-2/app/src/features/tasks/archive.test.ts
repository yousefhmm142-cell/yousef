import { describe, expect, it } from 'vitest'
import { buildArchive, filterArchive } from './archive'
import type { Task } from './model'
import { newActivities } from '../dashboard/ActivityLive'
const task = (over: Partial<Task> = {}): Task => ({
  id: 'a',
  number: 81,
  typeId: 1,
  assigneeId: 'tech-a',
  createdBy: null,
  details: '',
  subscriberName: 'أحمد سالم',
  subscriberPhone: null,
  zoneId: null,
  location: '',
  priority: 'normal',
  expectedMinutes: 30,
  status: 'done',
  sentAt: null,
  seenAt: null,
  startedAt: null,
  completedAt: '2026-11-08T23:30:00Z',
  cancelledAt: null,
  completionNotes: 'تم',
  cancelReason: '',
  linkToken: '',
  createdAt: '2025-01-01T12:00:00Z',
  ...over,
})
const types = [{ id: 1, name: 'تفتيش', isActive: true, sortOrder: 1 }]
describe('technician archive', () => {
  it('uses Gaza completion day, keeps old orders, excludes unfinished tasks', () => {
    const rows = buildArchive(
      [task(), task({ id: 'b', status: 'sent' }), task({ id: 'c', completedAt: null })],
      [],
      types,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.date).toBe('2026-11-09')
    expect(rows[0]?.reference).toBe('مهمة #81')
  })
  it('includes seal work, isolates technicians and searches subscriber or seal reference', () => {
    const rows = buildArchive(
      [task()],
      [
        {
          date: '2026-11-09',
          techId: 'tech-b',
          tech: 'سارة',
          seals: [120001, 120002],
          board: '27',
          work: 'فك ساعة',
          subscriber: 'سارة',
        },
      ],
      types,
    )
    expect(filterArchive(rows, '2026-11-09', '2026-11-09', 'tech-a', 'احمد')).toHaveLength(1)
    expect(filterArchive(rows, '2026-11-09', '2026-11-09', 'tech-a', '120001')).toHaveLength(0)
    expect(filterArchive(rows, '2026-11-09', '2026-11-09', '', '120001')[0]?.seals).toEqual([120001, 120002])
    expect(filterArchive(rows, '2026-11-09', '2026-11-09', '', '')).toHaveLength(2)
    expect(filterArchive(rows, '2026-11-10', '2026-11-10', '', '')).toHaveLength(0)
  })
})
it('live notifications ignore initial history and replayed IDs, announce only newer references', () => {
  const rows = [{ id: 8, at: '', kind: 'seal' as const, who: 'سارة', text: 'ختم', tone: undefined, route: '/seals' }]
  expect(newActivities(rows, null)).toEqual([])
  expect(newActivities(rows, 8)).toEqual([])
  expect(newActivities(rows, 7)).toEqual(rows)
})
