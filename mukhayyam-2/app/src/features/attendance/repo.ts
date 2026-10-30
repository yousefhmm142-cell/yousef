import type { EntityTable } from 'dexie'
import { useLiveQuery } from 'dexie-react-hooks'
import { isDemo } from '../../config'
import { ensureDemoData } from '../../data/demo'
import { db, getMeta, setMeta, type AttendanceDevice, type AttendancePoint } from '../../data/db'
import { getSupabase } from '../../data/supabase'
import { serverNow } from '../../lib/clock'
import { addDays, todayISO, type ISODate } from '../../lib/dates'
import { SheetStateError } from '../sheets/workflow'
import { leaveFromRow, punchFromRow, type LeaveRow, type PunchRow } from './remote'
import { gazaDate, gazaToIso, type LeaveType, type Punch, type PunchKind } from './rules'

// Attendance lives on the server; the manager's devices keep the last 60 days for reading (also
// offline). The QR page (no sign-in) talks to the server directly. Demo mode keeps everything here.

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

// ---------- Reading (manager) ----------
export const useSchedules = () => useLiveQuery(() => db.schedules.toArray(), [])
export const usePunches = () => useLiveQuery(() => db.punches.toArray(), [])
export const useLeaves = () => useLiveQuery(() => db.leaves.toArray(), [])
export const useHolidays = () => useLiveQuery(() => db.holidays.toArray(), [])
export const usePoints = () => useLiveQuery(() => db.attendancePoints.toArray(), [])
export const useDevices = () => useLiveQuery(() => db.attendanceDevices.toArray(), [])

async function replace<T extends { id: string | number }>(table: EntityTable<T, 'id'>, rows: T[]) {
  const keep = new Set(rows.map((r) => r.id))
  const old = await table.toArray()
  await table.bulkDelete(old.filter((o) => !keep.has(o.id)).map((o) => o.id) as Parameters<typeof table.bulkDelete>[0])
  await table.bulkPut(rows)
}

/** Brings the last 60 days of punches, leaves, holidays, the QR sheet and the phones. */
export async function refreshAttendance(): Promise<void> {
  if (isDemo) return
  const sb = getSupabase()
  if (!sb || !navigator.onLine) return
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString()
  const [punches, leaves, holidays, points, devices] = await Promise.all([
    sb.from('attendance_punches').select('id, employee_id, kind, at, method, reason, recorded_by').gte('at', since).order('at').limit(5000),
    sb.from('leaves').select('id, employee_id, from_date, to_date, type, notes').gte('to_date', since.slice(0, 10)),
    sb.from('holidays').select('holiday_date, name'),
    sb.from('attendance_points').select('id, name, code, is_active, revoked_at'),
    sb.from('attendance_devices').select('id, employee_id, label, created_at, last_used_at, revoked_at'),
  ])
  if (punches.error || leaves.error || holidays.error || points.error || devices.error) return
  await db.transaction('rw', [db.punches, db.leaves, db.holidays, db.attendancePoints, db.attendanceDevices], async () => {
    await replace(db.punches, (punches.data as PunchRow[]).map(punchFromRow))
    await replace(db.leaves, (leaves.data as LeaveRow[]).map(leaveFromRow))
    await db.holidays.clear()
    await db.holidays.bulkPut((holidays.data as Array<{ holiday_date: string; name: string }>).map((h) => ({ date: h.holiday_date, name: h.name })))
    await replace<AttendancePoint>(
      db.attendancePoints,
      (points.data as Array<{ id: number; name: string; code: string; is_active: boolean; revoked_at: string | null }>).map((p) => ({
        id: p.id,
        name: p.name,
        code: p.code,
        isActive: p.is_active && !p.revoked_at,
      })),
    )
    await replace<AttendanceDevice>(
      db.attendanceDevices,
      (devices.data as Array<{ id: string; employee_id: string; label: string | null; created_at: string; last_used_at: string | null; revoked_at: string | null }>).map((d) => ({
        id: d.id,
        employeeId: d.employee_id,
        label: d.label ?? '',
        createdAt: d.created_at,
        lastUsedAt: d.last_used_at,
        revokedAt: d.revoked_at,
      })),
    )
  })
}

// ---------- Manager's corrections ----------
/** A punch the person forgot to scan, with the reason; marked "manual" everywhere. */
export async function addManualPunch(employeeId: string, date: ISODate, time: string, kind: PunchKind, reason: string, by: string) {
  const text = reason.trim()
  if (!text) throw new SheetStateError('reason_needed')
  const at = gazaToIso(date, time)
  if (isDemo) {
    await db.punches.put({ id: crypto.randomUUID(), employeeId, kind, at, method: 'manual', reason: text, recordedBy: by })
    return
  }
  const sb = online()
  const res = await sb.from('attendance_punches').insert({ employee_id: employeeId, kind, at, method: 'manual', reason: text, recorded_by: by })
  check(res.error, res.status)
  await refreshAttendance()
}

export async function deletePunch(id: string) {
  if (isDemo) return void (await db.punches.delete(id))
  const sb = online()
  const res = await sb.from('attendance_punches').delete().eq('id', id)
  check(res.error, res.status)
  await db.punches.delete(id)
}

export async function addLeave(employeeId: string, date: ISODate, type: LeaveType, by: string) {
  if (isDemo) {
    await db.leaves.put({ id: crypto.randomUUID(), employeeId, from: date, to: date, type, notes: '' })
    return
  }
  const sb = online()
  const res = await sb.from('leaves').insert({ employee_id: employeeId, from_date: date, to_date: date, type, approved_by: by })
  check(res.error, res.status)
  await refreshAttendance()
}

export async function deleteLeave(id: string) {
  if (isDemo) return void (await db.leaves.delete(id))
  const sb = online()
  const res = await sb.from('leaves').delete().eq('id', id)
  check(res.error, res.status)
  await db.leaves.delete(id)
}

const newPointCode = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')

/** A new code for the printed sheet: the old paper stops working at once. */
export async function renewPoint(point: AttendancePoint) {
  const code = newPointCode()
  if (isDemo) return void (await db.attendancePoints.update(point.id, { code }))
  const sb = online()
  const res = await sb.from('attendance_points').update({ code, revoked_at: null, is_active: true }).eq('id', point.id)
  check(res.error, res.status)
  await refreshAttendance()
}

export async function revokeDevice(id: string) {
  const now = serverNow().toISOString()
  if (isDemo) return void (await db.attendanceDevices.update(id, { revokedAt: now }))
  const sb = online()
  const res = await sb.from('attendance_devices').update({ revoked_at: now }).eq('id', id)
  check(res.error, res.status)
  await refreshAttendance()
}

// ---------- Admin: hours and 4-digit code per person ----------
const DEMO_CODES = 'demo-attendance-codes'

export async function setAttendance(employeeId: string, scheduleId: number | null, code: string | null) {
  if (isDemo) {
    if (scheduleId !== null) await db.employees.update(employeeId, { scheduleId })
    if (code) await setMeta(DEMO_CODES, { ...((await getMeta<Record<string, string>>(DEMO_CODES)) ?? {}), [employeeId]: code })
    return
  }
  const sb = online()
  const { error, status } = await sb.rpc('admin_set_attendance', { p_employee_id: employeeId, p_schedule_id: scheduleId, p_code: code })
  check(error, status)
}

/** Who already has an attendance code (never the code itself). */
export async function codeHolders(): Promise<Set<string>> {
  if (isDemo) return new Set(Object.keys((await getMeta<Record<string, string>>(DEMO_CODES)) ?? {}))
  const sb = getSupabase()
  if (!sb || !navigator.onLine) return new Set()
  const { data } = await sb.rpc('attendance_code_holders')
  return new Set(((data as string[] | null) ?? []).map(String))
}

// ---------- The QR page (no sign-in) ----------
export interface ScanResult {
  name: string
  repeat: boolean
  punches: Array<{ kind: PunchKind; at: string }>
}

export async function scanPeople(point: string): Promise<Array<{ id: string; name: string }>> {
  if (isDemo) {
    // A phone opening the sheet or the link for the first time: the sample data may still be loading.
    await ensureDemoData()
    if (!(await db.attendancePoints.filter((p) => p.code === point && p.isActive).first())) throw new SheetStateError('bad_point')
    return (await db.employees.toArray()).filter((e) => e.isActive && e.tracksAttendance).map((e) => ({ id: e.id, name: e.fullName })).sort((a, b) => a.name.localeCompare(b.name, 'ar'))
  }
  const sb = online()
  const { data, error, status } = await sb.rpc('attendance_people', { p_point: point })
  check(error, status)
  return data as Array<{ id: string; name: string }>
}

/** First scan on a phone: returns the phone's private key, or null for a wrong code. */
export async function scanRegister(point: string, employeeId: string, code: string): Promise<string | null> {
  const label = navigator.userAgent.match(/\(([^)]+)\)/)?.[1]?.slice(0, 120) ?? 'جوال'
  if (isDemo) {
    // A phone opening the sheet or the link for the first time: the sample data may still be loading.
    await ensureDemoData()
    const codes = (await getMeta<Record<string, string>>(DEMO_CODES)) ?? {}
    if (!codes[employeeId]) throw new SheetStateError('no_code')
    if (codes[employeeId] !== code) return null
    const token = crypto.randomUUID()
    await db.attendanceDevices.put({ id: crypto.randomUUID(), employeeId, label, createdAt: serverNow().toISOString(), lastUsedAt: null, revokedAt: null, tokenHash: token })
    return token
  }
  const sb = online()
  const { data, error, status } = await sb.rpc('attendance_register', { p_point: point, p_employee_id: employeeId, p_code: code, p_label: label })
  check(error, status)
  return (data as string | null) ?? null
}

export async function scanPunch(point: string, token: string): Promise<ScanResult> {
  if (isDemo) {
    // A phone opening the sheet or the link for the first time: the sample data may still be loading.
    await ensureDemoData()
    if (!(await db.attendancePoints.filter((p) => p.code === point && p.isActive).first())) throw new SheetStateError('bad_point')
    const device = await db.attendanceDevices.where('tokenHash').equals(token).first()
    if (!device || device.revokedAt) throw new SheetStateError('unknown_device')
    const who = await db.employees.get(device.employeeId)
    const today = todayISO()
    const mine = (await db.punches.where('employeeId').equals(device.employeeId).toArray()).filter((p) => gazaDate(p.at) === today).sort((a, b) => a.at.localeCompare(b.at))
    const last = mine[mine.length - 1]
    const now = serverNow()
    let repeat = false
    if (last && now.getTime() - Date.parse(last.at) < 120_000) repeat = true
    else {
      const punch: Punch = { id: crypto.randomUUID(), employeeId: device.employeeId, kind: last?.kind === 'in' ? 'out' : 'in', at: now.toISOString(), method: 'qr', reason: null, recordedBy: null }
      await db.punches.put(punch)
      mine.push(punch)
    }
    await db.attendanceDevices.update(device.id, { lastUsedAt: now.toISOString() })
    return { name: who?.fullName ?? '', repeat, punches: mine.map((p) => ({ kind: p.kind, at: p.at })) }
  }
  const sb = online()
  const { data, error, status } = await sb.rpc('attendance_punch', { p_point: point, p_token: token })
  check(error, status)
  return data as ScanResult
}

/** Days shown in the weekly sheets: from 60 days back. */
export const firstKeptDay = () => addDays(todayISO(), -60)
