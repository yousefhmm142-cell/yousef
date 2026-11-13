import { CountUp } from '../../ui/fx/CountUp'
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ClipboardList,
  FileBarChart,
  Radio,
  ScanLine,
  ChevronLeft,
  Stamp,
  BookOpen,
  Settings,
  Search,
  Info,
} from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useEmployee } from '../../auth/AuthProvider'
import { db } from '../../data/db'
import { addDays, todayISO } from '../../lib/dates'
import { gazaDate } from '../attendance/rules'
import { isOpen, isOverdue } from '../tasks/model'
import { usePresent } from '../../data/presence'
import { formatTime } from '../../lib/format'
import { useNow } from '../../lib/useNow'
import { roleLabel, type Role } from '../../types'
import { Avatar, Button } from '../../ui/primitives'
import { Dialog } from '../../ui/Dialog'
import type { Attention } from './attention'
import { useAttention, useFeed, useActivityConnection, type EventKind, type FeedEvent } from './activity'

const kindIcon: Record<EventKind, typeof Radio> = {
  report: FileBarChart,
  sheet: FileBarChart,
  task: ClipboardList,
  attendance: ScanLine,
  stock: Boxes,
  seal: Stamp,
  reading: BookOpen,
  settings: Settings,
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

/** What needs the manager's decision or notice, first. Each opens in a window here (not a new page). */
export function AttentionCard() {
  const now = useNow(60_000)
  const items = useAttention(now)
  const [open, setOpen] = useState<Attention | 'all' | null>(null)
  if (!items) return null
  if (!items.length)
    return (
      <section className="attention ok glass" aria-label="بدها انتباهك">
        <CheckCircle2 size={20} aria-hidden="true" />
        <b>كل شي تمام</b>
        <span>ولا إشي بستنى اعتمادك، ولا مهام متأخرة، ولا تنبيهات.</span>
      </section>
    )
  const shown = items.slice(0, 5)
  return (
    <section className="attention-wrap" aria-label="بدها انتباهك">
      <div className="attention-head">
        <h2>بدها انتباهك</h2>
        <span className="num">{items.length}</span>
        {items.length > shown.length && <button type="button" className="link-btn" onClick={() => setOpen('all')}>كل التنبيهات ({items.length})</button>}
      </div>
      <div className="attention-list">
        {shown.map((a) => <AttentionButton key={a.key} a={a} onOpen={() => setOpen(a)} />)}
      </div>
      {open && <AttentionDialog item={open} all={items} onPick={setOpen} onClose={() => setOpen(null)} />}
    </section>
  )
}

const toneIcon = { danger: AlertTriangle, warn: AlertTriangle, info: Info } as const

function AttentionButton({ a, onOpen }: { a: Attention; onOpen(): void }) {
  const Icon = toneIcon[a.tone]
  return (
    <button type="button" className="attention glass" data-tone={a.tone} onClick={onOpen}>
      <Icon size={20} aria-hidden="true" />
      <span className="attention-text">
        <b>{a.title}</b>
        {a.detail && <small>{a.detail}</small>}
      </span>
      <ChevronLeft size={18} aria-hidden="true" />
    </button>
  )
}

/** One alert in detail (what exactly, and a way to its page), or the whole list. */
function AttentionDialog({ item, all, onPick, onClose }: { item: Attention | 'all'; all: Attention[]; onPick(a: Attention | 'all'): void; onClose(): void }) {
  const navigate = useNavigate()
  const go = (to: string) => { onClose(); navigate(to) }
  if (item === 'all')
    return (
      <Dialog open onClose={onClose} title="كل التنبيهات" subtitle={`${all.length} بدهم انتباهك`} icon={<AlertTriangle size={18} />} className="attention-dialog">
        <div className="attention-list one">{all.map((a) => <AttentionButton key={a.key} a={a} onOpen={() => onPick(a)} />)}</div>
      </Dialog>
    )
  const Icon = toneIcon[item.tone]
  return (
    <Dialog
      open
      onClose={onClose}
      title={item.title}
      subtitle={item.detail}
      icon={<Icon size={18} />}
      className="attention-dialog"
      footer={
        <>
          {all.length > 1 && <Button variant="ghost" onClick={() => onPick('all')}>كل التنبيهات</Button>}
          <Button variant="primary" icon={<ChevronLeft size={17} />} onClick={() => go(item.to)}>افتح {item.toLabel}</Button>
        </>
      }
    >
      <ul className="attention-lines" data-tone={item.tone}>
        {item.lines.map((l, i) => (
          <li key={i}>
            {l.to ? <button type="button" className="link-row" onClick={() => go(l.to!)}><span>{l.text}</span><ChevronLeft size={16} aria-hidden="true" /></button> : <span>{l.text}</span>}
          </li>
        ))}
      </ul>
    </Dialog>
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
      <span className="feed-ico" aria-hidden="true">
        <Icon size={15} />
      </span>
      <span className="feed-text">
        <b>{e.who}</b>
        <span>{e.text}</span>
        {e.reference && <small className="feed-ref">{e.reference}</small>}
      </span>
      {e.route && (
        <Link to={e.route} className="feed-open" aria-label={`فتح ${e.text}`}>
          <ChevronLeft size={16} />
        </Link>
      )}
      <time className="num" dateTime={e.at}>
        {ago(e.at, now)}
      </time>
    </li>
  )
}

/** The latest movements, newest first. */
export function ActivityCard() {
  const now = useNow(60_000)
  const feed = useFeed()
  const connected = useActivityConnection()
  const [all, setAll] = useState(false)
  const [kind, setKind] = useState<EventKind | ''>('')
  const [search, setSearch] = useState('')
  const shown = feed?.filter(
    (e) => (!kind || e.kind === kind) && `${e.who} ${e.text} ${e.reference ?? ''}`.includes(search.trim()),
  )
  return (
    <section className="card feed feed-live">
      <div className="feed-heading">
        <span className="ico-round brand">
          <Radio size={21} />
        </span>
        <div>
          <small>نبض المكتب</small>
          <h2>آخر الحركات</h2>
        </div>
        <span className="feed-connection" data-live={connected || undefined}>
          <i />
          {connected ? 'متابعة مباشرة' : 'آخر نسخة محفوظة'}
        </span>
      </div>
      <div className="feed-tools">
        <label className="feed-search">
          <Search size={16} />
          <input
            aria-label="بحث بالحركات"
            placeholder="ابحث عن شخص أو مرجع…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <select
          className="select"
          aria-label="نوع الحركة"
          value={kind}
          onChange={(e) => setKind(e.target.value as EventKind | '')}
        >
          <option value="">كل الحركات</option>
          <option value="seal">الأختام</option>
          <option value="task">المهام</option>
          <option value="attendance">الحضور</option>
          <option value="report">التوليد</option>
          <option value="sheet">التوزيع</option>
          <option value="reading">القراءات</option>
          <option value="settings">الإعدادات</option>
        </select>
      </div>
      {!shown ? (
        <div className="skeleton-list" aria-busy="true">
          {Array.from({ length: 4 }, (_, i) => (
            <span key={i} />
          ))}
        </div>
      ) : !shown.length ? (
        <p className="card-empty">لا حركات تطابق البحث.</p>
      ) : (
        <>
          <ul className="feed-list">
            {(all ? shown : shown.slice(0, 8)).map((e) => (
              <EventRow key={e.id} e={e} now={now} />
            ))}
          </ul>
          <div className="feed-bottom">
            <span className="muted num">{shown.length} حركة في السجل الأخير</span>
            {shown.length > 8 && (
              <button type="button" className="link-btn" onClick={() => setAll((v) => !v)}>
                {all ? 'عرض أقل' : 'عرض المزيد'}
              </button>
            )}
          </div>
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
    // tasks finished on each of the last 7 days, oldest first (the little line in the tasks box)
    const done = Array.from({ length: 7 }, (_, i) => {
      const day = addDays(today, i - 6)
      return tasks.filter((t) => t.completedAt && gazaDate(t.completedAt) === day).length
    })
    return { total: tracked.length, here: tracked.filter((e) => inToday.has(e.id)).length, open: tasks.filter(isOpen), approvals: reports + sheets, done }
  }, [])
  if (!data) return null
  const late = data.open.filter((t) => isOverdue(t, now)).length
  const tiles = [
    { key: 'online', to: '', n: present.length, label: 'متصلون الآن', note: 'على الموقع حالياً', tone: 'ok' },
    { key: 'att', to: '/attendance', n: `${data.here}/${data.total}`, label: 'حضور اليوم', note: data.total ? `غاب ${data.total - data.here}` : 'لا أحد يسجّل بعد', tone: !data.total ? 'info' : data.here === data.total ? 'ok' : 'warn' },
    { key: 'tasks', to: '/tasks', n: data.open.length, label: 'مهام مفتوحة', note: late ? `${late} متأخرة` : 'لا تأخير', tone: late ? 'danger' : 'ok' },
    { key: 'appr', to: '/generation', n: data.approvals, label: 'بانتظار اعتمادك', note: data.approvals ? 'تقارير وكشوف مغلقة' : 'لا شيء ينتظر', tone: data.approvals ? 'warn' : 'ok' },
  ]
  return (
    <section className="dash-kpis" aria-label="أرقام اليوم">
      {tiles.map((t) => {
        const inner = (
          <>
            <b className="num dash-kpi-n">{typeof t.n === 'number' ? <CountUp value={t.n} /> : <><CountUp value={data.here} />/{data.total}</>}</b>
            <span className="dash-kpi-l">{t.label}</span>
            <small>{t.note}</small>
            <KpiPic kind={t.key} data={data} online={present.length} />
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

/** The small picture in each box: dots for who is online, a ring for attendance, a line for finished tasks, pills for what waits. */
function KpiPic({ kind, data, online }: { kind: string; data: { total: number; here: number; approvals: number; done: number[] }; online: number }) {
  if (kind === 'att') {
    const pct = data.total ? data.here / data.total : 0
    const C = 2 * Math.PI * 22
    return (
      <svg className="kpi-pic" viewBox="0 0 60 60" aria-hidden="true">
        <circle cx="30" cy="30" r="22" className="kpi-ring-bg" />
        <circle cx="30" cy="30" r="22" className="kpi-ring" strokeDasharray={C} strokeDashoffset={C * (1 - pct)} transform="rotate(-90 30 30)" />
        <text x="30" y="34" textAnchor="middle" className="kpi-ring-t num">{Math.round(pct * 100)}%</text>
      </svg>
    )
  }
  if (kind === 'tasks') {
    const max = Math.max(1, ...data.done)
    const pts = data.done.map((v, i) => `${(80 - (i * 80) / 6).toFixed(1)},${(50 - (v / max) * 40).toFixed(1)}`).join(' ')
    return (
      <svg className="kpi-pic" viewBox="0 0 84 56" aria-hidden="true">
        <polyline points={pts} className="kpi-line" />
        <circle cx="0" cy={50 - (data.done[6]! / max) * 40} r="3.5" className="kpi-line-dot" />
      </svg>
    )
  }
  if (kind === 'appr') {
    const n = Math.min(4, data.approvals)
    return (
      <svg className="kpi-pic" viewBox="0 0 84 56" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => <rect key={i} x={66 - i * 20} y={8} width={14} height={40} rx={7} className={i < n ? 'kpi-pill on' : 'kpi-pill'} />)}
      </svg>
    )
  }
  const n = Math.min(5, online)
  return (
    <svg className="kpi-pic" viewBox="0 0 84 56" aria-hidden="true">
      {Array.from({ length: 5 }, (_, i) => <circle key={i} cx={74 - i * 16} cy={28} r={6.5} className={i < n ? 'kpi-dot on' : 'kpi-dot'} />)}
    </svg>
  )
}
