import { Ellipsis, UserRound } from 'lucide-react'
import { Link, NavLink, Outlet } from 'react-router'
import { useEmployee } from '../auth/AuthProvider'
import { roleLabel } from '../types'
import { Avatar, Logo } from '../ui/primitives'
import { SyncStatus, ThemeToggle } from '../ui/status'
import { navFor, type NavItem } from './nav'

const MAX_TABS = 5
const accountTab: NavItem = { to: '/account', label: 'حسابي', icon: UserRound }
const moreTab: NavItem = { to: '/more', label: 'المزيد', icon: Ellipsis }

export function AppShell() {
  const employee = useEmployee()
  const items = navFor(employee.role)
  // Phones: up to five tabs; the rest sit behind «المزيد».
  const tabs = items.length < MAX_TABS ? [...items, accountTab] : [...items.slice(0, MAX_TABS - 1), moreTab]

  return (
    <div className="shell">
      <a href="#main" className="skip">تخطَّ إلى المحتوى</a>
      <header className="topbar glass">
        <Link to="/" className="app-brand" aria-label="الرئيسية">
          <Logo height={38} />
          <span className="app-brand-text">
            <b>مخيم 2</b>
            <small>أبناء فارس أبو زايد</small>
          </span>
        </Link>

        {items.length > 1 && (
          <nav className="topnav" aria-label="الأقسام">
            {items.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} end={to === '/'} className="topnav-link">
                <Icon size={17} aria-hidden="true" />
                <span>{label}</span>
              </NavLink>
            ))}
          </nav>
        )}

        <div className="topbar-end">
          <SyncStatus />
          <ThemeToggle />
          <NavLink to="/account" className="me" aria-label={`حسابي: ${employee.fullName}`}>
            <Avatar name={employee.fullName} />
            <span className="me-text">
              <b>{employee.fullName}</b>
              <small>{roleLabel[employee.role]}</small>
            </span>
          </NavLink>
        </div>
      </header>

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
