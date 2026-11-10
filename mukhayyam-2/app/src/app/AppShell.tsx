import { Ellipsis, Settings, UserRound } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'
import { useEmployee } from '../auth/AuthProvider'
import { isManagerRole, titleOf } from '../types'
import { Avatar, Logo } from '../ui/primitives'
import { StatusBadge, SyncNotice, ThemeToggle } from '../ui/status'
import { ManagerActivityProvider } from '../features/dashboard/ActivityLive'
import { navFor, type NavItem } from './nav'

const MAX_TABS = 5
const accountTab: NavItem = { to: '/account', label: 'حسابي', icon: UserRound }
/** Managers keep the long reports behind one disclosure; staff keep their page names. */
const compactLinks = new Set(['/reports', '/tasks/seal-work'])
const moreTab: NavItem = { to: '/more', label: 'المزيد', icon: Ellipsis }

export function AppShell() {
  const employee = useEmployee()
  const compact = isManagerRole(employee.role)
  const items = navFor(employee)
  // Phones: up to five tabs; the rest sit behind «المزيد».
  const tabs = items.length < MAX_TABS ? [...items, accountTab] : [...items.slice(0, MAX_TABS - 1), moreTab]

  const hasSettings = items.some((i) => i.to === '/settings')
  const moreItems = compact ? items.filter((i) => compactLinks.has(i.to)) : []
  const barItems = items.filter((i) => i.to !== '/settings' && !(compact && compactLinks.has(i.to)))
  const moreRef = useRef<HTMLDetailsElement>(null)

  // The arch follows the current section's link, as wide as its word.
  const navRef = useRef<HTMLElement>(null)
  const { pathname } = useLocation()
  useEffect(() => {
    if (moreRef.current) moreRef.current.open = false
  }, [pathname])
  useEffect(() => {
    const close = (e: PointerEvent | KeyboardEvent) => {
      const d = moreRef.current
      if (!d?.open) return
      if (e instanceof KeyboardEvent) {
        if (e.key === 'Escape') { d.open = false; d.querySelector('summary')?.focus() }
      } else if (!d.contains(e.target as Node)) d.open = false
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', close)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close) }
  }, [])
  const tabRef = useRef<HTMLElement>(null)
  const [indicator, setIndicator] = useState<{ x: number; w: number } | null>(null)
  useLayoutEffect(() => {
    const nav = tabRef.current
    if (!nav) return
    const place = () => { const el = nav.querySelector<HTMLElement>('.tab.active .tab-icon'); if (el) { const a = el.getBoundingClientRect(); const b = nav.getBoundingClientRect(); setIndicator({ x: a.left - b.left, w: a.width }) } }
    place()
    const ro = new ResizeObserver(place); ro.observe(nav)
    void document.fonts?.ready.then(place)
    return () => ro.disconnect()
  }, [pathname, tabs.length])
  const [arch, setArch] = useState<{ x: number; w: number } | null>(null)
  useLayoutEffect(() => {
    const nav = navRef.current
    if (!nav) return
    const place = () => {
      const a = nav.querySelector<HTMLElement>('.topnav-link.active')
      setArch(a ? { x: a.offsetLeft, w: a.offsetWidth } : null)
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(nav)
    void document.fonts?.ready.then(place)
    return () => ro.disconnect()
  }, [pathname, barItems.length])

  return (
    <ManagerActivityProvider enabled={compact}><div className="shell">
      <a href="#main" className="skip">تخطَّ إلى المحتوى</a>
      <div className="topbar-row">
      <header className="topbar glass">
        <Link to="/" className="app-brand" aria-label="الرئيسية">
          <Logo height={38} />
          <span className="app-brand-text">
            <b>مخيم 2</b>
            <small>أبناء فارس أبو زايد</small>
          </span>
        </Link>

        {barItems.length > 1 && (
          <nav className="topnav" aria-label="الأقسام" ref={navRef}>
            <span className={`nav-arch${arch ? ' on' : ''}`} aria-hidden="true" style={arch ? { width: arch.w, transform: `translateX(${arch.x}px)` } : undefined} />
            {barItems.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} end={to === '/' || to === '/tasks'} className={compact && compactLinks.has(to) ? 'topnav-link compact' : 'topnav-link'} aria-label={label} title={compact && compactLinks.has(to) ? label : undefined}>
                <Icon size={17} aria-hidden="true" />
                <span>{label}</span>
              </NavLink>
            ))}
          </nav>
        )}

        {moreItems.length > 0 && (
          <details ref={moreRef} className="nav-more">
            <summary className={`topnav-link nav-more-toggle${moreItems.some((i) => pathname === i.to) ? ' active' : ''}`} aria-label="التقارير وكشف أعمال الأختام" title="التقارير والكشوفات">
              <Ellipsis size={21} aria-hidden="true" />
            </summary>
            <nav className="nav-more-list" aria-label="التقارير والكشوفات">
              {moreItems.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to}><Icon size={18} aria-hidden="true" /><span>{label}</span></NavLink>
              ))}
            </nav>
          </details>
        )}

        <div className="topbar-end">
          {hasSettings && (
            <NavLink to="/settings" className="settings-btn" aria-label="الإعدادات" title="الإعدادات">
              <Settings size={22} aria-hidden="true" />
              <span>الإعدادات</span>
            </NavLink>
          )}
          <NavLink to="/account" className="me" aria-label={`حسابي: ${employee.fullName}`}>
            <span className="me-avatar">
              <Avatar name={employee.fullName} />
              <StatusBadge />
            </span>
            <span className="me-text">
              <b>{employee.fullName}</b>
              <small>{titleOf(employee)}</small>
            </span>
          </NavLink>
        </div>
      </header>
      <ThemeToggle />
      </div>

      <SyncNotice />

      <main className="page" id="main">
        <Outlet />
      </main>

      {tabs.length > 1 && (
        <nav className="tabbar glass" aria-label="الأقسام" ref={tabRef}>
          {indicator && <span className="fx-tab-indicator" aria-hidden="true" style={{ width: indicator.w, transform: `translateX(${indicator.x}px)` }} />}
          {tabs.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === '/' || to === '/tasks'} className="tab">
              <span className="tab-icon">
                <Icon size={21} aria-hidden="true" />
              </span>
              <span className="tab-label">{label}</span>
            </NavLink>
          ))}
        </nav>
      )}
    </div></ManagerActivityProvider>
  )
}
