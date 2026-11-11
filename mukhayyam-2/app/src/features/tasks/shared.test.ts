import { expect,it } from 'vitest'
import { taskAssignees,isAssignedTo,isSharedTask } from './model'
import { matchesTask } from './search'
import { buildArchive } from './archive'
import type { Task } from './model'
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

it('keeps legacy assignments and counts each shared participant once',()=>{
 expect(taskAssignees(task())).toEqual(['tech-a'])
 const shared=task({assigneeIds:['tech-a','tech-b','tech-a']})
 expect(taskAssignees(shared)).toEqual(['tech-a','tech-b'])
 expect(isAssignedTo(shared,'tech-b')).toBe(true)
 expect(isSharedTask(shared)).toBe(true)
 expect(isSharedTask(task())).toBe(false)
 const rows=buildArchive([shared],[],types)
 expect(rows.map(r=>r.techId)).toEqual(['tech-a','tech-b'])
 expect(new Set(rows.map(r=>r.id)).size).toBe(2)
 expect(rows.every(r=>r.reference==='مهمة مشتركة #81')).toBe(true)
})
it('searches secondary technicians, normalized Arabic and digits, all words and private token exclusion',()=>{
 const names={people:new Map([['tech-a','سارة'],['tech-b','خالد']]),types:new Map([[1,'تفتيش']]),zones:new Map<number,string>()}
 const shared=task({assigneeIds:['tech-a','tech-b'],subscriberPhone:'0590000000',details:'شارع الزيتون',linkToken:'private-token'})
 for(const query of ['خالد أحمد','مهمة ٨١','منجزة','مشتركة','٠٥٩٠٠٠٠٠٠٠','تفتيش الزيتون']) expect(matchesTask(shared,query,names),query).toBe(true)
 expect(matchesTask(shared,'خالد مفقود',names)).toBe(false)
 expect(matchesTask(shared,'private-token',names)).toBe(false)
 expect(matchesTask(task(), 'مشتركة',names)).toBe(false)
})
