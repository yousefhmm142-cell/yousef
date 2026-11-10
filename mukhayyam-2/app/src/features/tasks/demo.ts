import { db } from '../../data/db'
import { serverNow } from '../../lib/clock'
import type { Task, TaskType } from './model'

// Demo mode only: the task types from the paper form and a few tasks of today.

const names = ['شد وتوصيل كوابل', 'تفتيش', 'تركيب اشتراك', 'تبديل ساعة', 'رفع وتنزيل قدرة', 'فحص ساعة', 'تعديل أحمال', 'نقل اشتراك', 'فصل ووصل', 'صيانات عامة']
const types: TaskType[] = names.map((name, i) => ({ id: i + 1, name, isActive: true, sortOrder: i + 1 }))

export async function ensureDemoTasks(technicianIds: string[], managerId: string): Promise<void> {
  if ((await db.taskTypes.count()) === 0) await db.taskTypes.bulkPut(types)
  if ((await db.tasks.count()) > 0) return
  const now = serverNow().getTime()
  const at = (minAgo: number) => new Date(now - minAgo * 60_000).toISOString()
  const t = (n: number, over: Partial<Task>): Task => ({
    id: `demo-task-${n}`,
    number: n,
    typeId: 1,
    assigneeId: technicianIds[0]!,
    createdBy: managerId,
    details: '',
    subscriberName: '',
    subscriberPhone: null,
    zoneId: null,
    location: '',
    priority: 'normal',
    expectedMinutes: 30,
    status: 'sent',
    sentAt: null,
    seenAt: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    completionNotes: '',
    cancelReason: '',
    linkToken: `demo-link-${n}-0000`,
    createdAt: at(0),
    ...over,
  })
  await db.tasks.bulkPut([
    t(1, { typeId: 4, assigneeId: technicianIds[0]!, details: 'تبديل ساعة قرب مسجد الرازي', subscriberName: 'أبو محمد', subscriberPhone: '0599123456', zoneId: 3, status: 'done', createdAt: at(200), sentAt: at(199), seenAt: at(195), startedAt: at(190), completedAt: at(150), completionNotes: 'تم التبديل والفحص' }),
    t(2, { typeId: 1, assigneeId: technicianIds[1]!, details: 'شد كابل جديد لبيت آل عاشور', zoneId: 1, location: 'شارع المدرسة', expectedMinutes: 60, status: 'in_progress', createdAt: at(50), sentAt: at(48), seenAt: at(45), startedAt: at(40) }),
    t(3, { typeId: 9, assigneeId: technicianIds[2]!, details: 'فصل اشتراك غير مدفوع', subscriberName: 'محل البركة', zoneId: 4, priority: 'urgent', expectedMinutes: 15, status: 'sent', createdAt: at(35), sentAt: at(34) }),
  ])
}
