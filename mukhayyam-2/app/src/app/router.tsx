import { Skeleton } from '../ui/fx/Skeleton'
import { lazy, Suspense, type ComponentType, type ReactNode } from 'react'
import { createBrowserRouter, Navigate } from 'react-router'
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
import { hasPage, isManagerRole, isSiteRole, SITE_ROLES, type Role } from '../types'
import { AppShell } from './AppShell'
import { FillGate, RequireAuth, RoleGate, SealsGate, PageGate, ReadingsGate } from './guards'

// Screens most phones never open load only when first opened, so the app starts faster.
const page = <T,>(load: () => Promise<T>, name: keyof T) =>
  lazy(() => load().then((m) => ({ default: m[name] as unknown as ComponentType })))
const SettingsPage = page(() => import('../features/settings/SettingsPage'), 'SettingsPage')
const TaskLinkPage = page(() => import('../features/tasks/LinkPage'), 'TaskLinkPage')
const TasksPage = page(() => import('../features/tasks/TasksPage'), 'TasksPage')
const SealWorkPage = page(() => import('../features/tasks/SealWorkPage'), 'SealWorkPage')
const MyTasksPage = page(() => import('../features/tasks/MyTasksPage'), 'MyTasksPage')
const MyAttendancePage = page(() => import('../features/attendance/MyAttendancePage'), 'MyAttendancePage')
const AttendancePage = page(() => import('../features/attendance/AttendancePage'), 'AttendancePage')
const ReportsPage = page(() => import('../features/reports/ReportsPage'), 'ReportsPage')
const SealIssuePage = page(() => import('../features/seals/IssuePage'), 'SealIssuePage')
const SealLogPage = page(() => import('../features/seals/LogPage'), 'SealLogPage')
const SealRecentPage = page(() => import('../features/seals/RecentPage'), 'SealRecentPage')
const ReadingsPage = page(() => import('../features/readings/ReadingsPage'), 'ReadingsPage')
const AttendanceScanPage = page(() => import('../features/attendance/ScanPage'), 'AttendanceScanPage')

const managers: Role[] = ['admin', 'manager']

const site = SITE_ROLES

/** The site sees its earlier reports; managers open on the latest report. */
function GenerationIndex() {
  const employee = useEmployee()
  // Whoever was given the page fills it like the site; managers open on the latest report.
  return isSiteRole(employee.role) || (!isManagerRole(employee.role) && hasPage(employee, 'generation')) ? <HistoryPage /> : <ReportPage />
}

/** The site sees its earlier sheets; managers open on the latest sheet. */
function DistributionIndex() {
  const employee = useEmployee()
  return isSiteRole(employee.role) || (!isManagerRole(employee.role) && hasPage(employee, 'distribution')) ? <DistributionHistoryPage /> : <SheetPage />
}

function AttendanceIndex() { const me=useEmployee(); return isManagerRole(me.role)||hasPage(me,'attendance') ? <PageGate page="attendance"><Lazy><AttendancePage /></Lazy></PageGate> : <Lazy><MyAttendancePage /></Lazy> }

function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<Skeleton kind="list" />}>{children}</Suspense>
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
          { path: 'generation', element: <PageGate page="generation" roles={site}><GenerationIndex /></PageGate> },
          { path: 'generation/:date', element: <PageGate page="generation" roles={site}><ReportPage /></PageGate> },
          { path: 'entry/:date', element: <FillGate page="generation"><EntryPage /></FillGate> },
          { path: 'distribution', element: <PageGate page="distribution" roles={site}><DistributionIndex /></PageGate> },
          { path: 'distribution/:date', element: <PageGate page="distribution" roles={site}><SheetPage /></PageGate> },
          { path: 'sheet', element: <FillGate page="distribution"><DistributionEntryPage /></FillGate> },
          { path: 'sheet/:date', element: <FillGate page="distribution"><DistributionEntryPage /></FillGate> },
          // Older links.
          { path: 'distribution/entry/:date', element: <FillGate page="distribution"><DistributionEntryPage /></FillGate> },
          { path: 'history', element: <RoleGate roles={site}><SiteHistoryPage /></RoleGate> },
          { path: 'tasks', element: <PageGate page="tasks"><Lazy><TasksPage /></Lazy></PageGate> },
          { path: 'tasks/seal-work', element: <PageGate page="seal-work"><Lazy><SealWorkPage /></Lazy></PageGate> },
          {
            path: 'attendance',
            element: <AttendanceIndex />,
          },
          { path: 'readings', element: <ReadingsGate><Lazy><ReadingsPage /></Lazy></ReadingsGate> },
          { path: 'seals', element: <SealsGate><Lazy><SealIssuePage /></Lazy></SealsGate> },
          { path: 'seals/recent', element: <SealsGate><Lazy><SealRecentPage /></Lazy></SealsGate> },
          { path: 'seals/log', element: <SealsGate><Lazy><SealLogPage /></Lazy></SealsGate> },
          { path: 'reports', element: <RoleGate roles={managers}><Lazy><ReportsPage /></Lazy></RoleGate> },
          { path: 'settings', element: <RoleGate roles={managers}><Lazy><SettingsPage /></Lazy></RoleGate> },
          { path: 'permissions', element: <Navigate to="/settings?tab=permissions" replace /> },
          { path: 'my-tasks', element: <RoleGate roles={['technician']}><Lazy><MyTasksPage /></Lazy></RoleGate> },
          { path: 'my-attendance', element: <Lazy><MyAttendancePage /></Lazy> },
          { path: 'account', element: <Account /> },
          { path: 'more', element: <More /> },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
])
