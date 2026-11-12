import type { Tone } from '../../ui/primitives'

// A field order from the manager to one technician. Technicians have no app: the order reaches
// them by WhatsApp or SMS, and its last line is a private link with one "finished" button.

export type TaskStatus = 'new' | 'sent' | 'seen' | 'in_progress' | 'done' | 'cancelled'
export type TaskPriority = 'normal' | 'urgent' | 'emergency'
export type Channel = 'whatsapp' | 'sms'

export interface TaskType {
  id: number
  name: string
  isActive: boolean
  sortOrder: number
}

export interface Task {
  id: string
  number: number
  typeId: number
  /** Null while the task is only prepared (a call written down, no technician yet). */
  assigneeId: string | null
  /** All participants; absent on cached older single-technician tasks. */
  assigneeIds?: string[]
  createdBy: string | null
  details: string
  subscriberName: string
  subscriberPhone: string | null
  zoneId: number | null
  location: string
  priority: TaskPriority
  expectedMinutes: number
  status: TaskStatus
  sentAt: string | null
  seenAt: string | null
  startedAt: string | null
  completedAt: string | null
  cancelledAt: string | null
  completionNotes: string
  cancelReason: string
  linkToken: string
  createdAt: string
}

export interface NewTask {
  typeId: number
  assigneeId: string | null
  /** All participants; absent on cached older single-technician tasks. */
  assigneeIds?: string[]
  details: string
  subscriberName: string
  subscriberPhone: string | null
  zoneId: number | null
  location: string
  priority: TaskPriority
  expectedMinutes: number
}

export const taskStatusInfo: Record<TaskStatus, { label: string; tone: Tone }> = {
  new: { label: 'لم تُرسل', tone: 'neutral' },
  sent: { label: 'أُرسلت', tone: 'info' },
  seen: { label: 'فتحها الفني', tone: 'info' },
  in_progress: { label: 'قيد التنفيذ', tone: 'brand' },
  done: { label: 'أُنجزت', tone: 'ok' },
  cancelled: { label: 'أُلغيت', tone: 'neutral' },
}

export const priorityInfo: Record<TaskPriority, { label: string; tone: Tone }> = {
  normal: { label: 'عادية', tone: 'neutral' },
  urgent: { label: 'مستعجلة', tone: 'warn' },
  emergency: { label: 'طارئة', tone: 'danger' },
}

export const PRIORITY_OPTIONS = (['normal', 'urgent', 'emergency'] as const).map((value) => ({ value, label: priorityInfo[value].label }))
export const EXPECTED_OPTIONS = [15, 30, 45, 60, 90, 120, 180, 240]

export const taskAssignees = (t: Pick<Task, 'assigneeId' | 'assigneeIds'>): string[] => [...new Set(t.assigneeIds?.length ? t.assigneeIds : t.assigneeId ? [t.assigneeId] : [])]
export const isAssignedTo = (t: Pick<Task, 'assigneeId' | 'assigneeIds'>, id: string) => taskAssignees(t).includes(id)
export const isSharedTask = (t: Pick<Task, 'assigneeId' | 'assigneeIds'>) => taskAssignees(t).length > 1

export const isOpen = (t: Task) => t.status !== 'done' && t.status !== 'cancelled'

/** The clock of a task runs from when it was sent (or created, if not sent yet). */
export const clockStart = (t: Task) => t.sentAt ?? t.createdAt

/** Minutes from sending until finished (or until now while open). */
export function elapsedMinutes(t: Task, now: Date): number {
  const end = t.completedAt ? Date.parse(t.completedAt) : t.cancelledAt ? Date.parse(t.cancelledAt) : now.getTime()
  return Math.max(0, Math.round((end - Date.parse(clockStart(t))) / 60_000))
}

/** Open, already sent, and past the time the manager set. */
export const isOverdue = (t: Task, now: Date) => isOpen(t) && t.status !== 'new' && elapsedMinutes(t, now) > t.expectedMinutes

/** 45 -> "45 د", 80 -> "1 س 20 د" */
export function durationText(minutes: number): string {
  if (minutes < 60) return `${minutes} د`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h} س ${m} د` : `${h} س`
}

/**
 * Phone numbers of Palestine in international form: 0599123456 -> 970599123456 (or 972...).
 * Calls and SMS use the official 970; WhatsApp uses whatever code the person registered with.
 */
export const international = (phone: string, code: WaCode = 970) => `${code}${phone.replace(/^0/, '')}`
export type WaCode = 970 | 972

// ---------- Before a task is written: has this subscriber called before? (plan 2, L3) ----------

const foldName = (s: string) =>
  s.replace(/[ً-ْـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/\s+/g, ' ').trim()

export interface SubscriberHistory {
  /** Tasks for him still open (not done, not cancelled), newest first. */
  open: Task[]
  /** Tasks for him in the last 30 days (cancelled ones not counted). */
  lastMonth: number
}

/** Same subscriber = the same name (spelling folded, two words at least) or the same phone. */
export function subscriberHistory(tasks: Task[], name: string, phone: string | null, now: Date, exceptId?: string): SubscriberHistory {
  const n = foldName(name)
  const byName = n.split(' ').length >= 2
  const p = phone && /^05\d{8}$/.test(phone) ? phone : null
  if (!byName && !p) return { open: [], lastMonth: 0 }
  const since = now.getTime() - 30 * 86_400_000
  const mine = tasks.filter((t) => t.id !== exceptId && t.status !== 'cancelled' && ((byName && foldName(t.subscriberName ?? '') === n) || (!!p && t.subscriberPhone === p)))
  return {
    open: mine.filter(isOpen).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    lastMonth: mine.filter((t) => Date.parse(t.createdAt) >= since).length,
  }
}

// ---------- The expected time, learned from the tasks of the same kind (plan 2, L4) ----------

/**
 * The median time the last 30 finished tasks of this kind took (from start to done), as the nearest
 * choice in EXPECTED_OPTIONS. Under 3 minutes or over 8 hours does not count (forgotten or tapped by
 * mistake). Fewer than 5 such tasks: null (keep the usual 30 minutes).
 */
export function typicalMinutes(tasks: Task[], typeId: number): number | null {
  const took = tasks
    .filter((t) => t.typeId === typeId && t.status === 'done' && t.startedAt && t.completedAt)
    .sort((a, b) => b.completedAt!.localeCompare(a.completedAt!))
    .slice(0, 30)
    .map((t) => (Date.parse(t.completedAt!) - Date.parse(t.startedAt!)) / 60_000)
    .filter((m) => m >= 3 && m <= 480)
    .sort((a, b) => a - b)
  if (took.length < 5) return null
  const mid = took.length / 2
  const median = took.length % 2 ? took[Math.floor(mid)]! : (took[mid - 1]! + took[mid]!) / 2
  return EXPECTED_OPTIONS.reduce((best, m) => (Math.abs(m - median) < Math.abs(best - median) ? m : best), EXPECTED_OPTIONS[0]!)
}
