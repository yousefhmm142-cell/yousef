import { describe, expect, it } from 'vitest'
import { subscriberHistory, typicalMinutes, type Task } from './model'

const now = new Date('2026-11-12T10:00:00Z')
const t = (id: string, over: Partial<Task>): Task => ({
  id, number: 1, typeId: 1, assigneeId: 'a', createdBy: null, details: '', subscriberName: '', subscriberPhone: null, zoneId: null, location: '', priority: 'normal',
  expectedMinutes: 30, status: 'done', sentAt: null, seenAt: null, startedAt: null, completedAt: null, cancelledAt: null, completionNotes: '', cancelReason: '', linkToken: id,
  createdAt: '2026-11-10T08:00:00Z', ...over,
})

describe('subscriber history', () => {
  const tasks = [
    t('1', { subscriberName: 'سلمى أحمد حمدان', status: 'sent' }),
    t('2', { subscriberName: 'سلمي احمد حمدان', createdAt: '2026-11-01T08:00:00Z' }),
    t('3', { subscriberName: 'سلمى أحمد حمدان', status: 'cancelled' }),
    t('4', { subscriberName: 'غيره', subscriberPhone: '0599111222' }),
    t('5', { subscriberName: 'سلمى أحمد حمدان', createdAt: '2026-09-01T08:00:00Z' }),
  ]
  it('matches the name with hamza and ya folded, and leaves cancelled ones out', () => {
    const h = subscriberHistory(tasks, 'سلمى احمد حمدان', null, now)
    expect(h.open.map((x) => x.id)).toEqual(['1'])
    expect(h.lastMonth).toBe(2)
  })
  it('matches by phone too', () => {
    expect(subscriberHistory(tasks, '', '0599111222', now).lastMonth).toBe(1)
  })
  it('needs two words of a name (one word matches too many people)', () => {
    expect(subscriberHistory(tasks, 'سلمى', null, now)).toEqual({ open: [], lastMonth: 0 })
  })
  it('skips the task being edited', () => {
    expect(subscriberHistory(tasks, 'سلمى احمد حمدان', null, now, '1').open).toEqual([])
  })
})

describe('typical minutes', () => {
  const done = (id: string, minutes: number, typeId = 1) =>
    t(id, { typeId, startedAt: '2026-11-10T08:00:00Z', completedAt: new Date(Date.parse('2026-11-10T08:00:00Z') + minutes * 60_000).toISOString() })
  it('is the median of finished tasks of the kind, rounded to a choice', () => {
    expect(typicalMinutes([done('a', 40), done('b', 50), done('c', 44), done('d', 46), done('e', 41)], 1)).toBe(45)
  })
  it('ignores mistaken taps and forgotten tasks', () => {
    expect(typicalMinutes([done('a', 1), done('b', 900), done('c', 100), done('d', 110), done('e', 120), done('f', 125), done('g', 118)], 1)).toBe(120)
  })
  it('says nothing with fewer than five', () => {
    expect(typicalMinutes([done('a', 40), done('b', 50), done('c', 44), done('d', 46), done('e', 41, 2)], 1)).toBeNull()
  })
})
