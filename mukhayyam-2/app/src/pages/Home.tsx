import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, Clock, CloudUpload, Database, Wifi, WifiOff } from 'lucide-react'
import { Link } from 'react-router'
import { useEmployee } from '../auth/AuthProvider'
import { modules, type ModuleKey } from '../app/modules'
import { config, isDemo } from '../config'
import { db } from '../data/db'
import { useTeam } from '../data/team'
import { clockOffsetMs } from '../lib/clock'
import { firstName, formatLongDate, formatTime, formatWeekday, greeting } from '../lib/format'
import { useDocumentTitle } from '../lib/useDocumentTitle'
import { useNow } from '../lib/useNow'
import { useOnline } from '../lib/useOnline'
import { formatPhone } from '../lib/phone'
import { roleLabel } from '../types'
import { Avatar, Pill } from '../ui/primitives'
import { DistributionEntryPage } from '../features/distribution/EntryPage'
import { useLatestSentSheet } from '../features/distribution/repo'
import { EntryPage } from '../features/generation/EntryPage'
import { useLatestSentReport } from '../features/generation/repo'
import { statusInfo, type SheetStatus } from '../features/sheets/workflow'
import { dayName, type ISODate } from '../lib/dates'
import { ModuleSoon } from './ModuleSoon'

/** Each person opens the app straight on their own job. */
export function Home() {
  const employee = useEmployee()
  switch (employee.role) {
    case 'admin':
    case 'manager':
      return <ManagerHome />
    case 'generation_operator':
      return <EntryPage />
    case 'distribution_supervisor':
      return <DistributionEntryPage />
    case 'technician':
      return <ModuleSoon module="my-tasks" />
    case 'staff':
      return <ModuleSoon module="my-attendance" />
  }
}

const managerModules: Array<{ key: ModuleKey; to: string }> = [
  { key: 'generation', to: '/generation' },
  { key: 'distribution', to: '/distribution' },
  { key: 'tasks', to: '/tasks' },
  { key: 'attendance-board', to: '/attendance' },
]

function ManagerHome() {
  useDocumentTitle('الرئيسية')
  const employee = useEmployee()
  const now = useNow()

  return (
    <div className="home">
      <header className="home-head">
        <div>
          <p className="eyebrow">
            {formatWeekday(now)} · <span className="num">{formatLongDate(now)}</span>
          </p>
          <h1>
            {greeting(now)}، {firstName(employee.fullName)}
          </h1>
        </div>
        <div className="clock glass" aria-label="الوقت الآن بتوقيت الخادم">
          <Clock size={18} aria-hidden="true" />
          <b className="num">{formatTime(now)}</b>
        </div>
      </header>

      <section className="mod-grid" aria-label="الوحدات">
        {managerModules.map(({ key, to }) => {
          const m = modules[key]
          const Icon = m.icon
          return (
            <Link key={key} to={to} className="mod-card glass">
              <span className="mod-icon" aria-hidden="true">
                <Icon size={22} />
              </span>
              <b>{m.title}</b>
              <span className="mod-summary">{m.summary}</span>
              <span className="mod-foot">
                {key === 'generation' ? <GenerationStatus /> : key === 'distribution' ? <DistributionStatus /> : <Pill tone="brand" dot={false}>الخطوة {m.step}</Pill>}
                <ArrowLeft size={18} aria-hidden="true" />
              </span>
            </Link>
          )
        })}
      </section>

      <div className="home-row">
        <TeamCard />
        <SystemCard />
      </div>
    </div>
  )
}

/** Live state of the newest sent form, so the manager sees at a glance if one waits for approval. */
function LatestStatus({ latest, noun }: { latest: { date: ISODate; status: SheetStatus } | null | undefined; noun: string }) {
  if (!latest) return <Pill dot={false}>لا شيء بعد</Pill>
  const day = dayName(latest.date)
  if (latest.status === 'submitted') return <Pill tone="warn">{noun} {day} بانتظار اعتمادك</Pill>
  return <Pill tone={statusInfo[latest.status].tone}>{noun} {day}: {statusInfo[latest.status].label}</Pill>
}

function GenerationStatus() {
  const r = useLatestSentReport()
  return <LatestStatus noun="تقرير" latest={r && { date: r.reportDate, status: r.status }} />
}

function DistributionStatus() {
  const s = useLatestSentSheet()
  return <LatestStatus noun="كشف" latest={s && { date: s.sheetDate, status: s.status }} />
}

function TeamCard() {
  const team = useTeam()
  return (
    <section className="card team">
      <div className="card-h">
        <h2>الفريق</h2>
        {team && <span className="meta num">{team.length} أشخاص</span>}
      </div>
      {!team ? (
        <div className="skeleton-list" aria-busy="true">
          {Array.from({ length: 4 }, (_, i) => <span key={i} />)}
        </div>
      ) : team.length === 0 ? (
        <p className="card-empty">لا يوجد أحد بعد. يضيف مسؤول النظام الفريق من الإعدادات.</p>
      ) : (
        <ul className="team-list">
          {team.map((e) => (
            <li key={e.id}>
              <Avatar name={e.fullName} size={36} />
              <span className="team-name">
                <b>{e.fullName}</b>
                <small>{roleLabel[e.role]}</small>
              </span>
              {e.phone && <span className="team-phone num ltr">{formatPhone(e.phone)}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function SystemCard() {
  const online = useOnline()
  const pending = useLiveQuery(() => db.outbox.count(), [], 0)
  const offsetMin = Math.round(clockOffsetMs() / 60_000)

  return (
    <section className="card system">
      <div className="card-h">
        <h2>حالة النظام</h2>
        <span className="meta num ltr">v{config.version}</span>
      </div>
      <ul className="sys-list">
        <li>
          <span className="ico-round">{online ? <Wifi size={16} /> : <WifiOff size={16} />}</span>
          <span>الاتصال</span>
          {online ? <Pill tone="ok">متصل</Pill> : <Pill tone="warn">بدون اتصال</Pill>}
        </li>
        <li>
          <span className="ico-round"><Database size={16} /></span>
          <span>البيانات</span>
          {isDemo ? <Pill tone="brand">وضع التجربة: على هذا الجهاز</Pill> : <Pill tone="ok">قاعدة البيانات</Pill>}
        </li>
        <li>
          <span className="ico-round"><CloudUpload size={16} /></span>
          <span>بانتظار الإرسال</span>
          <Pill tone={pending ? 'warn' : 'ok'}>{pending ? `${pending}` : 'لا شيء'}</Pill>
        </li>
        <li>
          <span className="ico-round"><Clock size={16} /></span>
          <span>ساعة الجهاز</span>
          {Math.abs(offsetMin) < 1 ? (
            <Pill tone="ok">مضبوطة</Pill>
          ) : (
            <Pill tone="warn">فرق {Math.abs(offsetMin)} دقيقة، والنظام يصحّحه</Pill>
          )}
        </li>
      </ul>
    </section>
  )
}
