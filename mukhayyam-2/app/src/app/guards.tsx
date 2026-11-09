import type { ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'
import { useAuth, useEmployee } from '../auth/AuthProvider'
import { NoAccess } from '../pages/states'
import { Splash } from '../pages/Splash'
import { hasPage, usesSeals, type PageKey, type Role } from '../types'

export function RequireAuth() {
  const { state } = useAuth()
  const location = useLocation()
  if (state.status === 'loading') return <Splash />
  if (state.status === 'signed_out') {
    return <Navigate to="/login" replace state={state.byUser ? undefined : { from: location.pathname + location.search }} />
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

/** «القراءات»: managers, the readings office, and the readers (they work there, it is not just to look). */
export function ReadingsGate({ children }: { children: ReactNode }) {
  const employee = useEmployee()
  return hasPage(employee, 'readings') || hasPage(employee, 'readings-admin') ? children : <NoAccess />
}

/** Filling a day's form: managers, the site roles, and whoever was given that page (the database lets them). */
export function FillGate({ page, children }: { page: 'generation' | 'distribution'; children: ReactNode }) {
  const employee = useEmployee()
  const ok = employee.role === 'admin' || employee.role === 'manager' || employee.role === 'generation_operator' || employee.role === 'distribution_supervisor' || hasPage(employee, page)
  return ok ? children : <NoAccess />
}

/** A manager page that the manager may have opened for this person: the roles in `roles`, or the page itself. */
export function PageGate({ page, roles, children }: { page: PageKey; roles?: Role[]; children: ReactNode }) {
  const employee = useEmployee()
  // Tasks are run by whoever has the page (the database lets him), so that page is not «view only».
  const view = !roles?.includes(employee.role) && employee.role !== 'admin' && employee.role !== 'manager' && page !== 'tasks' && page !== 'seal-work' && page !== 'generation' && page !== 'distribution'
  if (!(roles?.includes(employee.role) || hasPage(employee, page))) return <NoAccess />
  return view ? (
    <>
      <p className="view-note" role="note">هذه الصفحة للاطلاع فقط: فتحها لك المدير لتشاهد ولا تعدّل.</p>
      {children}
    </>
  ) : (
    children
  )
}
