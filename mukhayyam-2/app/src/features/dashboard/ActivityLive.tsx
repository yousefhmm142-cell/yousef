import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Radio, X } from 'lucide-react'
import { useEmployee } from '../../auth/AuthProvider'
import { getSupabase } from '../../data/supabase'
import { db } from '../../data/db'
import { ActivityContext, useCachedFeed, type FeedEvent } from './activity'
import { isDemo } from '../../config'

export interface ActivityRow {
  id: number
  at: string
  kind: FeedEvent['kind']
  who: string
  text: string
  tone: FeedEvent['tone']
  route: string
}
export const activityEvent = (r: ActivityRow): FeedEvent => ({ ...r, id: `audit-${r.id}`, reference: `حركة #${r.id}` })
/** One notification for a burst; establishing the initial cursor never announces old records. */
export function newActivities(rows: ActivityRow[], cursor: number | null): ActivityRow[] {
  return cursor === null ? [] : rows.filter((r) => r.id > cursor).sort((a, b) => b.id - a.id)
}
export function ManagerActivityProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return enabled ? <LiveActivity>{children}</LiveActivity> : children
}
function LiveActivity({ children }: { children: ReactNode }) {
  const me = useEmployee()
  const fallback = useCachedFeed()
  const [feed, setFeed] = useState<FeedEvent[]>()
  const [connected, setConnected] = useState(false)
  const [notice, setNotice] = useState<{ event: FeedEvent; extra: number } | null>(null)
  useEffect(() => {
    const sb = getSupabase()
    if (!sb || isDemo) return
    let live = true,
      busy = false,
      cursor: number | null = null
    let hide: number | undefined, debounce: number | undefined
    const key = `manager-activity:${me.id}`
    void db.meta.get(key).then((c) => {
      if (live && c && cursor === null) setFeed(c.value as FeedEvent[])
    })
    const load = async () => {
      if (!live || busy || document.visibilityState !== 'visible') return
      if (!navigator.onLine) {
        setConnected(false)
        return
      }
      busy = true
      try {
        const { data, error } = await sb.rpc('recent_activity', { p_limit: 80 })
        if (!live) return
        if (error) {
          setConnected(false)
          return
        }
        const rows = (data ?? []) as ActivityRow[]
        const fresh = newActivities(rows, cursor)
        cursor = Math.max(cursor ?? 0, ...rows.map((r) => r.id))
        const events = rows.map(activityEvent)
        setFeed(events)
        setConnected(true)
        void db.meta.put({ key, value: events })
        if (fresh.length) {
          setNotice({ event: activityEvent(fresh[0]!), extra: fresh.length - 1 })
          window.clearTimeout(hide)
          hide = window.setTimeout(() => setNotice(null), 6500)
        }
      } catch {
        if (live) setConnected(false)
      } finally {
        busy = false
      }
    }
    const changed = () => {
      window.clearTimeout(debounce)
      debounce = window.setTimeout(() => void load(), 450)
    }
    const offline = () => setConnected(false)
    void load()
    const interval = window.setInterval(() => void load(), 15_000)
    // RLS allows only managers to subscribe. Polling also covers reconnects and missed events.
    const channel = sb
      .channel(`manager-activity-${me.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'audit_log' }, changed)
      .subscribe()
    window.addEventListener('online', changed)
    window.addEventListener('offline', offline)
    document.addEventListener('visibilitychange', changed)
    return () => {
      live = false
      window.clearInterval(interval)
      window.clearTimeout(hide)
      window.clearTimeout(debounce)
      void sb.removeChannel(channel)
      window.removeEventListener('online', changed)
      window.removeEventListener('offline', offline)
      document.removeEventListener('visibilitychange', changed)
    }
  }, [me.id])
  return (
    <ActivityContext.Provider value={{ feed: feed ?? fallback, connected }}>
      {children}
      <div className="activity-notices" aria-live="polite" aria-atomic="true">
        {notice && (
          <aside key={notice.event.id} className="activity-notice">
            <span className="ico-round brand">
              <Radio size={19} />
            </span>
            <Link to={notice.event.route ?? '/'} onClick={() => setNotice(null)}>
              <small>حركة جديدة · {notice.event.reference}</small>
              <b>{notice.event.who}</b>
              <span>{notice.event.text}</span>
              {notice.extra > 0 && <small>و{notice.extra} حركات أخرى في آخر الحركات</small>}
            </Link>
            <button className="icon-btn" aria-label="إغلاق الإشعار" onClick={() => setNotice(null)}>
              <X size={16} />
            </button>
          </aside>
        )}
      </div>
    </ActivityContext.Provider>
  )
}
