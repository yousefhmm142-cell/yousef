import { ensureDemoGeneration } from '../features/generation/demo'
import { db } from './db'
import type { Employee, Role } from '../types'

/** Same PIN for every sample account, shown on the login screen in demo mode. */
export const DEMO_PIN = '123456'

const people: Array<[name: string, role: Role, phone: string, tracksAttendance: boolean]> = [
  ['مسؤول النظام', 'admin', '0590000001', true],
  ['رامي أبو عجوة', 'manager', '0590000002', true],
  ['مشغّل موقع التوليد', 'generation_operator', '0590000003', false],
  ['مشرف التوزيع', 'distribution_supervisor', '0590000004', true],
  ['قصي الشافعي', 'technician', '0590000005', true],
  ['مجد عاشور', 'technician', '0590000006', true],
  ['بشار الشافعي', 'technician', '0590000008', true],
  ['أحمد طعيمة', 'technician', '0590000009', true],
  ['بشار خطاب', 'technician', '0590000010', true],
  ['موظف إداري', 'staff', '0590000007', true],
]

export const demoEmployees: Employee[] = people.map(([fullName, role, phone, tracksAttendance], i) => ({
  id: `demo-${String(i + 1).padStart(2, '0')}`,
  fullName,
  role,
  phone,
  isActive: true,
  tracksAttendance,
}))

const idOf = (role: Role) => demoEmployees.find((e) => e.role === role)!.id

/** Puts the sample team and sample reports on this device once. Safe to call on every start. */
export async function ensureDemoData(): Promise<void> {
  if ((await db.demoAccounts.count()) === 0) {
    await db.transaction('rw', db.employees, db.demoAccounts, async () => {
      await db.employees.bulkPut(demoEmployees)
      await db.demoAccounts.bulkPut(
        demoEmployees.map((e) => ({ phone: e.phone!, pin: DEMO_PIN, employeeId: e.id })),
      )
    })
  }
  await ensureDemoGeneration(idOf('manager'), idOf('generation_operator'))
}
