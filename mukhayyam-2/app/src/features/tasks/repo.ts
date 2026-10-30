import { useLiveQuery } from 'dexie-react-hooks'
import { isDemo } from '../../config'
import { ensureDemoData } from '../../data/demo'
import { db } from '../../data/db'
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
  assignee_id: string
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
export async function refreshTasks(): Promise<void> {
  if (isDemo) return
  const sb = getSupabase()
  if (!sb || !navigator.onLine) return
  const since = new Date(Date.now() - 120 * 86_400_000).toISOString()
  const { data, error } = await sb
    .from('tasks')
    .select('*')
    .or(`status.not.in.(done,cancelled),created_at.gte.${since}`)
    .order('number', { ascending: false })
    .limit(1000)
  if (error || !data) return
  const rows = (data as TaskRow[]).map(taskFromRow)
  await db.transaction('rw', db.tasks, async () => {
    const keep = new Set(rows.map((r) => r.id))
    const old = await db.tasks.toArray()
    await db.tasks.bulkDelete(old.filter((t) => !keep.has(t.id)).map((t) => t.id))
    await db.tasks.bulkPut(rows)
  })
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
  const sb = online()
  const { data, error, status } = await sb
    .from('tasks')
    .insert({
      task_type_id: input.typeId,
      assignee_id: input.assigneeId,
      details: input.details.trim() || null,
      subscriber_name: input.subscriberName.trim() || null,
      subscriber_phone: input.subscriberPhone || null,
      zone_id: input.zoneId,
      location_text: input.location.trim() || null,
      priority: input.priority,
      expected_minutes: input.expectedMinutes,
    })
    .select('*')
    .single()
  check(error, status)
  const task = taskFromRow(data as TaskRow)
  await db.tasks.put(task)
  return task
}

/** Records that the order was handed to WhatsApp or the SMS app; the task becomes "sent". */
export async function recordSent(task: Task, channel: Channel, toPhone: string, body: string): Promise<void> {
  if (isDemo) {
    await db.tasks.update(task.id, { status: task.status === 'new' ? 'sent' : task.status, sentAt: task.sentAt ?? serverNow().toISOString() })
    return
  }
  const sb = online()
  const res = await sb.from('outgoing_messages').insert({ task_id: task.id, channel, to_phone: toPhone, body })
  check(res.error, res.status)
  await reload(task.id)
}

export async function cancelTask(task: Task, reason: string): Promise<void> {
  const text = reason.trim()
  if (!text) throw new SheetStateError('reason_needed')
  if (isDemo) {
    await db.tasks.update(task.id, { status: 'cancelled', cancelReason: text, cancelledAt: serverNow().toISOString() })
    return
  }
  const sb = online()
  const res = await sb.from('tasks').update({ status: 'cancelled', cancel_reason: text }).eq('id', task.id)
  check(res.error, res.status)
  await reload(task.id)
}

async function reload(id: string) {
  const sb = getSupabase()
  if (!sb) return
  const { data } = await sb.from('tasks').select('*').eq('id', id).maybeSingle()
  if (data) await db.tasks.put(taskFromRow(data as TaskRow))
}

// ---------- The technician's link (no sign-in) ----------
export interface LinkTask {
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
  /** Warehouse items to pick from while the task is open. */
  items?: Array<{ id: number; name: string; unit: string }>
  /** Materials recorded for this task. */
  materials?: Array<{ name: string; unit: string; qty: number }>
}

async function demoLinkTask(token: string): Promise<LinkTask | null> {
  const t = await db.tasks.where('linkToken').equals(token).first()
  if (!t) return null
  const [type, who, zone] = await Promise.all([db.taskTypes.get(t.typeId), db.employees.get(t.assigneeId), t.zoneId ? db.zones.get(t.zoneId) : undefined])
  return {
    number: t.number,
    type: type?.name ?? 'مهمة',
    assignee: who?.fullName ?? '',
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
    items: t.status === 'done' || t.status === 'cancelled' ? [] : (await db.stockItems.toArray()).filter((i) => i.isActive).map((i) => ({ id: i.id, name: i.name, unit: i.unit })),
    materials: await Promise.all(
      (await db.stockMoves.where('taskId').equals(t.id).toArray()).filter((m) => m.kind === 'out').map(async (m) => {
        const item = await db.stockItems.get(m.itemId)
        return { name: item?.name ?? '', unit: item?.unit ?? '', qty: m.qty }
      }),
    ),
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

export type UsedMaterial = { itemId: number; qty: number }

export async function actOnTaskLink(token: string, action: 'start' | 'done', notes = '', materials: UsedMaterial[] = []): Promise<LinkTask | null> {
  if (isDemo) {
    // A phone opening the sheet or the link for the first time: the sample data may still be loading.
    await ensureDemoData()
    const t = await db.tasks.where('linkToken').equals(token).first()
    if (!t) throw new SheetStateError('not_found')
    if (t.status === 'cancelled') throw new SheetStateError('cancelled')
    const now = serverNow().toISOString()
    const started = t.startedAt ?? now
    if (action === 'start' && t.status !== 'done') await db.tasks.update(t.id, { status: 'in_progress', startedAt: started })
    if (action === 'done' && t.status !== 'done') {
      await db.tasks.update(t.id, { status: 'done', startedAt: started, completedAt: now, completionNotes: notes.trim() })
      for (const m of materials.filter((x) => x.qty > 0))
        await db.stockMoves.put({ id: crypto.randomUUID(), itemId: m.itemId, kind: 'out', qty: m.qty, at: now, note: `مهمة #${t.number}`, ref: '', taskId: t.id, createdBy: t.assigneeId })
    }
    return demoLinkTask(token)
  }
  const sb = online()
  const { data, error, status } = await sb.rpc('task_link_act', {
    p_token: token,
    p_action: action,
    p_notes: notes.trim() || null,
    p_materials: materials.filter((m) => m.qty > 0).map((m) => ({ item_id: m.itemId, qty: m.qty })),
  })
  check(error, status)
  return (data as LinkTask | null) ?? null
}
