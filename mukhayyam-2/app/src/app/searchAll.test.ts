import { describe, expect, it } from 'vitest'
import { House, Users } from 'lucide-react'
import { searchAll } from './searchAll'
import type { Task } from '../features/tasks/model'
import type { Employee } from '../types'

const nav = [{ to: '/', label: 'الرئيسية', icon: House }, { to: '/attendance', label: 'الحضور', icon: Users }]
const tasks = [
  { id: 'a', number: 35, typeId: 1, subscriberName: 'سلمى حمدان', details: 'فصل', location: '' },
  { id: 'b', number: 350, typeId: 1, subscriberName: 'أحمد', details: '', location: '' },
] as unknown as Task[]
const data = { nav, subscribers: [{ n: 'سلمى حمدان', a: 'الشوافعة', b: '12', p: '' }], tasks, people: [{ id: 'e', fullName: 'خالد منصور' } as Employee], typeName: () => 'تفتيش' }
const all = { tasks: true, seals: true, manager: true }

describe('global search', () => {
  it('finds pages by name', () => {
    expect(searchAll('الحضور', data, all).map((h) => h.to)).toEqual(['/attendance'])
  })
  it('finds a task by its exact number, with or without #, and Arabic digits', () => {
    for (const q of ['35', '#35', '٣٥']) expect(searchAll(q, data, all).filter((h) => h.group === 'tasks').map((h) => h.title)).toEqual(['#35 · تفتيش'])
  })
  it('finds subscribers and tasks by name, folding hamza and taa marbuta', () => {
    const hits = searchAll('سلمي', data, all)
    expect(hits.some((h) => h.group === 'subscribers' && h.to.startsWith('/subscriber?name='))).toBe(true)
    expect(hits.some((h) => h.group === 'tasks' && h.title.startsWith('#35'))).toBe(true)
    expect(searchAll('احمد', data, all).some((h) => h.title.startsWith('#350'))).toBe(true)
  })
  it('offers a seal from five digits', () => {
    expect(searchAll('31001', data, all).find((h) => h.group === 'seals')?.to).toBe('/seals/log?q=31001')
    expect(searchAll('3100', data, all).some((h) => h.group === 'seals')).toBe(false)
  })
  it('shows a technician pages only', () => {
    const hits = searchAll('سلمى', data, { tasks: false, seals: false, manager: false })
    expect(hits).toEqual([])
    expect(searchAll('خالد', data, { tasks: false, seals: false, manager: false })).toEqual([])
  })
})
