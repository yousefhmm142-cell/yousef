import { ClipboardList, History, House, LayoutGrid, ListChecks, ScanLine, Settings, Users, Zap, type LucideIcon } from 'lucide-react'
import type { Role } from '../types'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  badge?: number
}

const managerItems: NavItem[] = [
  { to: '/', label: 'الرئيسية', icon: House },
  { to: '/generation', label: 'التوليد', icon: Zap },
  { to: '/distribution', label: 'التوزيع', icon: LayoutGrid },
  { to: '/tasks', label: 'المهام', icon: ListChecks },
  { to: '/attendance', label: 'الحضور', icon: Users },
]

/** Field roles open straight on their one job; managers get the full set. */
export function navFor(role: Role): NavItem[] {
  switch (role) {
    case 'admin':
      return [...managerItems, { to: '/settings', label: 'الإعدادات', icon: Settings }]
    case 'manager':
      return managerItems
    case 'generation_operator':
      return [
        { to: '/', label: 'تقرير اليوم', icon: ClipboardList },
        { to: '/generation', label: 'السابقة', icon: History },
      ]
    case 'distribution_supervisor':
      return [
        { to: '/', label: 'كشف اليوم', icon: ClipboardList },
        { to: '/distribution', label: 'السابقة', icon: History },
        { to: '/attendance', label: 'الحضور', icon: ScanLine },
      ]
    case 'technician':
      return [
        { to: '/', label: 'مهامي', icon: ListChecks },
        { to: '/attendance', label: 'الحضور', icon: ScanLine },
      ]
    case 'staff':
      return [{ to: '/', label: 'الحضور', icon: ScanLine }]
  }
}
