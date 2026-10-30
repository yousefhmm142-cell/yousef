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
import { More } from '../pages/More'
import { Home } from '../pages/Home'
import { LoginRoute } from '../pages/Login'
import { SiteHistoryPage } from '../features/sheets/SiteHistoryPage'
import { TaskLinkPage } from '../features/tasks/LinkPage'
import { TasksPage } from '../features/tasks/TasksPage'
import { AttendancePage } from '../features/attendance/AttendancePage'
import { StockPage } from '../features/stock/StockPage'
import { ReportsPage } from '../features/reports/ReportsPage'
import { AttendanceScanPage } from '../features/attendance/ScanPage'
import { NotFound, RouteError } from '../pages/states'
import { isSiteRole, SITE_ROLES, type Role } from '../types'
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

export const router = createBrowserRouter([
  { path: '/login', element: <LoginRoute />, errorElement: <RouteError /> },
  // The technician's page behind the link in the order: no sign-in.
  { path: '/t/:token', element: <TaskLinkPage />, errorElement: <RouteError /> },
  // What the office QR sheet opens: no sign-in.
  { path: '/a/:code', element: <AttendanceScanPage />, errorElement: <RouteError /> },
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
          { path: 'tasks', element: <RoleGate roles={managers}><TasksPage /></RoleGate> },
          {
            path: 'attendance',
            element: <RoleGate roles={managers}><AttendancePage /></RoleGate>,
          },
          { path: 'stock', element: <RoleGate roles={managers}><StockPage /></RoleGate> },
          { path: 'reports', element: <RoleGate roles={managers}><ReportsPage /></RoleGate> },
          { path: 'settings', element: <RoleGate roles={managers}><SettingsPage /></RoleGate> },
          { path: 'account', element: <Account /> },
          { path: 'more', element: <More /> },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
])
