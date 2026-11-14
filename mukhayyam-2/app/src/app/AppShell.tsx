import { RejectedNotice } from '../ui/RejectedNotice'
import { PullToRefresh } from '../ui/fx/PullToRefresh'
import { Ellipsis, Search, Settings, UserRound } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'
import { useEmployee } from '../auth/AuthProvider'
import { isManagerRole, titleOf } from '../types'
import { Avatar, Logo } from '../ui/primitives'
import { StatusBadge, SyncNotice, ThemeToggle } from '../ui/status'
import { ManagerActivityProvider } from '../features/dashboard/ActivityLive'
import { navFor, type NavItem } from './nav'
import { GlobalSearch, openSearch, SearchButton } from './GlobalSearch'
import { ActivityButton, NotificationsBell } from './Notifications'
import { Sidebar, useSidebarMini } from './Sidebar'

const MAX_TABS = 5
const accountTab: NavItem = { to: '/account', label: 'حسابي', icon: UserRound }
const moreTab: NavItem = { to: '/more', label: 'المزيد', icon: Ellipsis }

export function AppShell() {
  const employee = useEmployee()
  const compact = isManagerRole(employee.role)
  const items = navFor(employee)
  // Phones: up to five tabs; the rest sit behind «المزيد».
  const tabs = items.length < MAX_TABS ? [...items, accountTab] : [...items.slice(0, MAX_TABS - 1), moreTab]
  const hasSettings = items.some((i) => i.to === '/settings')
  const [mini, toggleMini] = useSidebarMini()
  const { pathname } = useLocation()

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

  return (
    <ManagerActivityProvider enabled={compact}><div className={`shell${mini ? ' mini' : ''}`}>
      <a href="#main" className="skip">تخطَّ إلى المحتوى</a>
      <div className="scene" aria-hidden="true"><i className="b1" /><i className="b2" /><i className="b3" /><i className="grain" /></div>

      {/* Computers: the floating sidebar on the right. */}
      <Sidebar items={items} mini={mini} onToggle={toggleMini} />

      <div className="shell-main">
        <div className="topbar-row">
          <header className="topbar glass">
            {/* Phones keep the name on the left of the bar; computers have it in the sidebar. */}
            <Link to="/" className="app-brand" aria-label="الرئيسية">
              <Logo height={34} />
              <span className="app-brand-text">
                <b>مخيم 2</b>
                <small>أبناء فارس أبو زايد</small>
              </span>
            </Link>
            <button type="button" className="top-search" onClick={openSearch} aria-label="بحث (Ctrl+K)">
              <Search size={18} aria-hidden="true" />
              <span>ابحث: مهمة، مشترك، ختم، صفحة…</span>
              <kbd>Ctrl K</kbd>
            </button>
            <span className="grow" />
            <div className="topbar-end">
              <SearchButton className="phone-only" />
              {hasSettings && (
                <NavLink to="/settings" className="rbtn top-settings" aria-label="الإعدادات" title="الإعدادات">
                  <Settings size={19} aria-hidden="true" />
                </NavLink>
              )}
              <ThemeToggle />
              {compact && <ActivityButton />}
              {compact && <NotificationsBell />}
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
        </div>

        <GlobalSearch />
        <SyncNotice />
        <RejectedNotice />

        <PullToRefresh><main className="page stage glass" id="main">
          <div key={pathname} className="page-enter"><Outlet /></div>
        </main></PullToRefresh>
      </div>

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
