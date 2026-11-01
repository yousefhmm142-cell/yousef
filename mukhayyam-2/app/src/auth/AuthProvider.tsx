import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { isDemo } from '../config'
import { getSupabase } from '../data/supabase'
import { startPresence, stopPresence } from '../data/presence'
import { flushBeforeSignOut, prepareDevice, startSync, stopSync } from '../data/sync'
import type { Employee } from '../types'
import { demoBackend, supabaseBackend } from './backends'

export type AuthState =
  | { status: 'loading' }
  /** byUser: they pressed sign out, so the next person starts from their own home screen. */
  | { status: 'signed_out'; byUser?: boolean }
  | { status: 'signed_in'; employee: Employee }

interface AuthContextValue {
  state: AuthState
  signIn(phone: string, pin: string): Promise<void>
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
      .then((employee) => alive && setState(employee ? { status: 'signed_in', employee } : { status: 'signed_out' }))
      .catch(() => alive && setState({ status: 'signed_out' }))
    return () => {
      alive = false
    }
  }, [backend])

  // Real mode: keep this device in step with the server while someone is signed in.
  const signedIn = state.status === 'signed_in' ? state.employee : null
  useEffect(() => {
    if (!signedIn) return
    startSync(signedIn)
    startPresence(signedIn)
    return () => {
      stopSync()
      stopPresence()
    }
  }, [signedIn])

  const signIn = useCallback(
    async (phone: string, pin: string) => {
      const employee = await backend.signIn(phone, pin)
      try {
        localStorage.setItem(LAST_PHONE, phone)
      } catch {
        // Only a convenience.
      }
      // First screen opens complete: lists and sheets are loaded while the button still spins.
      await prepareDevice(employee).catch(() => undefined)
      setState({ status: 'signed_in', employee })
    },
    [backend],
  )

  const signOut = useCallback(async () => {
    // Send what is still waiting first, so it reaches the manager even if someone else signs in next.
    await flushBeforeSignOut().catch(() => undefined)
    stopSync()
    await backend.signOut()
    setState({ status: 'signed_out', byUser: true })
  }, [backend])

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
