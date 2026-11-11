import { useMemo } from 'react'
import { useTeam } from '../../data/team'
import { todayISO,type ISODate } from '../../lib/dates'
import { useNow } from '../../lib/useNow'
import type { Employee } from '../../types'
import { type Tone } from '../../ui/primitives'
import { SheetStateError } from '../sheets/workflow'
import {
useHolidays,
useLeaves,usePunches,
useSchedules
} from './repo'
import {
dayResult,
gazaDate,
gazaTime,toMinutes,type DayResult,
type DayStatus,type Schedule
} from './rules'

export const statusTone: Record<DayStatus, Tone> = {
  present: 'ok',
  late: 'ok',
  working: 'ok',
  no_out: 'warn',
  pending: 'neutral',
  absent: 'danger',
  off: 'neutral',
  holiday: 'neutral',
  leave: 'info',
  future: 'neutral',
}

export const errText = (e: unknown) =>
  ({ offline: 'يحتاج إنترنت. اتصل وحاول مرة أخرى.', reason_needed: 'اكتب السبب.' } as Record<string, string>)[e instanceof SheetStateError ? e.message : ''] ??
  'تعذّر الحفظ. حاول مرة أخرى.'

/** Everything needed to work out any person's day. */
export function useAttendanceData() {
  const team = useTeam()
  const schedules = useSchedules()
  const punches = usePunches()
  const leaves = useLeaves()
  const holidays = useHolidays()
  const now = useNow(60_000)
  const today = todayISO()
  const nowMin = toMinutes(gazaTime(now.toISOString()))
  // The team's own order, with those on the «بطالة» hours at the end of the list (and of the printed sheet).
  const people = useMemo(() => {
    const idle = (e: Employee) => (schedules?.find((s) => s.id === e.scheduleId)?.name ?? '').includes('بطالة')
    const list = (team ?? []).filter((e) => e.tracksAttendance)
    return [...list.filter((e) => !idle(e)), ...list.filter(idle)]
  }, [team, schedules])
  const byDay = useMemo(() => {
    const m = new Map<string, typeof punches>()
    for (const p of punches ?? []) {
      const k = `${p.employeeId}|${gazaDate(p.at)}`
      m.set(k, [...(m.get(k) ?? []), p])
    }
    return m
  }, [punches])
  const ready = !!team && !!schedules && !!punches && !!leaves && !!holidays
  // Absences count from the first scan the system ever saw, not from before it was in use.
  const trackingFrom = useMemo(() => (punches ?? []).reduce<ISODate>((min, p) => (gazaDate(p.at) < min ? gazaDate(p.at) : min), today), [punches, today])
  const scheduleOf = (e: Employee): Schedule | undefined => schedules?.find((s) => s.id === e.scheduleId) ?? schedules?.[0]
  const day = (e: Employee, date: ISODate): DayResult | null => {
    const s = scheduleOf(e)
    if (!s) return null
    return dayResult({
      date,
      today,
      nowMin,
      punches: byDay.get(`${e.id}|${date}`) ?? [],
      schedule: s,
      holiday: holidays?.find((h) => h.date === date)?.name,
      leave: leaves?.find((l) => l.employeeId === e.id && l.from <= date && l.to >= date),
      trackingFrom,
    })
  }
  return { ready, people, day, scheduleOf, today, byDay }
}

export type Data = ReturnType<typeof useAttendanceData>
