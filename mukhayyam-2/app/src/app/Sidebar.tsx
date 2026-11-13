import { useLiveQuery } from 'dexie-react-hooks'
import { BookOpen, ChevronDown, ChevronRight, Stamp } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router'
import { useEmployee } from '../auth/AuthProvider'
import { db } from '../data/db'
import { todayISO } from '../lib/dates'
import { useNow } from '../lib/useNow'
import { isOpen, isOverdue } from '../features/tasks/model'
import { isManagerRole } from '../types'
import { Logo } from '../ui/primitives'
import type { NavItem } from './nav'

// The floating sidebar on the right (computers): the same pages as before, grouped, with small counters.
// On phones the bottom bar stays as it is.

const OPERATION = new Set(['/', '/generation', '/distribution', '/tasks', '/attendance', '/my-attendance', '/sheet', '/history'])
const FOLLOW = new Set(['/readings', '/seals', '/seals/recent', '/seals/unrecorded', '/seals/log', '/tasks/seal-work', '/reports'])
const SEAL_PAGES = [
  { to: '/seals', label: 'صرف الأختام' },
  { to: '/seals/recent', label: 'آخر ما صُرف' },
  { to: '/seals/unrecorded', label: 'غير المسجّلة' },
  { to: '/seals/log', label: 'تسجيل الأختام والبحث' },
]
const MINI_KEY = 'm2-sidebar-mini'
const STALE_SEAL_DAYS = 14

/** Counters next to the pages, by meaning: amber = waits for the manager, red = late. Managers only. */
function useCounts(manager: boolean) {
  const now = useNow(60_000)
  return useLiveQuery(async () => {
    if (!manager) return null
    const [reports, sheets, tasks, seals] = await Promise.all([
      db.siteReports.where('status').equals('submitted').count(),
      db.distributionSheets.where('status').equals('submitted').count(),
      db.tasks.toArray(),
      db.seals.where('status').equals('issued').toArray(),
    ])
    const cutoff = Date.parse(`${todayISO()}T12:00:00Z`) - STALE_SEAL_DAYS * 86_400_000
    return {
      '/generation': { n: reports, tone: 'amber', title: 'بانتظار اعتمادك' },
      '/distribution': { n: sheets, tone: 'amber', title: 'بانتظار اعتمادك' },
      '/tasks': { n: tasks.filter(isOpen).filter((t) => isOverdue(t, now)).length, tone: 'red', title: 'تجاوزت وقتها' },
      '/seals/unrecorded': { n: seals.filter((s) => s.issuedOn && Date.parse(`${s.issuedOn}T12:00:00Z`) < cutoff).length, tone: 'amber', title: 'أختام عند الفنيين من أكثر من أسبوعين' },
    } as Record<string, { n: number; tone: 'amber' | 'red'; title: string }>
  }, [manager, Math.floor(now.getTime() / 60_000)])
}

function readMini(): boolean {
  try {
    return localStorage.getItem(MINI_KEY) === '1'
  } catch {
    return false
  }
}

export function useSidebarMini(): [boolean, () => void] {
  const [mini, setMini] = useState(readMini)
  return [mini, () => setMini((m) => {
    try {
      localStorage.setItem(MINI_KEY, m ? '0' : '1')
    } catch {
      // Only for this visit.
    }
    return !m
  })]
}

export function Sidebar({ items, mini, onToggle }: { items: NavItem[]; mini: boolean; onToggle(): void }) {
  const employee = useEmployee()
  const manager = isManagerRole(employee.role)
  const counts = useCounts(manager)
  const { pathname } = useLocation()
  const inSeals = pathname.startsWith('/seals')
  const [sealsOpen, setSealsOpen] = useState(inSeals)
  useEffect(() => { if (inSeals) setSealsOpen(true) }, [inSeals])
  // When the seals list opens, bring its pages into view (the menu scrolls without a bar).
  const sealsBox = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!sealsOpen) return
    const t = window.setTimeout(() => sealsBox.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 420)
    return () => window.clearTimeout(t)
  }, [sealsOpen])

  const system = items.filter((i) => i.to === '/settings')
  const rest = items.filter((i) => i.to !== '/settings')
  const operation = rest.filter((i) => OPERATION.has(i.to) || !FOLLOW.has(i.to))
  const follow = rest.filter((i) => FOLLOW.has(i.to) && !OPERATION.has(i.to))
  // A manager sees one «الأختام» that opens to its four pages; the accountant keeps them as pages.
  const groupSeals = manager && follow.some((i) => i.to === '/seals')

  const count = (to: string) => {
    const c = counts?.[to]
    return c && c.n > 0 ? <span className={`sb-cnt ${c.tone} num`} title={c.title}>{c.n}</span> : null
  }
  const link = ({ to, label, icon: Icon }: NavItem) => (
    <NavLink key={to} to={to} end={to === '/' || to === '/tasks' || to === '/seals'} className="sb-item" data-tip={label} aria-label={mini ? label : undefined}>
      <Icon size={21} aria-hidden="true" />
      <span className="sb-t">{label}</span>
      {count(to)}
    </NavLink>
  )

  return (
    <aside className="sb glass" aria-label="القائمة">
      <button type="button" className="sb-collapse" onClick={onToggle} aria-label={mini ? 'توسيع القائمة' : 'تصغير القائمة'} title={mini ? 'توسيع القائمة' : 'تصغير القائمة'}>
        <ChevronRight size={14} aria-hidden="true" />
      </button>
      <NavLink to="/" className="sb-top" aria-label="الرئيسية">
        <Logo height={mini ? 32 : 64} className="sb-logo" />
        <span className="sb-name">
          <span className="sb-kicker">نظام إدارة</span>
          <span className="sb-title">مخيم<span className="sb-two num">2</span></span>
          <span className="sb-company">شركة أبناء فارس أبو زايد</span>
        </span>
      </NavLink>

      <div className="sb-scroll">
        {operation.length > 0 && (
          <>
            <div className="sb-label">التشغيل</div>
            <nav className="sb-nav" aria-label="التشغيل">{operation.map(link)}</nav>
          </>
        )}
        {follow.length > 0 && (
          <>
            <div className="sb-label">المتابعة</div>
            <nav className="sb-nav" aria-label="المتابعة">
              {follow.map((i) =>
                groupSeals && i.to === '/seals' ? (
                  <div key="seals" ref={sealsBox} className={`sb-group${sealsOpen ? ' open' : ''}`}>
                    <button type="button" className={`sb-item${inSeals ? ' active' : ''}`} data-tip="الأختام" aria-expanded={sealsOpen} onClick={() => setSealsOpen((o) => !o)}>
                      <Stamp size={21} aria-hidden="true" />
                      <span className="sb-t">الأختام</span>
                      {!sealsOpen && count('/seals/unrecorded')}
                      <ChevronDown size={16} className="sb-chev" aria-hidden="true" />
                    </button>
                    <div className="sb-sub">
                      {SEAL_PAGES.map((p) => (
                        <NavLink key={p.to} to={p.to} end className="sb-subitem">
                          <span>{p.label}</span>
                          {count(p.to)}
                        </NavLink>
                      ))}
                    </div>
                  </div>
                ) : groupSeals && i.to.startsWith('/seals/') ? null : (
                  link(i)
                ),
              )}
            </nav>
          </>
        )}
      </div>

      <div className="sb-foot">
        <div className="sb-label">النظام</div>
        <nav className="sb-nav" aria-label="النظام">
          {system.map(link)}
          {link({ to: '/guide', label: 'دليل الاستخدام', icon: BookOpen })}
        </nav>
      </div>
    </aside>
  )
}
