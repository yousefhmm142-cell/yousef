import { Bell } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { useEmployee } from '../auth/AuthProvider'
import { isDemo } from '../config'
import { db } from '../data/db'
import { getSupabase } from '../data/supabase'
import { ago } from '../features/dashboard/DashboardCards'
import { useNow } from '../lib/useNow'
import { TopPanel } from './Notifications'

interface Preparation { id: number; at: string; task_id: string; task_number: number; who: string }
const readIds = (key: string): number[] => {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(value) ? value.filter((v): v is number => typeof v === 'number') : []
  } catch { return [] }
}

/** The tasks office receives only preparation signals, never the manager's activity feed. */
export function PreparedTaskBell() {
  const me = useEmployee()
  const navigate = useNavigate()
  const now = useNow(60_000)
  const key = `m2-prepared-read:${me.id}`
  const [read, setRead] = useState(() => readIds(key))
  const [rows, setRows] = useState<Preparation[]>([])
  const [loaded, setLoaded] = useState(isDemo)
  const [connected, setConnected] = useState(false)
  useEffect(() => {
    const sb = getSupabase()
    if (!sb || isDemo) return
    let live = true, busy = false, fetched = false
    let debounce: number | undefined
    const cacheKey = `prepared-notifications:${me.id}`
    void db.meta.get(cacheKey).then((cached) => {
      if (live && !fetched && cached) { setRows(cached.value as Preparation[]); setLoaded(true) }
    }).catch(() => { /* The network remains available if local storage is unavailable. */ })
    const load = async () => {
      if (!live || busy || document.visibilityState !== 'visible') return
      if (!navigator.onLine) { setConnected(false); setLoaded(true); return }
      busy = true
      try {
        const { data, error } = await sb.rpc('prepared_task_notifications', { p_limit: 80 })
        if (!live) return
        if (error) { setConnected(false); return }
        const next = (data ?? []) as Preparation[]
        fetched = true
        setRows(next)
        setConnected(true)
        void db.meta.put({ key: cacheKey, value: next }).catch(() => {})
      } catch { if (live) setConnected(false) }
      finally { busy = false; if (live) setLoaded(true) }
    }
    const changed = () => {
      window.clearTimeout(debounce)
      debounce = window.setTimeout(() => void load(), 450)
    }
    const offline = () => setConnected(false)
    const storage = (event: StorageEvent) => { if (event.key === key) setRead(readIds(key)) }
    void load()
    const interval = window.setInterval(() => void load(), 15_000)
    // Subscribe to the already-readable task table, never the private audit log.
    const channel = sb.channel(`prepared-tasks-${me.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tasks' }, changed).subscribe()
    window.addEventListener('online', changed)
    window.addEventListener('offline', offline)
    window.addEventListener('storage', storage)
    document.addEventListener('visibilitychange', changed)
    return () => {
      live = false
      window.clearInterval(interval)
      window.clearTimeout(debounce)
      void sb.removeChannel(channel)
      window.removeEventListener('online', changed)
      window.removeEventListener('offline', offline)
      window.removeEventListener('storage', storage)
      document.removeEventListener('visibilitychange', changed)
    }
  }, [me.id, key])
  const mark = (ids: number[]) => {
    const next = [...new Set([...readIds(key), ...read, ...ids])].sort((a, b) => b - a).slice(0, 500)
    try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* Read state lasts for this visit. */ }
    setRead(next)
  }
  const count = rows.filter((row) => !read.includes(row.id)).length
  return <TopPanel label="إشعارات تجهيز المهام" button={(open, toggle) => (
    <button type="button" className="rbtn bell" title="إشعارات تجهيز المهام" aria-label={count ? `إشعارات تجهيز المهام: ${count} جديدة` : 'إشعارات تجهيز المهام'} aria-expanded={open} onClick={toggle}>
      <Bell size={19} aria-hidden="true" />
      {count > 0 && <span className="bell-n num">{count > 9 ? '9+' : count}</span>}
    </button>
  )}>{(close) => <>
    <div className="notif-h"><b>تجهيز المهام</b><span className="grow" />{count > 0 && <button type="button" className="link-btn" onClick={() => mark(rows.map((r) => r.id))}>تعليم الكل كمقروء</button>}</div>
    <ul className="notif-list">
      {!rows.length && <li className="notif-empty">{!loaded ? 'جارٍ تحميل الإشعارات…' : connected || isDemo ? 'ما في إشعارات تجهيز بعد.' : 'تعذّر تحديث الإشعارات. بنحاول تلقائيًا.'}</li>}
      {rows.map((row) => <li key={row.id}><button type="button" className={`notif-i${read.includes(row.id) ? '' : ' unread'}`} onClick={() => {
        mark([row.id]); close(); navigate(`/tasks?view=waiting&open=${row.task_id}&q=${row.task_number}`)
      }}><span className="ni" aria-hidden="true">{row.who.trim().slice(0, 1)}</span><span className="nt"><b>{row.who}</b><small>جهّز مهمة <bdi className="num">#{row.task_number}</bdi></small><em className="num">{ago(row.at, now)}</em></span></button></li>)}
    </ul>
    {rows.length > 0 && <p className="notif-foot">{connected ? 'آخر إشعارات تجهيز المهام' : 'آخر نسخة محفوظة · بيتحدّث عند الاتصال'}</p>}
  </>}</TopPanel>
}
