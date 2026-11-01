import { Ellipsis, Settings, UserRound } from 'lucide-react'
import { Link, NavLink, Outlet } from 'react-router'
import { useEmployee } from '../auth/AuthProvider'
import { titleOf } from '../types'
import { Avatar, Logo } from '../ui/primitives'
import { StatusBadge, ThemeToggle } from '../ui/status'
import { navFor, type NavItem } from './nav'

const MAX_TABS = 5
const accountTab: NavItem = { to: '/account', label: 'حسابي', icon: UserRound }
/** Reports is a symbol only; its name shows while the page is open. Settings is the big gear at the end of the bar. */
const compactLinks = new Set(['/reports'])
const moreTab: NavItem = { to: '/more', label: 'المزيد', icon: Ellipsis }

export function AppShell() {
  const employee = useEmployee()
  const items = navFor(employee)
  // Phones: up to five tabs; the rest sit behind «المزيد».
  const tabs = items.length < MAX_TABS ? [...items, accountTab] : [...items.slice(0, MAX_TABS - 1), moreTab]

  const hasSettings = items.some((i) => i.to === '/settings')
  const barItems = items.filter((i) => i.to !== '/settings')

  return (
    <div className="shell">
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
          <nav className="topnav" aria-label="الأقسام">
            {barItems.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} end={to === "/"} className={compactLinks.has(to) ? 'topnav-link compact' : 'topnav-link'} title={compactLinks.has(to) ? label : undefined}>
                <Icon size={17} aria-hidden="true" />
                <span>{label}</span>
              </NavLink>
            ))}
          </nav>
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

      <main className="page" id="main">
        <Outlet />
      </main>

      {tabs.length > 1 && (
        <nav className="tabbar glass" aria-label="الأقسام">
          {tabs.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === '/'} className="tab">
              <span className="tab-icon">
                <Icon size={21} aria-hidden="true" />
              </span>
              <span className="tab-label">{label}</span>
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  )
}
