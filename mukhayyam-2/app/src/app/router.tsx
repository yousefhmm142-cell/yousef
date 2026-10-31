import { lazy, Suspense, type ComponentType, type ReactNode } from 'react'
import { createBrowserRouter } from 'react-router'
import { useEmployee } from '../auth/AuthProvider'
import { DistributionEntryPage } from '../features/distribution/EntryPage'
import { DistributionHistoryPage } from '../features/distribution/HistoryPage'
import { SheetPage } from '../features/distribution/SheetPage'
import { EntryPage } from '../features/generation/EntryPage'
import { HistoryPage } from '../features/generation/HistoryPage'
import { ReportPage } from '../features/generation/ReportPage'
import { Account } from '../pages/Account'
import { More } from '../pages/More'
import { Home } from '../pages/Home'
import { LoginRoute } from '../pages/Login'
import { SiteHistoryPage } from '../features/sheets/SiteHistoryPage'
import { NotFound, RouteError } from '../pages/states'
import { isSiteRole, SITE_ROLES, type Role } from '../types'
import { AppShell } from './AppShell'
import { RequireAuth, RoleGate } from './guards'

// Screens most phones never open load only when first opened, so the app starts faster.
const page = <T,>(load: () => Promise<T>, name: keyof T) =>
  lazy(() => load().then((m) => ({ default: m[name] as unknown as ComponentType })))
const SettingsPage = page(() => import('../features/settings/SettingsPage'), 'SettingsPage')
const TaskLinkPage = page(() => import('../features/tasks/LinkPage'), 'TaskLinkPage')
const TasksPage = page(() => import('../features/tasks/TasksPage'), 'TasksPage')
const AttendancePage = page(() => import('../features/attendance/AttendancePage'), 'AttendancePage')
const StockPage = page(() => import('../features/stock/StockPage'), 'StockPage')
const ReportsPage = page(() => import('../features/reports/ReportsPage'), 'ReportsPage')
const AttendanceScanPage = page(() => import('../features/attendance/ScanPage'), 'AttendanceScanPage')

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

function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<div className="loading-block" aria-busy="true" />}>{children}</Suspense>
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginRoute />, errorElement: <RouteError /> },
  // The technician's page behind the link in the order: no sign-in.
  { path: '/t/:token', element: <Lazy><TaskLinkPage /></Lazy>, errorElement: <RouteError /> },
  // What the office QR sheet opens: no sign-in.
  { path: '/a/:code', element: <Lazy><AttendanceScanPage /></Lazy>, errorElement: <RouteError /> },
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
          { path: 'tasks', element: <RoleGate roles={managers}><Lazy><TasksPage /></Lazy></RoleGate> },
          {
            path: 'attendance',
            element: <RoleGate roles={managers}><Lazy><AttendancePage /></Lazy></RoleGate>,
          },
          { path: 'stock', element: <RoleGate roles={managers}><Lazy><StockPage /></Lazy></RoleGate> },
          { path: 'reports', element: <RoleGate roles={managers}><Lazy><ReportsPage /></Lazy></RoleGate> },
          { path: 'settings', element: <RoleGate roles={managers}><Lazy><SettingsPage /></Lazy></RoleGate> },
          { path: 'account', element: <Account /> },
          { path: 'more', element: <More /> },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
])
