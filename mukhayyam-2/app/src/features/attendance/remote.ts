import type { Leave, LeaveType, Punch, PunchKind, Schedule } from './rules'

// Server rows -> device shapes for attendance.

export interface ScheduleRow {
  id: number
  name: string
  start_time: string
  end_time: string
  grace_minutes: number
  absent_after: string
  overtime_min_minutes: number
  overtime_round_minutes: number
  work_days: number[]
}
export const scheduleFromRow = (r: ScheduleRow): Schedule => ({
  id: r.id,
  name: r.name,
  start: r.start_time.slice(0, 5),
  end: r.end_time.slice(0, 5),
  graceMinutes: r.grace_minutes,
  absentAfter: r.absent_after.slice(0, 5),
  overtimeMinMinutes: r.overtime_min_minutes,
  overtimeRoundMinutes: r.overtime_round_minutes,
  workDays: r.work_days,
})

export interface PunchRow {
  id: string
  employee_id: string
  kind: PunchKind
  at: string
  method: 'qr' | 'manual'
  reason: string | null
  recorded_by: string | null
}
export const punchFromRow = (r: PunchRow): Punch => ({
  id: r.id,
  employeeId: r.employee_id,
  kind: r.kind,
  at: r.at,
  method: r.method,
  reason: r.reason,
  recordedBy: r.recorded_by,
})

export interface LeaveRow {
  id: string
  employee_id: string
  from_date: string
  to_date: string
  type: LeaveType
  notes: string | null
}
export const leaveFromRow = (r: LeaveRow): Leave => ({ id: r.id, employeeId: r.employee_id, from: r.from_date, to: r.to_date, type: r.type, notes: r.notes ?? '' })
