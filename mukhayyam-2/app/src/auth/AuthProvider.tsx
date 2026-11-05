import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { isDemo } from '../config'
import { getSupabase } from '../data/supabase'
import { startPresence, stopPresence } from '../data/presence'
import { flushBeforeSignOut, prepareDevice, startSync, stopSync } from '../data/sync'
import type { Employee } from '../types'
import { AuthError, demoBackend, supabaseBackend } from './backends'
import { deleteMeta, getMeta, setMeta } from '../data/db'
import { createOfflinePin, offlinePinKey, verifyOfflinePin, type OfflinePin } from './offlinePin'

export type AuthState =
  | { status: 'loading' }
  /** byUser: they pressed sign out, so the next person starts from their own home screen. */
  | { status: 'signed_out'; byUser?: boolean }
  /** The session and unsent work remain on the device; the screens need the PIN again. */
  | { status: 'locked'; employee: Employee }
  | { status: 'signed_in'; employee: Employee }

interface AuthContextValue {
  state: AuthState
  signIn(phone: string, pin: string, onVerified?: () => Promise<void>): Promise<void>
  signOut(): Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

const LAST_PHONE = 'm2-last-phone'

/** The phone used last on this device, so returning people only type their PIN. */
export function lastPhone(): string {
  try {
    return localStorage.getItem(LAST_PHONE) ?? ''
  } catch {
    return ''
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const backend = useMemo(() => (isDemo ? demoBackend : supabaseBackend(getSupabase()!)), [])
  const [state, setState] = useState<AuthState>({ status: 'loading' })

  useEffect(() => {
    let alive = true
    backend
      .restore()
      .then((employee) => alive && setState(employee ? { status: 'locked', employee } : { status: 'signed_out' }))
      .catch(() => alive && setState({ status: 'signed_out' }))
    return () => {
      alive = false
    }
  }, [backend])

  // Real mode: keep this device in step with the server while someone is signed in.
  const signedIn = state.status === 'signed_in' || state.status === 'locked' ? state.employee : null
  useEffect(() => {
    if (!signedIn) return
    startSync(signedIn)
    startPresence(signedIn)
    return () => {
      stopSync()
      stopPresence()
    }
  }, [signedIn])

  useEffect(() => {
    const lock = () => setState((s) => s.status === 'signed_in' ? { status: 'locked', employee: s.employee } : s)
    const onHide = () => { if (document.visibilityState === 'hidden') lock() }
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) lock() }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', lock)
    window.addEventListener('pageshow', onShow)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', lock)
      window.removeEventListener('pageshow', onShow)
    }
  }, [])

  const signIn = useCallback(
    async (phone: string, pin: string, onVerified?: () => Promise<void>) => {
      let employee: Employee
      if (!navigator.onLine && state.status === 'locked' && state.employee.phone === phone) {
        const saved = await getMeta<OfflinePin>(offlinePinKey(state.employee.id))
        if (!saved) throw new AuthError('unlock_needs_connection')
        if (!await verifyOfflinePin(saved, state.employee.id, phone, pin)) throw new AuthError('bad_credentials')
        employee = state.employee
      } else {
        employee = await backend.signIn(phone, pin)
        // Older devices without Web Crypto can still sign in online.
        await createOfflinePin(employee.id, phone, pin).then((v) => setMeta(offlinePinKey(employee.id), v)).catch(() => undefined)
      }
      try {
        localStorage.setItem(LAST_PHONE, phone)
      } catch {
        // Only a convenience.
      }
      // First screen opens complete: lists and sheets are loaded while the button still spins.
      await prepareDevice(employee).catch(() => undefined)
      if (!document.hidden) await onVerified?.()
      setState({ status: document.hidden ? 'locked' : 'signed_in', employee })
    },
    [backend, state],
  )

  const signOut = useCallback(async () => {
    // Send what is still waiting first, so it reaches the manager even if someone else signs in next.
    await flushBeforeSignOut().catch(() => undefined)
    stopSync()
    await backend.signOut()
    if (state.status === 'signed_in' || state.status === 'locked') await deleteMeta(offlinePinKey(state.employee.id)).catch(() => undefined)
    setState({ status: 'signed_out', byUser: true })
  }, [backend, state])

  const value = useMemo(() => ({ state, signIn, signOut }), [state, signIn, signOut])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

/** The signed-in person. Only for screens behind RequireAuth. */
export function useEmployee(): Employee {
  const { state } = useAuth()
  if (state.status !== 'signed_in') throw new Error('useEmployee used outside a signed-in screen')
  return state.employee
}
