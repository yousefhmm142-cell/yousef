import { Boxes, FileBarChart, History, House, LayoutGrid, ListChecks, ScanLine, ScrollText, Settings, Stamp, Users, Zap, type LucideIcon } from 'lucide-react'
import { GRANTABLE_PAGES, type Employee } from '../types'

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
  { to: '/stock', label: 'المخزن', icon: Boxes },
  { to: '/seals', label: 'الأختام', icon: Stamp },
  { to: '/reports', label: 'التقارير', icon: FileBarChart },
]

/** Field roles open straight on their one job; managers get the full set. */
const grantedIcon = { generation: Zap, distribution: LayoutGrid, tasks: ListChecks, attendance: Users, stock: Boxes } as const

/** The menu of the role, plus the pages the manager opened for this person to look at. */
export function navFor(e: Pick<Employee, 'role' | 'canSeals' | 'pages'>): NavItem[] {
  const base = baseNav(e)
  if (e.role === 'admin' || e.role === 'manager' || !e.pages?.length) return base
  const have = new Set(base.map((i) => i.to))
  const extra = GRANTABLE_PAGES.filter((p) => e.pages!.includes(p.key) && !have.has(p.to)).map((p): NavItem => ({ to: p.to, label: p.label, icon: grantedIcon[p.key] }))
  return [...base, ...extra]
}

function baseNav({ role, canSeals }: Pick<Employee, 'role' | 'canSeals'>): NavItem[] {
  // Someone given the seals permission (the accountant) opens straight on the two seals pages.
  if (canSeals && (role === 'staff' || role === 'technician')) {
    return [
      { to: '/seals', label: 'صرف الأختام', icon: Stamp },
      { to: '/seals/log', label: 'سجل الأختام', icon: ScrollText },
    ]
  }
  switch (role) {
    case 'admin':
    case 'manager':
      // The manager runs the whole system, settings included.
      return [...managerItems, { to: '/settings', label: 'الإعدادات', icon: Settings }]
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
