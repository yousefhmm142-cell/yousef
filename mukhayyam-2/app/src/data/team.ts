import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect } from 'react'
import { isDemo } from '../config'
import type { Employee, Role } from '../types'
import { db } from './db'
import { getSupabase } from './supabase'

const roleOrder: Role[] = ['manager', 'admin', 'generation_operator', 'distribution_supervisor', 'technician', 'staff']

/** The active team, read from this device and refreshed from the server when online. */
export function useTeam(): Employee[] | undefined {
  useEffect(() => {
    const sb = getSupabase()
    if (isDemo || !sb || !navigator.onLine) return
    sb.from('employees')
      .select('id, full_name, phone, role, is_active, tracks_attendance')
      .then(({ data, error }) => {
        if (error || !data) return
        return db.employees.bulkPut(
          data.map((r) => ({
            id: r.id,
            fullName: r.full_name,
            phone: r.phone,
            role: r.role,
            isActive: r.is_active,
            tracksAttendance: r.tracks_attendance,
          })),
        )
      })
  }, [])

  return useLiveQuery(async () => {
    const all = await db.employees.toArray()
    return all
      .filter((e) => e.isActive)
      .sort((a, b) => roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role) || a.fullName.localeCompare(b.fullName, 'ar'))
  }, [])
}
