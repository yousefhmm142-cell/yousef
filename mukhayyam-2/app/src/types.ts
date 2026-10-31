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
}

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
