import { AlertTriangle, Bell, Info, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useEmployee } from '../auth/AuthProvider'
import { useAttention, useFeed, type EventKind } from '../features/dashboard/activity'
import { ago } from '../features/dashboard/DashboardCards'
import { useNow } from '../lib/useNow'

// The bell in the top bar (managers): what needs attention now, then the latest movements. «Read» is
// remembered on this device only (a convenience, nothing on the server).

const SEEN_KEY = 'm2-notif-seen'
const readSeen = () => {
  try {
    return localStorage.getItem(SEEN_KEY) ?? ''
  } catch {
    return ''
  }
}

export function NotificationsBell() {
  const me = useEmployee()
  const now = useNow(60_000)
  const attention = useAttention(now) ?? []
  const feed = useFeed()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [seen, setSeen] = useState(readSeen)
  const [kind, setKind] = useState<EventKind | ''>('')
  const [search, setSearch] = useState('')
  const box = useRef<HTMLDivElement>(null)

  // All the latest movements live here now (they left the home page).
  const recent = useMemo(() => feed ?? [], [feed])
  const unread = recent.filter((e) => e.at > seen)
  const count = attention.length + unread.length
  const q = search.trim()
  const shown = (unreadOnly ? unread : recent).filter((e) => (!kind || e.kind === kind) && (!q || `${e.who} ${e.text} ${e.reference ?? ''}`.includes(q)))

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

  function markAll() {
    const t = new Date().toISOString()
    try {
      localStorage.setItem(SEEN_KEY, t)
    } catch {
      // Only for this visit.
    }
    setSeen(t)
  }
  const go = (to?: string) => { setOpen(false); if (to) navigate(to) }

  return (
    <div className="bell-wrap" ref={box}>
      <button type="button" className="rbtn bell" aria-label={count ? `الإشعارات: ${count} جديدة` : 'الإشعارات'} title="الإشعارات" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Bell size={19} aria-hidden="true" />
        {count > 0 && <span className="bell-n num">{count > 9 ? '9+' : count}</span>}
      </button>
      {open && (
        <div className="notif" role="dialog" aria-label="الإشعارات">
          <div className="notif-h">
            <b>الإشعارات</b>
            {count > 0 && <span className="sb-cnt red num">{count}</span>}
            <span className="grow" />
            {unread.length > 0 && <button type="button" className="link-btn" onClick={markAll}>تعليم الكل كمقروء</button>}
          </div>
          {attention.length > 0 && (
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
          )}
          <div className="notif-tabs" role="group" aria-label="أي الإشعارات">
            <button type="button" className={unreadOnly ? '' : 'on'} onClick={() => setUnreadOnly(false)}>آخر الحركات</button>
            <button type="button" className={unreadOnly ? 'on' : ''} onClick={() => setUnreadOnly(true)}>غير مقروءة {unread.length > 0 && <span className="num">({unread.length})</span>}</button>
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
          <ul className="notif-list">
            {shown.length === 0 ? (
              <li className="notif-empty">{q || kind ? 'ما في حركات بتطابق البحث.' : unreadOnly ? 'كل شي مقروء.' : 'ما في حركات بعد.'}</li>
            ) : (
              shown.map((e) => (
                <li key={e.id}>
                  <button type="button" className={`notif-i${e.at > seen ? ' unread' : ''}`} data-tone={e.tone} onClick={() => go(e.route)}>
                    <span className="ni" aria-hidden="true">{e.who.trim().slice(0, 1)}</span>
                    <span className="nt"><b>{e.who}</b><small>{e.text}</small><em className="num">{ago(e.at, now)}</em></span>
                  </button>
                </li>
              ))
            )}
          </ul>
          {me && <p className="notif-foot num">{shown.length} حركة في السجل الأخير</p>}
        </div>
      )}
    </div>
  )
}
