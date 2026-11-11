import type { SupabaseClient } from '@supabase/supabase-js'
import { config } from '../config'
import { db, deleteMeta, getMeta, setMeta } from '../data/db'
import { ensureDemoData } from '../data/demo'
import { syncClock } from '../lib/clock'
import type { Employee, Role } from '../types'

export interface AuthBackend {
  /** The person already signed in on this device, if any. Works offline. */
  restore(): Promise<Employee | null>
  signIn(phone: string, pin: string): Promise<Employee>
  signOut(): Promise<void>
}

export type AuthErrorCode = 'rate_limited' | 'bad_credentials' | 'offline' | 'inactive' | 'unknown'

export class AuthError extends Error {
  readonly code: AuthErrorCode
  constructor(code: AuthErrorCode) {
    super(code)
    this.code = code
  }
}

export const authErrorText: Record<AuthErrorCode, { title: string; detail: string }> = {
  rate_limited: { title: 'محاولات كثيرة', detail: 'استنى ربع ساعة وحاول من جديد.' },
  bad_credentials: { title: 'رقم الجوال أو الرمز غير صحيح', detail: 'تأكد منهما وحاول مرة أخرى.' },
  offline: { title: 'لا يوجد اتصال بالإنترنت', detail: 'أول دخول على هذا الجهاز يحتاج إنترنت، وبعدها يعمل التطبيق بدونه.' },
  inactive: { title: 'هذا الحساب غير مفعّل', detail: 'تواصل مع مسؤول النظام لتفعيله.' },
  unknown: { title: 'تعذّر الدخول الآن', detail: 'حاول مرة أخرى بعد قليل.' },
}

// ---------- Demo mode: sample accounts stored on this device ----------
const DEMO_SESSION = 'demo-session'

export const demoBackend: AuthBackend = {
  async restore() {
    await ensureDemoData()
    const id = await getMeta<string>(DEMO_SESSION)
    const employee = id ? await db.employees.get(id) : undefined
    return employee?.isActive ? employee : null
  },
  async signIn(phone, pin) {
    await ensureDemoData()
    const account = await db.demoAccounts.get(phone)
    if (!account || account.pin !== pin) throw new AuthError('bad_credentials')
    const employee = await db.employees.get(account.employeeId)
    if (!employee?.isActive) throw new AuthError('inactive')
    await setMeta(DEMO_SESSION, employee.id)
    return employee
  },
  async signOut() {
    await deleteMeta(DEMO_SESSION)
  },
}

// ---------- Real mode: Supabase ----------
const PROFILE = 'profile'

interface EmployeeRow {
  id: string
  full_name: string
  phone: string | null
  role: Role
  is_active: boolean
  tracks_attendance: boolean
  /** Only once update 10 is on the database. */
  can_seals?: boolean
  pages?: string[] | null
}

const toEmployee = (row: EmployeeRow): Employee => ({
  id: row.id,
  fullName: row.full_name,
  phone: row.phone,
  role: row.role,
  isActive: row.is_active,
  tracksAttendance: row.tracks_attendance,
  canSeals: row.can_seals ?? false,
  pages: row.pages ?? [],
})

async function loadProfile(sb: SupabaseClient, userId: string): Promise<Employee | null> {
  const { data, error } = await sb
    .from('employees')
    // '*' so sign-in keeps working on a database that does not have the newer columns yet.
    .select('*')
    .eq('auth_user_id', userId)
    .maybeSingle<EmployeeRow>()
  if (error) throw error
  return data ? toEmployee(data) : null
}

function syncServerClock(sb: SupabaseClient) {
  syncClock(async () => {
    const { data, error } = await sb.rpc('server_now')
    if (error) throw error
    return new Date(data as string)
  }).catch(() => {
    // Offline or slow: keep the last measured offset.
  })
}

/** A slow line counts as no line: the app opens from what it already has. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, no) => setTimeout(() => no(new Error('timeout')), ms))])
}

/** Is a sign-in saved on this device (even if its short-lived key needs renewing when the internet is back)? */
async function sessionStored(): Promise<boolean> {
  try {
    return Object.keys(localStorage).some((k) => k.startsWith('sb-') && k.endsWith('-auth-token'))
  } catch {
    return false
  }
}

export function supabaseBackend(sb: SupabaseClient): AuthBackend {
  return {
    async restore() {
      // Opening without internet: straight in with the profile saved at the last sign-in (no waiting on the network).
      const saved = await getMeta<Employee>(PROFILE)
      if (!navigator.onLine && saved) return saved
      const { data } = await withTimeout(sb.auth.getSession(), 4000).catch(() => ({ data: { session: null as null | { user: { id: string } } } }))
      const user = data.session?.user
      if (!user) return saved && !navigator.onLine ? saved : saved && (await sessionStored()) ? saved : null
      try {
        const employee = await withTimeout(loadProfile(sb, user.id), 5000)
        if (!employee?.isActive) {
          await sb.auth.signOut()
          await deleteMeta(PROFILE)
          return null
        }
        await setMeta(PROFILE, employee)
        syncServerClock(sb)
        return employee
      } catch {
        // No internet: open with the profile saved at the last sign-in.
        return (await getMeta<Employee>(PROFILE)) ?? null
      }
    },
    async signIn(phone, pin) {
      if (!navigator.onLine) throw new AuthError('offline')
      const { data, error } = await sb.auth.signInWithPassword({
        email: `${phone}@${config.authEmailDomain}`,
        password: pin,
      })
      if (error) {
        if (error.status === 429 || error.message.includes('محاولات كثيرة')) throw new AuthError('rate_limited')
        if (error.status === 400) throw new AuthError('bad_credentials')
        throw new AuthError(navigator.onLine ? 'unknown' : 'offline')
      }
      const employee = await loadProfile(sb, data.user.id).catch(() => null)
      if (!employee?.isActive) {
        await sb.auth.signOut()
        throw new AuthError('inactive')
      }
      await setMeta(PROFILE, employee)
      syncServerClock(sb)
      return employee
    },
    async signOut() {
      await sb.auth.signOut().catch(() => undefined)
      await deleteMeta(PROFILE)
    },
  }
}
