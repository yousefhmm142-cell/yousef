import { expect,it } from 'vitest'
import { taskAssignees,isAssignedTo,isSharedTask } from './model'
import { dailyWork,buildSealWork } from './sealWork'
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

it('linked seals never count as a second completed job, unlinked work keeps its actual name',()=>{
 const t=task({usedSeals:[990001],completedWork:'صيانة كابل'})
 const lines=buildSealWork([{seal_no:990001,technician_id:'tech-a',used_on:'2026-11-09',issued_on:'2026-11-08',details:'صيانة كابل (أحمد)',board_no:'55',task_id:t.id},{seal_no:990002,technician_id:'tech-a',used_on:'2026-11-09',issued_on:'2026-11-08',details:'شبك غاطس (سارة)',board_no:'56'}],new Map([['tech-a','خالد']]))
 const result=dailyWork([t],lines,types)
 expect(result.tasks).toHaveLength(2)
 expect(result.types.filter(ty=>result.tasks.some(t=>t.typeId===ty.id)).map(ty=>ty.name)).toEqual(expect.arrayContaining(['صيانة كابل','شبك غاطس']))
 expect(result.types.some(t=>t.name==='أعمال الأختام')).toBe(false)
 expect(buildArchive([t],lines,types)).toHaveLength(2)
 expect(buildArchive([t],lines,types).find(r=>r.reference==='مهمة #81')?.seals).toEqual([990001])
})
it('two different tasks using seals stay separate even for the same technician and subscriber',()=>{
 const common={technician_id:'tech-a',used_on:'2026-11-09',issued_on:'2026-11-08',details:'صيانة كابل (أحمد)',board_no:'55'}
 const lines=buildSealWork([{...common,seal_no:990001,task_id:'one'},{...common,seal_no:990002,task_id:'two'}],new Map())
 expect(lines).toHaveLength(2)
 const result=dailyWork([task({completedWork:'شد كابل + صيانة كابل',usedSeals:[]})],[],types)
 expect(result.tasks).toHaveLength(2)
 expect(result.tasks.every(t=>t.usedSeals?.length===0)).toBe(true)
})

it('stale seal statements do not temporarily duplicate a seal already present on its task',()=>{
 const job=task({usedSeals:[991111],completedWork:'صيانة كابل'})
 const lines=buildSealWork([{seal_no:991111,technician_id:'tech-a',used_on:'2026-11-09',issued_on:'2026-11-08',details:'صيانة كابل (أحمد)',board_no:''}],new Map())
 expect(dailyWork([job],lines,types).tasks).toHaveLength(1)
 expect(buildArchive([job],lines,types)).toHaveLength(1)
})
