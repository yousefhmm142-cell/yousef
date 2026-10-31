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
  assigneeId: string
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
  assigneeId: string
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
