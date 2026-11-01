export type Role =
  | 'admin'
  | 'manager'
  | 'generation_operator'
  | 'distribution_supervisor'
  | 'technician'
  | 'staff'

export interface Employee {
  id: string
  fullName: string
  phone: string | null
  role: Role
  isActive: boolean
  tracksAttendance: boolean
  /** Has a phone + PIN login (real mode; demo accounts always do). */
  hasLogin?: boolean
  /** Office hours for attendance (full day or بطالة). */
  scheduleId?: number | null
  /** What they do (نائب المدير، محاسبة، فني...); shown instead of the system role when set. */
  jobTitle?: string | null
  /** Country code their WhatsApp is registered with. */
  waCode?: 970 | 972
  /** May use the two seals pages (the manager and the admin always may). */
  canSeals?: boolean
  /** Pages the manager opened for this person to look at (generation, distribution, tasks, attendance, stock). */
  pages?: string[]
  /** The name of this technician's sheet in the seals usage file. */
  sealsSheet?: string | null
}

/** The seals pages: managers, and anyone the admin gave the permission. */
export const usesSeals = (e: Pick<Employee, 'role' | 'canSeals'>) => e.role === 'admin' || e.role === 'manager' || !!e.canSeals

/** The job title when there is one, else the system role. */
export const titleOf = (e: Pick<Employee, 'jobTitle' | 'role'>) => e.jobTitle || roleLabel[e.role]

export const roleLabel: Record<Role, string> = {
  admin: 'مسؤول النظام',
  manager: 'المدير',
  generation_operator: 'موظف موقع التوليد',
  distribution_supervisor: 'موظف موقع التوليد (التوزيع)',
  technician: 'فني',
  staff: 'موظف',
}

export const isManagerRole = (role: Role) => role === 'admin' || role === 'manager'

/**
 * The people at the generation site. They fill both daily forms (generation report and
 * distribution sheet) and see nothing else. The two role names are kept for older records.
 */
export const SITE_ROLES: Role[] = ['generation_operator', 'distribution_supervisor']
export const isSiteRole = (role: Role) => SITE_ROLES.includes(role)

/** The pages a manager can open for someone to look at, in the order shown. */
export const GRANTABLE_PAGES = [
  { key: 'generation', label: 'التوليد', to: '/generation' },
  { key: 'distribution', label: 'التوزيع', to: '/distribution' },
  { key: 'tasks', label: 'المهام', to: '/tasks' },
  { key: 'attendance', label: 'الحضور', to: '/attendance' },
  { key: 'stock', label: 'المخزن', to: '/stock' },
] as const
export type PageKey = (typeof GRANTABLE_PAGES)[number]['key']

/** Managers see every page; anyone else only the pages given to them. */
export const hasPage = (e: Pick<Employee, 'role' | 'pages'>, key: PageKey) => e.role === 'admin' || e.role === 'manager' || !!e.pages?.includes(key)
