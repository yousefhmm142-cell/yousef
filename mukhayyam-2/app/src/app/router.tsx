import { createBrowserRouter } from 'react-router'
import { useEmployee } from '../auth/AuthProvider'
import { DistributionEntryPage } from '../features/distribution/EntryPage'
import { DistributionHistoryPage } from '../features/distribution/HistoryPage'
import { SheetPage } from '../features/distribution/SheetPage'
import { EntryPage } from '../features/generation/EntryPage'
import { HistoryPage } from '../features/generation/HistoryPage'
import { ReportPage } from '../features/generation/ReportPage'
import { SettingsPage } from '../features/settings/SettingsPage'
import { Account } from '../pages/Account'
import { Home } from '../pages/Home'
import { LoginRoute } from '../pages/Login'
import { ModuleSoon } from '../pages/ModuleSoon'
import { SiteHistoryPage } from '../features/sheets/SiteHistoryPage'
import { NotFound, RouteError } from '../pages/states'
import { isManagerRole, isSiteRole, SITE_ROLES, type Role } from '../types'
import { AppShell } from './AppShell'
import { RequireAuth, RoleGate } from './guards'

const managers: Role[] = ['admin', 'manager']

const site = SITE_ROLES

/** The site sees its earlier reports; managers open on the latest report. */
function GenerationIndex() {
  const employee = useEmployee()
  return isSiteRole(employee.role) ? <HistoryPage /> : <ReportPage />
}

/** The site sees its earlier sheets; managers open on the latest sheet. */
function DistributionIndex() {
  const employee = useEmployee()
  return isSiteRole(employee.role) ? <DistributionHistoryPage /> : <SheetPage />
}

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
          { path: 'generation', element: <RoleGate roles={[...managers, ...site]}><GenerationIndex /></RoleGate> },
          { path: 'generation/:date', element: <RoleGate roles={[...managers, ...site]}><ReportPage /></RoleGate> },
          { path: 'entry/:date', element: <RoleGate roles={site}><EntryPage /></RoleGate> },
          { path: 'distribution', element: <RoleGate roles={[...managers, ...site]}><DistributionIndex /></RoleGate> },
          { path: 'distribution/:date', element: <RoleGate roles={[...managers, ...site]}><SheetPage /></RoleGate> },
          { path: 'sheet', element: <RoleGate roles={site}><DistributionEntryPage /></RoleGate> },
          { path: 'sheet/:date', element: <RoleGate roles={site}><DistributionEntryPage /></RoleGate> },
          // Older links.
          { path: 'distribution/entry/:date', element: <RoleGate roles={site}><DistributionEntryPage /></RoleGate> },
          { path: 'history', element: <RoleGate roles={site}><SiteHistoryPage /></RoleGate> },
          { path: 'tasks', element: <RoleGate roles={managers}><ModuleSoon module="tasks" /></RoleGate> },
          {
            path: 'attendance',
            element: <RoleGate roles={[...managers, 'technician', 'staff']}><AttendanceRoute /></RoleGate>,
          },
          { path: 'settings', element: <RoleGate roles={['admin']}><SettingsPage /></RoleGate> },
          { path: 'account', element: <Account /> },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
])
