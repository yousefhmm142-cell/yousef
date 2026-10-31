import { config } from '../../config'
import { addDays, isoNoon, toISODate, type ISODate } from '../../lib/dates'

// The office hours rules, applied to the punches of one person on one day. Nothing here is typed by
// anyone: it is what the QR scans say, measured against the person's hours (full day or بطالة).

export interface Schedule {
  id: number
  name: string
  /** "HH:MM" */
  start: string
  end: string
  graceMinutes: number
  /** After this time, nobody punched in = absent. */
  absentAfter: string
  overtimeMinMinutes: number
  overtimeRoundMinutes: number
  /** 0 = Sunday ... 6 = Saturday. */
  workDays: number[]
}

export type PunchKind = 'in' | 'out'
export interface Punch {
  id: string
  employeeId: string
  kind: PunchKind
  at: string
  method: 'qr' | 'manual'
  reason: string | null
  recordedBy: string | null
}

export type LeaveType = 'annual' | 'sick' | 'emergency' | 'other'
export interface Leave {
  id: string
  employeeId: string
  from: ISODate
  to: ISODate
  type: LeaveType
  notes: string
}

export const leaveLabel: Record<LeaveType, string> = { annual: 'إجازة', sick: 'مرضية', emergency: 'طارئة', other: 'إذن' }

export type DayStatus = 'present' | 'late' | 'working' | 'no_out' | 'pending' | 'absent' | 'off' | 'holiday' | 'leave' | 'future'

export interface DayResult {
  date: ISODate
  status: DayStatus
  inAt: string | null
  outAt: string | null
  lateMin: number
  earlyMin: number
  workedMin: number
  overtimeMin: number
  punches: Punch[]
  leave?: Leave
  holiday?: string
}

const hhmm = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: config.timeZone })

/** "08:05" in Gaza for a stored time. */
export const gazaTime = (iso: string) => hhmm.format(new Date(iso))
export const gazaDate = (iso: string): ISODate => toISODate(new Date(iso))
export const toMinutes = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return h! * 60 + m!
}
/** 0 = Sunday ... 6 = Saturday */
export const weekdayOf = (date: ISODate) => isoNoon(date).getUTCDay()

/** The Saturday that starts the work week of a day. */
export const weekStart = (date: ISODate): ISODate => addDays(date, -((weekdayOf(date) + 1) % 7))
export const weekDays = (date: ISODate): ISODate[] => Array.from({ length: 7 }, (_, i) => addDays(weekStart(date), i))

export function dayResult(a: {
  date: ISODate
  today: ISODate
  /** Minutes since midnight now, Gaza time. */
  nowMin: number
  punches: Punch[]
  schedule: Schedule
  holiday?: string
  leave?: Leave
  /** The first day anyone scanned the sheet: earlier days are not counted as absences. */
  trackingFrom?: ISODate
}): DayResult {
  const punches = [...a.punches].sort((x, y) => x.at.localeCompare(y.at))
  const s = a.schedule
  const workday = s.workDays.includes(weekdayOf(a.date)) && !a.holiday
  const base: DayResult = { date: a.date, status: 'off', inAt: null, outAt: null, lateMin: 0, earlyMin: 0, workedMin: 0, overtimeMin: 0, punches, leave: a.leave, holiday: a.holiday }

  const firstIn = punches.find((p) => p.kind === 'in')
  if (!firstIn) {
    if (a.date > a.today || (a.trackingFrom && a.date < a.trackingFrom)) return { ...base, status: 'future' }
    if (a.leave) return { ...base, status: 'leave' }
    if (a.holiday) return { ...base, status: 'holiday' }
    if (!workday) return { ...base, status: 'off' }
    if (a.date === a.today && a.nowMin < toMinutes(s.absentAfter)) return { ...base, status: 'pending' }
    return { ...base, status: 'absent' }
  }

  const inAt = gazaTime(firstIn.at)
  const inMin = toMinutes(inAt)
  const lastOut = [...punches].reverse().find((p) => p.kind === 'out' && p.at > firstIn.at)
  const stillIn = punches[punches.length - 1]!.kind === 'in'
  const lateMin = workday && inMin > toMinutes(s.start) + s.graceMinutes ? inMin - toMinutes(s.start) : 0
  const result: DayResult = { ...base, inAt, lateMin, status: lateMin ? 'late' : 'present' }

  if (!lastOut || (stillIn && a.date === a.today)) {
    return { ...result, outAt: lastOut ? gazaTime(lastOut.at) : null, status: a.date === a.today ? 'working' : 'no_out' }
  }
  const outAt = gazaTime(lastOut.at)
  const outMin = toMinutes(outAt)
  const workedMin = Math.max(0, outMin - inMin)
  const endMin = toMinutes(s.end)
  const round = (m: number) => Math.floor(m / s.overtimeRoundMinutes) * s.overtimeRoundMinutes
  const overtimeMin = workday ? (outMin - endMin >= s.overtimeMinMinutes ? round(outMin - endMin) : 0) : round(workedMin)
  const earlyMin = workday && outMin < endMin ? endMin - outMin : 0
  return { ...result, outAt, workedMin, overtimeMin, earlyMin }
}

export const presentStatuses: DayStatus[] = ['present', 'late', 'working', 'no_out']

export function weekTotals(days: DayResult[]) {
  return {
    present: days.filter((d) => presentStatuses.includes(d.status)).length,
    absent: days.filter((d) => d.status === 'absent').length,
    lateMin: days.reduce((n, d) => n + d.lateMin, 0),
    lateDays: days.filter((d) => d.lateMin > 0).length,
    overtimeMin: days.reduce((n, d) => n + d.overtimeMin, 0),
    workedMin: days.reduce((n, d) => n + d.workedMin, 0),
    leave: days.filter((d) => d.status === 'leave').length,
  }
}

export const statusLabel: Record<DayStatus, string> = {
  present: 'حاضر',
  late: 'حاضر',
  working: 'في الدوام',
  no_out: 'بلا انصراف',
  pending: 'لم يحضر بعد',
  absent: 'غائب',
  off: 'لا دوام',
  holiday: 'إجازة رسمية',
  leave: 'إجازة',
  future: '',
}

/** "08:05" Gaza time on a day -> stored time (handles summer time). */
export function gazaToIso(date: ISODate, time: string): string {
  const [y, mo, d] = date.split('-').map(Number)
  const [h, mi] = time.split(':').map(Number)
  let guess = Date.UTC(y!, mo! - 1, d!, h!, mi!)
  for (let i = 0; i < 2; i++) {
    const shown = toMinutes(hhmm.format(new Date(guess)))
    let diff = shown - (h! * 60 + mi!)
    if (diff > 720) diff -= 1440
    if (diff < -720) diff += 1440
    guess -= diff * 60_000
  }
  return new Date(guess).toISOString()
}
