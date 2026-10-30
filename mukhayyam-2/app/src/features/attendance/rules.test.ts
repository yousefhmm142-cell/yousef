import { describe, expect, it } from 'vitest'
import { dayResult, gazaToIso, weekDays, weekStart, weekTotals, type Punch, type Schedule } from './rules'

const full: Schedule = { id: 1, name: 'دوام كامل', start: '08:00', end: '17:00', graceMinutes: 10, absentAfter: '10:00', overtimeMinMinutes: 15, overtimeRoundMinutes: 15, workDays: [6, 0, 1, 2, 3, 4] }
const p = (kind: 'in' | 'out', date: string, time: string): Punch => ({ id: `${kind}${time}`, employeeId: 'e', kind, at: gazaToIso(date, time), method: 'qr', reason: null, recordedBy: null })
const day = (date: string, punches: Punch[], over: Partial<Parameters<typeof dayResult>[0]> = {}) =>
  dayResult({ date, today: '2026-10-31', nowMin: 12 * 60, punches, schedule: full, ...over })

describe('attendance rules', () => {
  it('weeks start on Saturday', () => {
    expect(weekStart('2026-10-29')).toBe('2026-10-24') // Thursday -> Saturday before
    expect(weekStart('2026-10-24')).toBe('2026-10-24')
    expect(weekDays('2026-10-30')[6]).toBe('2026-10-30') // Friday ends it
  })
  it('converts Gaza time both ways, summer and winter', () => {
    expect(gazaToIso('2026-07-01', '08:00')).toBe('2026-07-01T05:00:00.000Z')
    expect(gazaToIso('2026-12-01', '08:00')).toBe('2026-12-01T06:00:00.000Z')
  })
  it('on time within the grace minutes, late after them', () => {
    expect(day('2026-10-29', [p('in', '2026-10-29', '08:09'), p('out', '2026-10-29', '17:00')]).status).toBe('present')
    const late = day('2026-10-29', [p('in', '2026-10-29', '08:25'), p('out', '2026-10-29', '17:00')])
    expect(late.status).toBe('late')
    expect(late.lateMin).toBe(25)
  })
  it('overtime from 15 minutes, rounded down to quarter hours; early leave counted', () => {
    const r = day('2026-10-29', [p('in', '2026-10-29', '07:55'), p('out', '2026-10-29', '18:40')])
    expect(r.overtimeMin).toBe(90)
    expect(r.workedMin).toBe(645)
    expect(day('2026-10-29', [p('in', '2026-10-29', '08:00'), p('out', '2026-10-29', '17:10')]).overtimeMin).toBe(0)
    expect(day('2026-10-29', [p('in', '2026-10-29', '08:00'), p('out', '2026-10-29', '15:30')]).earlyMin).toBe(90)
  })
  it('absent only after 10:00 on a work day; Friday is off; leave wins', () => {
    expect(day('2026-10-31', [], { nowMin: 9 * 60 }).status).toBe('pending')
    expect(day('2026-10-31', [], { nowMin: 10 * 60 + 1 }).status).toBe('absent')
    expect(day('2026-10-30', []).status).toBe('off')
    expect(day('2026-10-29', [], { leave: { id: 'l', employeeId: 'e', from: '2026-10-29', to: '2026-10-29', type: 'sick', notes: '' } }).status).toBe('leave')
    expect(day('2026-11-02', []).status).toBe('future')
    expect(day('2026-10-26', [], { trackingFrom: '2026-10-28' }).status).toBe('future')
    expect(day('2026-10-29', [], { trackingFrom: '2026-10-28' }).status).toBe('absent')
  })
  it('still in today, or forgot to scan out on a past day', () => {
    expect(day('2026-10-31', [p('in', '2026-10-31', '08:00')]).status).toBe('working')
    expect(day('2026-10-29', [p('in', '2026-10-29', '08:00')]).status).toBe('no_out')
  })
  it('بطالة hours end at 14:00', () => {
    const r = day('2026-10-29', [p('in', '2026-10-29', '08:00'), p('out', '2026-10-29', '14:30')], { schedule: { ...full, end: '14:00' } })
    expect(r.overtimeMin).toBe(30)
  })
  it('sums a week', () => {
    const days = [
      day('2026-10-24', [p('in', '2026-10-24', '08:20'), p('out', '2026-10-24', '17:30')]),
      day('2026-10-25', []),
      day('2026-10-26', [p('in', '2026-10-26', '08:00'), p('out', '2026-10-26', '17:00')]),
    ]
    expect(weekTotals(days)).toMatchObject({ present: 2, absent: 1, lateMin: 20, lateDays: 1, overtimeMin: 30 })
  })
})
