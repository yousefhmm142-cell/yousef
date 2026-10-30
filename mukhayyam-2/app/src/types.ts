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
}

export const roleLabel: Record<Role, string> = {
  admin: 'مسؤول النظام',
  manager: 'المدير',
  generation_operator: 'مشغّل موقع التوليد',
  distribution_supervisor: 'مشرف التوزيع',
  technician: 'فني',
  staff: 'موظف',
}

export const isManagerRole = (role: Role) => role === 'admin' || role === 'manager'
