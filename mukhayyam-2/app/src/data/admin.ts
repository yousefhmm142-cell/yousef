import type { EntityTable } from 'dexie'
import { isDemo } from '../config'
import { SheetStateError } from '../features/sheets/workflow'
import type { Employee, Role } from '../types'
import { db, getMeta, setMeta } from './db'
import { getSupabase } from './supabase'
import { pullReference, SyncError } from './sync'

// What the admin changes in settings: generators, zones, people and their logins.
// In real mode these are saved on the server first (they need internet) and then copied to this
// device, so every phone gets the same lists. In demo mode they stay on this device.

/** Error codes the settings screens turn into Arabic. */
export type AdminErrorCode =
  | 'duplicate_name'
  | 'missing'
  | 'offline'
  | 'bad_name'
  | 'bad_phone'
  | 'bad_pin'
  | 'phone_taken'
  | 'pin_needed'
  | 'last_admin'
  | 'not_allowed'
  | 'already_set_up'
  | 'unknown'

const KNOWN: AdminErrorCode[] = ['bad_name', 'bad_phone', 'bad_pin', 'phone_taken', 'pin_needed', 'missing', 'last_admin', 'not_allowed', 'already_set_up']

function fail(code: AdminErrorCode): never {
  throw new SheetStateError(code)
}

/** Turns a server reply into one of the codes above. */
function failFrom(error: { code?: string; message?: string } | null, status: number): never {
  if (!error || status === 0 || !error.code) fail('offline')
  if (error.code === '23505') fail('duplicate_name')
  const known = KNOWN.find((k) => error.message === k)
  if (known) fail(known)
  if (error.code === '42501') fail('not_allowed')
  fail('unknown')
}

function online() {
  const sb = getSupabase()
  if (!sb) fail('unknown')
  if (!navigator.onLine) fail('offline')
  return sb
}

async function refresh() {
  try {
    await pullReference()
  } catch (e) {
    // Saved on the server; this device catches up on the next round.
    if (!(e instanceof SyncError)) throw e
  }
}

interface ListItem {
  id: number
  name: string
  isActive: boolean
  sortOrder: number
}

/** Adds or edits one entry of a numbered list (generators, zones). New entries go to the end. */
export async function saveListItem<T extends ListItem>(
  table: EntityTable<T, 'id'>,
  remoteTable: 'generators' | 'zones' | 'fuel_types' | 'stock_items',
  input: Omit<T, 'id' | 'sortOrder'> & { id?: number },
  toRow: (item: Omit<T, 'id' | 'sortOrder'>) => Record<string, unknown>,
): Promise<void> {
  const all = await table.toArray()
  if (all.some((x) => x.name === input.name && x.id !== input.id)) fail('duplicate_name')
  if (input.id !== undefined && !all.some((x) => x.id === input.id)) fail('missing')
  const sortOrder = Math.max(0, ...all.map((x) => x.sortOrder)) + 1

  if (isDemo) {
    await db.transaction('rw', table, async () => {
      if (input.id !== undefined) {
        const existing = all.find((x) => x.id === input.id)!
        await table.put({ ...existing, ...input, id: input.id })
      } else {
        const id = Math.max(0, ...(await table.toArray()).map((x) => x.id)) + 1
        await table.put({ ...input, id, sortOrder } as T)
      }
    })
    return
  }

  const sb = online()
  const row = toRow(input)
  const res =
    input.id !== undefined
      ? await sb.from(remoteTable).update(row).eq('id', input.id).select('id')
      : await sb.from(remoteTable).insert({ ...row, sort_order: sortOrder }).select('id')
  if (res.error) failFrom(res.error, res.status)
  if (!res.data?.length) fail('not_allowed')
  await refresh()
}

// ---------- People ----------
export interface EmployeeInput {
  id?: string
  fullName: string
  role: Role
  phone: string | null
  /** A new 6-digit PIN, or null to keep the current one. */
  pin: string | null
  isActive: boolean
  tracksAttendance: boolean
  /** What they do (نائب المدير، محاسبة...); empty for none. */
  jobTitle?: string | null
  /** Country code their WhatsApp is registered with. */
  waCode?: 970 | 972
  /** May use the seals pages. */
  canSeals?: boolean
}

/** Returns the person's id (new or existing). */
export async function saveEmployee(input: EmployeeInput): Promise<string> {
  const name = input.fullName.trim()
  const phone = input.phone?.trim() || null
  if (name.length < 2 || name.length > 80) fail('bad_name')
  if (phone !== null && !/^05\d{8}$/.test(phone)) fail('bad_phone')
  if (input.pin !== null && !/^\d{6}$/.test(input.pin)) fail('bad_pin')
  if (input.pin !== null && phone === null) fail('bad_phone')

  if (isDemo) {
    return db.transaction('rw', db.employees, db.demoAccounts, async () => {
      const all = await db.employees.toArray()
      if (phone && all.some((e) => e.phone === phone && e.id !== input.id)) fail('phone_taken')
      const before = input.id ? all.find((e) => e.id === input.id) : undefined
      if (input.id && !before) fail('missing')
      const admins = all.filter((e) => e.role === 'admin' && e.isActive && e.id !== input.id)
      if (before?.role === 'admin' && (input.role !== 'admin' || !input.isActive) && admins.length === 0) fail('last_admin')
      const id = input.id ?? `demo-${crypto.randomUUID().slice(0, 8)}`
      const account = before?.phone ? await db.demoAccounts.get(before.phone) : undefined
      if (account && account.phone !== phone) await db.demoAccounts.delete(account.phone)
      const pin = input.pin ?? account?.pin ?? null
      if (phone && pin) await db.demoAccounts.put({ phone, pin, employeeId: id })
      await db.employees.put({
        ...before,
        id,
        fullName: name,
        role: input.role,
        phone,
        isActive: input.isActive,
        tracksAttendance: input.tracksAttendance,
        hasLogin: !!(phone && pin),
        jobTitle: input.jobTitle?.trim() || null,
        waCode: input.waCode ?? before?.waCode ?? 972,
        canSeals: input.canSeals ?? before?.canSeals ?? false,
      })
      return id
    })
  }

  const sb = online()
  const { data, error, status } = await sb.rpc('admin_save_employee', {
    p_id: input.id ?? null,
    p_full_name: name,
    p_role: input.role,
    p_phone: phone,
    p_pin: input.pin,
    p_is_active: input.isActive,
    p_tracks_attendance: input.tracksAttendance,
  })
  if (error) failFrom(error, status)
  const id = data as string
  if (input.jobTitle !== undefined || input.waCode !== undefined) {
    const res = await sb.rpc('admin_set_profile', { p_id: id, p_job_title: input.jobTitle ?? null, p_wa_code: input.waCode ?? null })
    // A database without update 7 has no job titles yet: the rest is saved, so carry on.
    if (res.error && res.error.code !== 'PGRST202' && res.status !== 404) failFrom(res.error, res.status)
  }
  if (input.canSeals !== undefined) {
    const res = await sb.rpc('admin_set_seals_access', { p_id: id, p_value: input.canSeals })
    // A database without update 10 has no seals yet: the rest is saved, so carry on.
    if (res.error && res.error.code !== 'PGRST202' && res.status !== 404) failFrom(res.error, res.status)
  }
  await refresh()
  return id
}

/** The name of what a person does (نائب المدير، محاسبة...); empty for none. */
export async function setJobTitle(id: string, title: string): Promise<void> {
  const text = title.trim().slice(0, 60)
  if (isDemo) {
    await db.employees.update(id, { jobTitle: text || null })
    return
  }
  const sb = online()
  const res = await sb.rpc('admin_set_profile', { p_id: id, p_job_title: text, p_wa_code: null })
  if (res.error) failFrom(res.error, res.status)
  await refresh()
}

/** Gives or takes away the seals pages for one person (manager and admin only; the server checks). */
export async function setSealsAccess(id: string, value: boolean): Promise<void> {
  if (isDemo) {
    await db.employees.update(id, { canSeals: value })
    return
  }
  const sb = online()
  const res = await sb.rpc('admin_set_seals_access', { p_id: id, p_value: value })
  if (res.error) failFrom(res.error, res.status)
  await refresh()
}

/** The pages the manager opens for a person to look at (the server checks the caller is a manager). */
export async function setPages(id: string, pages: string[]): Promise<void> {
  if (isDemo) {
    await db.employees.update(id, { pages })
    return
  }
  const sb = online()
  const res = await sb.rpc('admin_set_pages', { p_id: id, p_pages: pages })
  if (res.error) failFrom(res.error, res.status)
  await refresh()
}

// ---------- First run (real mode) ----------
/**
 * What the login screen should show on a real database:
 * - 'setup': ready, but no admin yet (show first-time setup);
 * - 'ready': sign in as usual;
 * - 'not_installed': setup.sql was not run on this Supabase project yet;
 * - 'bad_key': the address or key built into the app does not match the project;
 * - 'unknown': no internet or no answer (sign-in is still offered).
 */
export type DatabaseState = 'setup' | 'ready' | 'not_installed' | 'bad_key' | 'unknown'

export async function databaseState(): Promise<DatabaseState> {
  const sb = getSupabase()
  if (!sb || !navigator.onLine) return 'unknown'
  try {
    const { data, error, status } = await sb.rpc('setup_needed')
    if (!error) return data === true ? 'setup' : 'ready'
    if (status === 401 || status === 403) return 'bad_key'
    if (error.code === 'PGRST202' || status === 404) return 'not_installed'
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

export async function setupFirstAdmin(fullName: string, phone: string, pin: string): Promise<void> {
  const sb = online()
  const { error, status } = await sb.rpc('setup_first_admin', { p_full_name: fullName.trim(), p_phone: phone, p_pin: pin })
  if (error) failFrom(error, status)
}

/** Everyone, active first, then by role and name. */
export const employeeOrder: Role[] = ['admin', 'manager', 'generation_operator', 'distribution_supervisor', 'technician', 'staff']
export const byRoleThenName = (a: Employee, b: Employee) =>
  Number(b.isActive) - Number(a.isActive) ||
  employeeOrder.indexOf(a.role) - employeeOrder.indexOf(b.role) ||
  a.fullName.localeCompare(b.fullName, 'ar')

// ---------- Backup ----------
/** Every table, in the order they would be loaded back. */
const BACKUP_TABLES = [
  'work_schedules', 'app_settings', 'holidays', 'employees', 'generators', 'fuel_types', 'zones', 'task_types',
  'site_reports', 'site_report_fuel', 'generator_day_logs', 'generator_runs', 'maintenance_logs',
  'distribution_sheets', 'zone_day_entries', 'zone_runs',
  'tasks', 'task_events', 'outgoing_messages', 'attendance_points', 'attendance_punches', 'leaves', 'audit_log',
] as const

const LAST_BACKUP = 'last-backup'

/**
 * A full copy of the data as one file on this computer (the free Supabase plan keeps no daily
 * copies). Real mode reads every table from the server; demo mode copies this device.
 */
export async function downloadBackup(): Promise<void> {
  const tables: Record<string, unknown[]> = {}
  if (isDemo) {
    for (const t of db.tables) tables[t.name] = await t.toArray()
  } else {
    const sb = online()
    for (const name of BACKUP_TABLES) {
      const rows: unknown[] = []
      // The server hands out at most 1000 rows per request.
      for (let from = 0; ; from += 1000) {
        const { data, error, status } = await sb.from(name).select('*').range(from, from + 999)
        if (error) failFrom(error, status)
        rows.push(...(data ?? []))
        if (!data || data.length < 1000) break
      }
      tables[name] = rows
    }
  }
  const now = new Date()
  const file = new Blob([JSON.stringify({ app: 'mukhayyam2', version: 1, createdAt: now.toISOString(), demo: isDemo, tables })], {
    type: 'application/json',
  })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(file)
  a.download = `mukhayyam2-backup-${now.toISOString().slice(0, 10)}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
  await setMeta(LAST_BACKUP, now.toISOString())
}

export const lastBackupAt = () => getMeta<string>(LAST_BACKUP)

// ---------- Nightly copies kept on the server (real mode) ----------
export interface ServerBackup {
  id: number
  takenAt: string
  sizeBytes: number
}

export async function listServerBackups(): Promise<ServerBackup[]> {
  const sb = getSupabase()
  if (!sb || isDemo || !navigator.onLine) return []
  const { data, error } = await sb.rpc('backup_list')
  if (error || !data) return []
  return (data as Array<{ id: number; taken_at: string; size_bytes: number }>).map((b) => ({ id: b.id, takenAt: b.taken_at, sizeBytes: b.size_bytes }))
}

export async function downloadServerBackup(b: ServerBackup): Promise<void> {
  const sb = online()
  const { data, error, status } = await sb.from('backups').select('data').eq('id', b.id).single()
  if (error) failFrom(error, status)
  const file = new Blob([JSON.stringify((data as { data: unknown }).data)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(file)
  a.download = `mukhayyam2-backup-auto-${b.takenAt.slice(0, 10)}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
}
