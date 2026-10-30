import { History, House, LayoutGrid, ListChecks, ScanLine, Settings, Users, Zap, type LucideIcon } from 'lucide-react'
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
    case 'distribution_supervisor':
      // The site: today's two forms and what was sent before, nothing else.
      return [
        { to: '/', label: 'التوليد', icon: Zap },
        { to: '/sheet', label: 'التوزيع', icon: LayoutGrid },
        { to: '/history', label: 'السابقة', icon: History },
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
