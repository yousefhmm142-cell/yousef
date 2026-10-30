import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { isDemo } from '../config'
import { getSupabase } from '../data/supabase'
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

  const signIn = useCallback(
    async (phone: string, pin: string) => {
      const employee = await backend.signIn(phone, pin)
      try {
        localStorage.setItem(LAST_PHONE, phone)
      } catch {
        // Only a convenience.
      }
      setState({ status: 'signed_in', employee })
    },
    [backend],
  )

  const signOut = useCallback(async () => {
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
