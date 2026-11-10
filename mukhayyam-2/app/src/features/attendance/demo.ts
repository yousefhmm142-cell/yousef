import { db, setMeta } from '../../data/db'
import { addDays, todayISO } from '../../lib/dates'
import type { Employee } from '../../types'
import { gazaToIso, toMinutes, weekdayOf, type Punch, type Schedule } from './rules'

// Demo mode only: the two office schedules, the printed sheet, and two weeks of scans.

export const demoSchedules: Schedule[] = [
  { id: 1, name: 'دوام كامل', start: '08:00', end: '17:00', graceMinutes: 10, absentAfter: '10:00', overtimeMinMinutes: 15, overtimeRoundMinutes: 15, workDays: [6, 0, 1, 2, 3, 4] },
  { id: 2, name: 'بطالة', start: '08:00', end: '14:00', graceMinutes: 10, absentAfter: '10:00', overtimeMinMinutes: 15, overtimeRoundMinutes: 15, workDays: [6, 0, 1, 2, 3, 4] },
]

const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

export async function ensureDemoAttendance(people: Employee[]): Promise<void> {
  if ((await db.schedules.count()) === 0) await db.schedules.bulkPut(demoSchedules)
  if ((await db.attendancePoints.count()) === 0) await db.attendancePoints.put({ id: 1, name: 'المكتب', code: 'demo-office-sheet', isActive: true })
  if ((await db.punches.count()) > 0) return
  const tracked = people.filter((e) => e.tracksAttendance)
  await setMeta('demo-attendance-codes', Object.fromEntries(tracked.map((e) => [e.id, '1234'])))
  const today = todayISO()
  const now = new Date()
  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes() + 120
  const punches: Punch[] = []
  let seed = 7
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280)
  tracked.forEach((e, i) => {
    const s = demoSchedules.find((x) => x.id === (e.scheduleId ?? 1))!
    for (let back = 14; back >= 0; back--) {
      const date = addDays(today, -back)
      if (!s.workDays.includes(weekdayOf(date))) continue
      if ((back + i) % 11 === 3) continue // an absent day now and then
      const inMin = toMinutes(s.start) - 12 + Math.round(rnd() * (i % 3 === 0 ? 45 : 22))
      const outMin = toMinutes(s.end) - 5 + Math.round(rnd() * 70)
      if (date === today && inMin > nowMin) continue
      punches.push({ id: `demo-p-${e.id}-${date}-in`, employeeId: e.id, kind: 'in', at: gazaToIso(date, hm(inMin)), method: 'qr', reason: null, recordedBy: null })
      if (date === today) continue
      if ((back + i) % 13 === 5) continue // forgot to scan out
      punches.push({ id: `demo-p-${e.id}-${date}-out`, employeeId: e.id, kind: 'out', at: gazaToIso(date, hm(outMin)), method: 'qr', reason: null, recordedBy: null })
    }
  })
  await db.punches.bulkPut(punches)
}
