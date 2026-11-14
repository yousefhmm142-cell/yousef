import { AlertTriangle, Bell, Info, Radio, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { useAttention, useFeed, useActivityConnection, type EventKind, type FeedEvent } from '../features/dashboard/activity'
import { ago } from '../features/dashboard/DashboardCards'
import { useNow } from '../lib/useNow'

// Two buttons in the top bar (managers):
// · «آخر الحركات»: every latest movement, with search and a kind filter (it left the home page).
// · the bell: what needs attention now and the movements not read yet. «Read» is remembered on this
//   device only (a convenience, nothing on the server).

const SEEN_KEY = 'm2-notif-seen'
const readSeen = () => {
  try {
    return localStorage.getItem(SEEN_KEY) ?? ''
  } catch {
    return ''
  }
}
const SEEN_EVENT = 'm2-notif-seen'

function useSeen(): [string, () => void] {
  const [seen, setSeen] = useState(readSeen)
  useEffect(() => {
    const on = () => setSeen(readSeen())
    window.addEventListener(SEEN_EVENT, on)
    return () => window.removeEventListener(SEEN_EVENT, on)
  }, [])
  return [seen, () => {
    const t = new Date().toISOString()
    try {
      localStorage.setItem(SEEN_KEY, t)
    } catch {
      // Only for this visit.
    }
    setSeen(t)
    window.dispatchEvent(new Event(SEEN_EVENT))
  }]
}

/** A button in the top bar with its panel, closed by a click outside or Escape. */
function TopPanel({ button, label, children }: { button: (open: boolean, toggle: () => void) => ReactNode; label: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
      else if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', close)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close) }
  }, [open])
  return (
    <div className="bell-wrap" ref={box}>
      {button(open, () => setOpen((o) => !o))}
      {open && <div className="notif" role="dialog" aria-label={label}>{children(() => setOpen(false))}</div>}
    </div>
  )
}

function FeedRows({ rows, seen, now, empty, go }: { rows: FeedEvent[]; seen: string; now: Date; empty: string; go: (to?: string) => void }) {
  return (
    <ul className="notif-list">
      {rows.length === 0 ? (
        <li className="notif-empty">{empty}</li>
      ) : (
        rows.map((e) => (
          <li key={e.id}>
            <button type="button" className={`notif-i${e.at > seen ? ' unread' : ''}`} data-tone={e.tone} onClick={() => go(e.route)}>
              <span className="ni" aria-hidden="true">{e.who.trim().slice(0, 1)}</span>
              <span className="nt"><b>{e.who}</b><small>{e.text}</small><em className="num">{ago(e.at, now)}</em></span>
            </button>
          </li>
        ))
      )}
    </ul>
  )
}

/** «آخر الحركات»: the word and its icon in the top bar, separate from the bell. */
export function ActivityButton() {
  const now = useNow(60_000)
  const feed = useFeed()
  const connected = useActivityConnection()
  const navigate = useNavigate()
  const [kind, setKind] = useState<EventKind | ''>('')
  const [search, setSearch] = useState('')
  const all = useMemo(() => feed ?? [], [feed])
  const q = search.trim()
  const shown = all.filter((e) => (!kind || e.kind === kind) && (!q || `${e.who} ${e.text} ${e.reference ?? ''}`.includes(q)))
  return (
    <TopPanel
      label="آخر الحركات"
      button={(open, toggle) => (
        <button type="button" className="top-pill" aria-expanded={open} onClick={toggle}>
          <Radio size={17} aria-hidden="true" />
          <span>آخر الحركات</span>
          <i className="top-live" data-live={connected || undefined} aria-hidden="true" />
        </button>
      )}
    >
      {(close) => {
        const go = (to?: string) => { close(); if (to) navigate(to) }
        return (
          <>
            <div className="notif-h">
              <b>آخر الحركات</b>
              <span className="grow" />
              <small className="notif-live" data-live={connected || undefined}><i />{connected ? 'متابعة مباشرة' : 'آخر نسخة محفوظة'}</small>
            </div>
            <div className="notif-tools">
              <label className="notif-search">
                <Search size={15} aria-hidden="true" />
                <input aria-label="بحث بالحركات" placeholder="ابحث عن شخص أو مرجع…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </label>
              <select className="select" aria-label="نوع الحركة" value={kind} onChange={(e) => setKind(e.target.value as EventKind | '')}>
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
            {/* «not read yet» is the bell's job; here every row looks the same */}
            <FeedRows rows={shown} seen="~" now={now} go={go} empty={q || kind ? 'ما في حركات بتطابق البحث.' : 'ما في حركات بعد.'} />
            <p className="notif-foot num">{shown.length} حركة في السجل الأخير</p>
          </>
        )
      }}
    </TopPanel>
  )
}

/** The bell: what needs attention now, and the movements not read yet. */
export function NotificationsBell() {
  const now = useNow(60_000)
  const attention = useAttention(now) ?? []
  const feed = useFeed()
  const navigate = useNavigate()
  const [seen, markAll] = useSeen()
  const unread = useMemo(() => (feed ?? []).filter((e) => e.at > seen), [feed, seen])
  const count = attention.length + unread.length
  return (
    <TopPanel
      label="الإشعارات"
      button={(open, toggle) => (
        <button type="button" className="rbtn bell" aria-label={count ? `الإشعارات: ${count} جديدة` : 'الإشعارات'} title="الإشعارات" aria-expanded={open} onClick={toggle}>
          <Bell size={19} aria-hidden="true" />
          {count > 0 && <span className="bell-n num">{count > 9 ? '9+' : count}</span>}
        </button>
      )}
    >
      {(close) => {
        const go = (to?: string) => { close(); if (to) navigate(to) }
        return (
          <>
            <div className="notif-h">
              <b>الإشعارات</b>
              {count > 0 && <span className="sb-cnt red num">{count}</span>}
              <span className="grow" />
              {unread.length > 0 && <button type="button" className="link-btn" onClick={markAll}>تعليم الكل كمقروء</button>}
            </div>
            {attention.length > 0 && (
              <>
                <small className="notif-sec">بدها انتباهك</small>
                <ul className="notif-list">
                  {attention.map((a) => {
                    const Icon = a.tone === 'info' ? Info : AlertTriangle
                    return (
                      <li key={a.key}>
                        <button type="button" className="notif-i" data-tone={a.tone} onClick={() => go(a.to)}>
                          <span className="ni"><Icon size={16} aria-hidden="true" /></span>
                          <span className="nt"><b>{a.title}</b>{a.detail && <small>{a.detail}</small>}</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
            <small className="notif-sec">جديد ما قريته {unread.length > 0 && <span className="num">({unread.length})</span>}</small>
            <FeedRows rows={unread} seen={seen} now={now} go={go} empty="كل شي مقروء." />
          </>
        )
      }}
    </TopPanel>
  )
}
