import { useLiveQuery } from 'dexie-react-hooks'
import { isDemo } from '../../config'
import { ensureDemoData } from '../../data/demo'
import { db } from '../../data/db'
import { flushActions, getActions, onActionsSent, runOrQueue } from '../../data/actions'
import { getSupabase } from '../../data/supabase'
import { serverNow } from '../../lib/clock'
import { bySortOrder } from '../generation/repo'
import { SheetStateError } from '../sheets/workflow'
import type { Channel, NewTask, Task, TaskPriority, TaskStatus, TaskType } from './model'

// Tasks live on the server; this device keeps a copy for reading (also offline). Creating,
// sending and cancelling need internet, since the order goes out by WhatsApp or SMS anyway.
// Demo mode keeps everything on this device.

interface TaskRow {
  id: string
  number: number
  task_type_id: number
  assignee_id: string | null
  assignee_ids?: string[]
  created_by: string | null
  details: string | null
  subscriber_name: string | null
  subscriber_phone: string | null
  zone_id: number | null
  location_text: string | null
  priority: TaskPriority
  expected_minutes: number
  status: TaskStatus
  sent_at: string | null
  seen_at: string | null
  started_at: string | null
  completed_at: string | null
  cancelled_at: string | null
  completion_notes: string | null
  cancel_reason: string | null
  link_token: string
  created_at: string
}

export const taskFromRow = (r: TaskRow): Task => ({
  id: r.id,
  number: r.number,
  typeId: r.task_type_id,
  assigneeId: r.assignee_id,
  assigneeIds: r.assignee_ids,
  createdBy: r.created_by,
  details: r.details ?? '',
  subscriberName: r.subscriber_name ?? '',
  subscriberPhone: r.subscriber_phone,
  zoneId: r.zone_id,
  location: r.location_text ?? '',
  priority: r.priority,
  expectedMinutes: r.expected_minutes,
  status: r.status,
  sentAt: r.sent_at,
  seenAt: r.seen_at,
  startedAt: r.started_at,
  completedAt: r.completed_at,
  cancelledAt: r.cancelled_at,
  completionNotes: r.completion_notes ?? '',
  cancelReason: r.cancel_reason ?? '',
  linkToken: r.link_token,
  createdAt: r.created_at,
})

function online() {
  const sb = getSupabase()
  if (!sb) throw new SheetStateError('unknown')
  if (!navigator.onLine) throw new SheetStateError('offline')
  return sb
}

function check(error: { code?: string; message?: string } | null, status: number) {
  if (!error) return
  throw new SheetStateError(status === 0 || !error.code ? 'offline' : error.message || 'unknown')
}

// ---------- Reading ----------
export function useTasks(): Task[] | undefined {
  return useLiveQuery(async () => (await db.tasks.toArray()).sort((a, b) => b.number - a.number), [])
}

export function useTaskTypes(): TaskType[] | undefined {
  return useLiveQuery(async () => (await db.taskTypes.toArray()).sort(bySortOrder), [])
}

/** Brings the open tasks and the last 120 days from the server (enough for monthly reports). */
export async function refreshTasks(): Promise<boolean> {
  if (isDemo) return true
  const sb = getSupabase()
  if (!sb || !navigator.onLine) return false
  // What was written without internet goes up first; anything still waiting stays on screen.
  await flushActions()
  const waiting = new Set((await getActions()).filter((a) => a.table === 'tasks').map((a) => String(a.row?.id ?? a.rowId)))
  const since = new Date(Date.now() - 120 * 86_400_000).toISOString()
  const raw:TaskRow[]=[]
  for(let offset=0;;offset+=1000) {
    const {data,error}=await sb.from('tasks').select('*').or(`status.not.in.(done,cancelled),created_at.gte.${since}`).order('number',{ascending:false}).order('id').range(offset,offset+999)
    if(error || !data)return false
    raw.push(...data as TaskRow[])
    if(data.length<1000)break
  }
  const rows=[...new Map(raw.map(row=>[row.id,taskFromRow(row)])).values()]
  await db.transaction('rw', db.tasks, async () => {
    const keep = new Set(rows.map((r) => r.id))
    const old = await db.tasks.toArray()
    await db.tasks.bulkDelete(old.filter((t) => !keep.has(t.id) && !waiting.has(t.id)).map((t) => t.id))
    await db.tasks.bulkPut(rows.filter((r) => !waiting.has(r.id)))
  })
  return true
}

// ---------- Manager's actions ----------
const randomToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_')
}

export async function createTask(input: NewTask, createdBy: string): Promise<Task> {
  if (isDemo) {
    const number = Math.max(0, ...(await db.tasks.toArray()).map((t) => t.number)) + 1
    const task: Task = {
      ...input,
      id: crypto.randomUUID(),
      number,
      createdBy,
      status: 'new',
      sentAt: null,
      seenAt: null,
      startedAt: null,
      completedAt: null,
      cancelledAt: null,
      completionNotes: '',
      cancelReason: '',
      linkToken: randomToken(),
      createdAt: serverNow().toISOString(),
    }
    await db.tasks.put(task)
    return task
  }
  // The id and the link are made here, so the task (and its link in an SMS) exist even without internet.
  const id = crypto.randomUUID()
  const linkToken = randomToken()
  const row = {
    id,
    link_token: linkToken,
    task_type_id: input.typeId,
    assignee_id: input.assigneeId,
    assignee_ids: input.assigneeIds ?? (input.assigneeId ? [input.assigneeId] : []),
    details: input.details.trim() || null,
    subscriber_name: input.subscriberName.trim() || null,
    subscriber_phone: input.subscriberPhone || null,
    zone_id: input.zoneId,
    location_text: input.location.trim() || null,
    priority: input.priority,
    expected_minutes: input.expectedMinutes,
  }
  const local: Task = {
    ...input, id, number: 0, createdBy, status: 'new', sentAt: null, seenAt: null, startedAt: null, completedAt: null, cancelledAt: null,
    completionNotes: '', cancelReason: '', linkToken, createdAt: serverNow().toISOString(),
  }
  const how = await queued(() => runOrQueue({ table: 'tasks', op: 'insert', row, label: `مهمة ${input.subscriberName || ''}`.trim() }, () => db.tasks.put(local).then(() => undefined)))
  if (how === 'sent') await reload(id)
  return (await db.tasks.get(id)) ?? local
}

/** The server said no (not «no internet»): the same message as before. */
async function queued<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch {
    throw new SheetStateError('unknown')
  }
}

/** Gives a prepared task (or one not yet sent) to a technician. */
export async function assignTask(task: Task, assigneeId: string, priority: Task['priority'], expectedMinutes: number, assigneeIds: string[] = [assigneeId]): Promise<Task> {
  if (isDemo) {
    await db.tasks.update(task.id, { assigneeId, assigneeIds, priority, expectedMinutes, status: 'new', sentAt: null, seenAt: null })
    return (await db.tasks.get(task.id))!
  }
  const how = await queued(() => runOrQueue(
    { table: 'tasks', op: 'update', rowId: task.id, row: { assignee_id: assigneeId, assignee_ids: assigneeIds, priority, expected_minutes: expectedMinutes }, label: `تعيين مهمة ${task.number || ''}`.trim() },
    () => db.tasks.update(task.id, { assigneeId, assigneeIds, priority, expectedMinutes, status: 'new', sentAt: null, seenAt: null }).then(() => undefined),
  ))
  if (how === 'sent') await reload(task.id)
  else await db.tasks.update(task.id, { assigneeId, assigneeIds, priority, expectedMinutes })
  return (await db.tasks.get(task.id))!
}

/** Records that the order was handed to WhatsApp or the SMS app; the task becomes "sent". */
export async function recordSent(task: Task, channel: Channel, toPhone: string, body: string): Promise<void> {
  if (isDemo) {
    await db.tasks.update(task.id, { status: task.status === 'new' ? 'sent' : task.status, sentAt: task.sentAt ?? serverNow().toISOString() })
    return
  }
  const how = await queued(() => runOrQueue(
    { table: 'outgoing_messages', op: 'insert', row: { id: crypto.randomUUID(), task_id: task.id, channel, to_phone: toPhone, body }, label: `إرسال مهمة ${task.number || ''}`.trim() },
    () => db.tasks.update(task.id, { status: task.status === 'new' ? 'sent' : task.status, sentAt: task.sentAt ?? serverNow().toISOString() }).then(() => undefined),
  ))
  if (how === 'sent') await reload(task.id)
}

/** Cancellation needs only the confirmation in the task dialog, including when queued offline. */
export async function cancelTask(task: Task): Promise<void> {
  if (isDemo) {
    await db.tasks.update(task.id, { status: 'cancelled', cancelReason: '', cancelledAt: serverNow().toISOString() })
    return
  }
  const how = await queued(() => runOrQueue(
    { table: 'tasks', op: 'update', rowId: task.id, row: { status: 'cancelled', cancel_reason: null }, label: `إلغاء مهمة ${task.number || ''}`.trim() },
    () => db.tasks.update(task.id, { status: 'cancelled', cancelReason: '', cancelledAt: serverNow().toISOString() }).then(() => undefined),
  ))
  if (how === 'sent') await reload(task.id)
}

/** The technician has no smartphone: the office marks his task done (also without internet). */
export async function markDone(task: Task): Promise<void> {
  const now = serverNow().toISOString()
  if (isDemo) {
    await db.tasks.update(task.id, { status: 'done', startedAt: task.startedAt ?? now, completedAt: now })
    return
  }
  const how = await queued(() => runOrQueue(
    { table: 'tasks', op: 'update', rowId: task.id, row: { status: 'done', device_time: now, recorded_offline: !navigator.onLine }, label: `إنجاز مهمة ${task.number || ''}`.trim() },
    () => db.tasks.update(task.id, { status: 'done', startedAt: task.startedAt ?? now, completedAt: now }).then(() => undefined),
  ))
  if (how === 'sent') await reload(task.id)
}

onActionsSent(refreshTasks)

async function reload(id: string) {
  const sb = getSupabase()
  if (!sb) return
  const { data } = await sb.from('tasks').select('*').eq('id', id).maybeSingle()
  if (data) await db.tasks.put(taskFromRow(data as TaskRow))
}

// ---------- The technician's link (no sign-in) ----------
export interface LinkTask {
  shared?: boolean;
  number: number
  type: string
  assignee: string
  details: string | null
  subscriber_name: string | null
  subscriber_phone: string | null
  zone: string | null
  location: string | null
  priority: TaskPriority
  expected_minutes: number
  status: TaskStatus
  sent_at: string | null
  started_at: string | null
  completed_at: string | null
  completion_notes: string | null
  /** Materials recorded for this task. */
  materials?: Array<{ name: string; unit: string; qty: number }>
}

async function demoLinkTask(token: string): Promise<LinkTask | null> {
  const t = await db.tasks.where('linkToken').equals(token).first()
  if (!t) return null
  const [type, who, zone] = await Promise.all([db.taskTypes.get(t.typeId), t.assigneeId ? db.employees.get(t.assigneeId) : undefined, t.zoneId ? db.zones.get(t.zoneId) : undefined])
  return {
    number: t.number,
    type: type?.name ?? 'مهمة',
    assignee: who?.fullName ?? '',
    shared: (t.assigneeIds?.length ?? 0)>1,
    details: t.details || null,
    subscriber_name: t.subscriberName || null,
    subscriber_phone: t.subscriberPhone,
    zone: zone?.name ?? null,
    location: t.location || null,
    priority: t.priority,
    expected_minutes: t.expectedMinutes,
    status: t.status,
    sent_at: t.sentAt,
    started_at: t.startedAt,
    completed_at: t.completedAt,
    completion_notes: t.completionNotes || null,
    materials: [],
  }
}

/** null: no such task. Opening it marks it seen. */
export async function openTaskLink(token: string): Promise<LinkTask | null> {
  if (isDemo) {
    // A phone opening the sheet or the link for the first time: the sample data may still be loading.
    await ensureDemoData()
    const t = await db.tasks.where('linkToken').equals(token).first()
    if (t && (t.status === 'new' || t.status === 'sent')) await db.tasks.update(t.id, { status: 'seen', seenAt: serverNow().toISOString() })
    return demoLinkTask(token)
  }
  const sb = online()
  const { data, error, status } = await sb.rpc('task_link_view', { p_token: token })
  check(error, status)
  return (data as LinkTask | null) ?? null
}

export async function actOnTaskLink(token: string, action: 'start' | 'done', notes = ''): Promise<LinkTask | null> {
  if (isDemo) {
    // A phone opening the sheet or the link for the first time: the sample data may still be loading.
    await ensureDemoData()
    const t = await db.tasks.where('linkToken').equals(token).first()
    if (!t) throw new SheetStateError('not_found')
    if ((t.assigneeIds?.length ?? 0)>1) throw new SheetStateError('office_completes_shared')
    if (t.status === 'cancelled') throw new SheetStateError('cancelled')
    const now = serverNow().toISOString()
    const started = t.startedAt ?? now
    if (action === 'start' && t.status !== 'done') await db.tasks.update(t.id, { status: 'in_progress', startedAt: started })
    if (action === 'done' && t.status !== 'done') {
      await db.tasks.update(t.id, { status: 'done', startedAt: started, completedAt: now, completionNotes: notes.trim() })
    }
    return demoLinkTask(token)
  }
  const sb = online()
  const { data, error, status } = await sb.rpc('task_link_act', {
    p_token: token,
    p_action: action,
    p_notes: notes.trim() || null,
    p_materials: [],
  })
  check(error, status)
  return (data as LinkTask | null) ?? null
}

/** Only task-authorized office staff can send an assigned shared order from the subscription. */
export async function sendSharedTaskSms(task: Task, request: string): Promise<{sent:number;already:number;failed:Array<{phone:string;code:string}>;body:string}> {
  if (isDemo) return {sent:task.assigneeIds?.length ?? 0,already:0,failed:[],body:''}
  await flushActions()
  if((await getActions()).some(a=>a.table==='tasks' && String(a.row?.id??a.rowId)===task.id)) throw new SheetStateError('task_waiting_sync')
  const {data,error,status}=await online().rpc('task_send_shared_sms',{p_task:task.id,p_request:request,p_members:task.assigneeIds ?? (task.assigneeId ? [task.assigneeId] : [])})
  check(error,status)
  await refreshTasks().catch(()=>false)
  return data
}
