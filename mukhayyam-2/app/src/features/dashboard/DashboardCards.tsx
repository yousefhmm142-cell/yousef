import { AlertTriangle, Boxes, CheckCircle2, ClipboardList, FileBarChart, Radio, ScanLine, ChevronLeft } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link } from 'react-router'
import { useEmployee } from '../../auth/AuthProvider'
import { db } from '../../data/db'
import { todayISO } from '../../lib/dates'
import { gazaDate } from '../attendance/rules'
import { isOpen, isOverdue } from '../tasks/model'
import { usePresent } from '../../data/presence'
import { formatTime } from '../../lib/format'
import { useNow } from '../../lib/useNow'
import { roleLabel, type Role } from '../../types'
import { Avatar } from '../../ui/primitives'
import { useAttention, useFeed, type EventKind, type FeedEvent } from './activity'

const kindIcon: Record<EventKind, typeof Radio> = {
  report: FileBarChart,
  sheet: FileBarChart,
  task: ClipboardList,
  attendance: ScanLine,
  stock: Boxes,
}

/** «قبل 5 د»، «قبل ساعتين»، وإلا اليوم/أمس مع الوقت. */
export function ago(iso: string, now: Date): string {
  const min = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000))
  if (min < 1) return 'الآن'
  if (min < 60) return `قبل ${min} د`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `قبل ${hours} س`
  return `${formatTime(new Date(iso))} · قبل ${Math.floor(hours / 24)} يوم`
}

/** What needs the manager's decision or notice, first. */
export function AttentionCard() {
  const now = useNow(60_000)
  const items = useAttention(now)
  if (!items) return null
  if (!items.length)
    return (
      <section className="attention ok glass" aria-label="يحتاج انتباهك">
        <CheckCircle2 size={20} aria-hidden="true" />
        <b>كل شيء تمام</b>
        <span>لا شيء ينتظر اعتمادك ولا مهام متأخرة.</span>
      </section>
    )
  return (
    <section className="attention-list" aria-label="يحتاج انتباهك">
      {items.map((a) => (
        <Link key={a.key} to={a.to} className="attention glass" data-tone={a.tone}>
          <AlertTriangle size={20} aria-hidden="true" />
          <span className="attention-text">
            <b>{a.title}</b>
            {a.detail && <small>{a.detail}</small>}
          </span>
          <ChevronLeft size={18} aria-hidden="true" />
        </Link>
      ))}
    </section>
  )
}

/** Everyone who has the site open right now. */
export function PresenceCard() {
  const me = useEmployee()
  const present = usePresent()
  const now = useNow(60_000)
  return (
    <section className="card presence">
      <div className="card-h">
        <span className="ico-round brand"><Radio size={16} /></span>
        <h2>متصلون الآن</h2>
        <span className="meta num">{present.length}</span>
      </div>
      {present.length === 0 ? (
        <p className="card-empty">لا أحد يظهر الآن. يظهر الشخص هنا ما دام الموقع مفتوحاً عنده.</p>
      ) : (
        <ul className="team-list">
          {present.map((p) => (
            <li key={p.id}>
              <span className="live-dot" aria-hidden="true" />
              <Avatar name={p.name} size={34} />
              <span className="team-name">
                <b>{p.name}{p.id === me.id && ' (أنت)'}</b>
                <small>{p.title || roleLabel[p.role as Role] || ''}</small>
              </span>
              <span className="team-phone num">{ago(p.since, now)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function EventRow({ e, now }: { e: FeedEvent; now: Date }) {
  const Icon = kindIcon[e.kind]
  return (
    <li data-tone={e.tone}>
      <span className="feed-ico" aria-hidden="true"><Icon size={15} /></span>
      <span className="feed-text">
        <b>{e.who}</b> {e.text}
      </span>
      <time className="num" dateTime={e.at}>{ago(e.at, now)}</time>
    </li>
  )
}

/** The latest movements, newest first. */
export function ActivityCard() {
  const now = useNow(60_000)
  const feed = useFeed()
  const [all, setAll] = useState(false)
  return (
    <section className="card feed">
      <div className="card-h">
        <span className="ico-round brand"><ClipboardList size={16} /></span>
        <h2>آخر الحركات</h2>
      </div>
      {!feed ? (
        <div className="skeleton-list" aria-busy="true">{Array.from({ length: 4 }, (_, i) => <span key={i} />)}</div>
      ) : feed.length === 0 ? (
        <p className="card-empty">لا حركات في آخر 7 أيام.</p>
      ) : (
        <>
          <ul className="feed-list">
            {(all ? feed : feed.slice(0, 10)).map((e) => <EventRow key={e.id} e={e} now={now} />)}
          </ul>
          {feed.length > 10 && (
            <button type="button" className="link-btn feed-more" onClick={() => setAll((v) => !v)}>{all ? 'عرض أقل' : `عرض الكل (${feed.length})`}</button>
          )}
        </>
      )}
    </section>
  )
}

/** Four numbers that tell the day at a glance. */
export function KpiStrip() {
  const now = useNow(60_000)
  const present = usePresent()
  const data = useLiveQuery(async () => {
    const today = todayISO()
    const [people, punches, tasks, reports, sheets] = await Promise.all([
      db.employees.toArray(),
      db.punches.where('at').above(new Date(Date.now() - 36 * 3_600_000).toISOString()).toArray(),
      db.tasks.toArray(),
      db.siteReports.where('status').equals('submitted').count(),
      db.distributionSheets.where('status').equals('submitted').count(),
    ])
    const tracked = people.filter((e) => e.isActive && e.tracksAttendance)
    const inToday = new Set(punches.filter((p) => p.kind === 'in' && gazaDate(p.at) === today).map((p) => p.employeeId))
    return { total: tracked.length, here: tracked.filter((e) => inToday.has(e.id)).length, open: tasks.filter(isOpen), approvals: reports + sheets }
  }, [])
  if (!data) return null
  const late = data.open.filter((t) => isOverdue(t, now)).length
  const tiles = [
    { key: 'online', to: '', n: present.length, label: 'متصلون الآن', note: 'على الموقع حالياً', tone: 'ok' },
    { key: 'att', to: '/attendance', n: `${data.here}/${data.total}`, label: 'حضور اليوم', note: data.total ? `غاب ${data.total - data.here}` : 'لا أحد يسجّل بعد', tone: 'brand' },
    { key: 'tasks', to: '/tasks', n: data.open.length, label: 'مهام مفتوحة', note: late ? `${late} متأخرة` : 'لا تأخير', tone: late ? 'danger' : 'brand' },
    { key: 'appr', to: '/generation', n: data.approvals, label: 'بانتظار اعتمادك', note: data.approvals ? 'تقارير وكشوف مغلقة' : 'لا شيء ينتظر', tone: data.approvals ? 'warn' : 'ok' },
  ]
  return (
    <section className="dash-kpis" aria-label="أرقام اليوم">
      {tiles.map((t) => {
        const inner = (
          <>
            <b className="num dash-kpi-n">{t.n}</b>
            <span className="dash-kpi-l">{t.label}</span>
            <small>{t.note}</small>
          </>
        )
        return t.to ? (
          <Link key={t.key} to={t.to} className="dash-kpi glass" data-tone={t.tone}>{inner}</Link>
        ) : (
          <div key={t.key} className="dash-kpi glass" data-tone={t.tone}>{inner}</div>
        )
      })}
    </section>
  )
}
