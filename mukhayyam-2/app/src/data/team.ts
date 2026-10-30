import { useLiveQuery } from 'dexie-react-hooks'
import type { Employee, Role } from '../types'
import { db } from './db'

const roleOrder: Role[] = ['manager', 'admin', 'generation_operator', 'distribution_supervisor', 'technician', 'staff']

/** The active team, as kept on this device (data/sync.ts refreshes it from the server). */
export function useTeam(): Employee[] | undefined {
  return useLiveQuery(async () => {
    const all = await db.employees.toArray()
    return all
      .filter((e) => e.isActive)
      .sort((a, b) => roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role) || a.fullName.localeCompare(b.fullName, 'ar'))
  }, [])
}
