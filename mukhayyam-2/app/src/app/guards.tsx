import type { ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'
import { useAuth, useEmployee } from '../auth/AuthProvider'
import { NoAccess } from '../pages/states'
import { Splash } from '../pages/Splash'
import { usesSeals, type Role } from '../types'

export function RequireAuth() {
  const { state } = useAuth()
  const location = useLocation()
  if (state.status === 'loading') return <Splash />
  if (state.status === 'signed_out') {
    return <Navigate to="/login" replace state={state.byUser ? undefined : { from: location.pathname }} />
  }
  return <Outlet />
}

export function RoleGate({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const employee = useEmployee()
  return roles.includes(employee.role) ? children : <NoAccess />
}

/** The seals pages: managers, and anyone the admin gave the seals permission. */
export function SealsGate({ children }: { children: ReactNode }) {
  const employee = useEmployee()
  return usesSeals(employee) ? children : <NoAccess />
}
