import { createBrowserRouter } from 'react-router'
import { useEmployee } from '../auth/AuthProvider'
import { Account } from '../pages/Account'
import { Home } from '../pages/Home'
import { LoginRoute } from '../pages/Login'
import { ModuleSoon } from '../pages/ModuleSoon'
import { NotFound, RouteError } from '../pages/states'
import { isManagerRole, type Role } from '../types'
import { AppShell } from './AppShell'
import { RequireAuth, RoleGate } from './guards'

const managers: Role[] = ['admin', 'manager']

/** Managers see the team board; everyone else sees their own attendance. */
function AttendanceRoute() {
  const employee = useEmployee()
  return <ModuleSoon module={isManagerRole(employee.role) ? 'attendance-board' : 'my-attendance'} />
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginRoute />, errorElement: <RouteError /> },
  {
    element: <RequireAuth />,
    errorElement: <RouteError />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <Home /> },
          {
            path: 'generation',
            element: <RoleGate roles={[...managers, 'generation_operator']}><ModuleSoon module="generation" /></RoleGate>,
          },
          {
            path: 'distribution',
            element: <RoleGate roles={[...managers, 'distribution_supervisor']}><ModuleSoon module="distribution" /></RoleGate>,
          },
          { path: 'tasks', element: <RoleGate roles={managers}><ModuleSoon module="tasks" /></RoleGate> },
          {
            path: 'attendance',
            element: <RoleGate roles={[...managers, 'technician', 'staff', 'distribution_supervisor']}><AttendanceRoute /></RoleGate>,
          },
          { path: 'settings', element: <RoleGate roles={['admin']}><ModuleSoon module="settings" /></RoleGate> },
          { path: 'account', element: <Account /> },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
])
