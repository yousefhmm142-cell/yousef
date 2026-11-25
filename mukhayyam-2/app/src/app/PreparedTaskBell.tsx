import { Bell } from 'lucide-react'
import { Component, useEffect, useRef, useState, type ReactNode } from 'react'
import { getSupabase } from '../data/supabase'
import { db } from '../data/db'
import { preparedNotices, readNoticeIds, type PreparedNotice } from './preparedNotifications'

function savedRead(key: string): number[] {
  try { return readNoticeIds(JSON.parse(localStorage.getItem(key) ?? '[]')) } catch { return [] }
}

/** A notification fault must stay inside the bell, never replace the office's page. */
class BellBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed ? <button type="button" className="rbtn" aria-label="إعادة محاولة تشغيل جرس المهام" title="إعادة محاولة تشغيل جرس المهام" onClick={() => this.setState({ failed: false })}><Bell size={19} /></button> : this.props.children
  }
}
export function PreparedTaskBell({ employeeId }: { employeeId: string }) {
  return <BellBoundary key={employeeId}><PreparationBell employeeId={employeeId} /></BellBoundary>
}

function PreparationBell({ employeeId }: { employeeId: string }) {
  const key = `m2-prepared-read:${employeeId}`
  const [read, setRead] = useState(() => savedRead(key))
  const [rows, setRows] = useState<PreparedNotice[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [connected, setConnected] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const refresh = useRef<() => void>(() => {})
  useEffect(() => {
    let live = true, fetched = false, busy = false
    let pending: AbortController | undefined
    const cacheKey = `prepared-notifications:${employeeId}`
    void db.meta.get(cacheKey).then((cached) => {
      if (live && !fetched && cached) { setRows(preparedNotices(cached.value)); setLoading(false) }
    }).catch(() => {})
    const load = async () => {
      if (!live || busy || document.visibilityState !== 'visible') return
      if (!navigator.onLine) { setConnected(false); setLoading(false); return }
      busy = true
      pending = new AbortController()
      const timeout = window.setTimeout(() => pending?.abort(), 10_000)
      try {
        const sb = getSupabase()
        if (!sb) return
        const { data, error } = await sb.rpc('prepared_task_notifications', { p_limit: 80 }).abortSignal(pending.signal)
        if (!live) return
        if (error || !Array.isArray(data)) { setConnected(false); return }
        const safe = preparedNotices(data)
        fetched = true
        setRows(safe)
        setConnected(true)
        // Store only the same safe projection the RPC returns; no task contents or tokens.
        void db.meta.put({ key: cacheKey, value: safe.map((r) => ({ id: r.id, at: r.at, task_number: r.taskNumber, who: r.who })) }).catch(() => {})
      } catch { if (live) setConnected(false) }
      finally { window.clearTimeout(timeout); busy = false; if (live) setLoading(false) }
    }
    const changed = () => { void load() }
    const offline = () => setConnected(false)
    const storage = (event: StorageEvent) => { if (event.key === key) setRead(savedRead(key)) }
    refresh.current = changed
    changed()
    const interval = window.setInterval(changed, 15_000)
    window.addEventListener('online', changed)
    window.addEventListener('offline', offline)
    window.addEventListener('storage', storage)
    document.addEventListener('visibilitychange', changed)
    return () => {
      live = false
      pending?.abort()
      window.clearInterval(interval)
      refresh.current = () => {}
      window.removeEventListener('online', changed)
      window.removeEventListener('offline', offline)
      window.removeEventListener('storage', storage)
      document.removeEventListener('visibilitychange', changed)
    }
  }, [employeeId, key])
  useEffect(() => {
    if (!open) return
    const outside = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [open])
  const count = rows.filter((r) => !read.includes(r.id)).length
  const markAll = () => {
    const next = readNoticeIds([...savedRead(key), ...read, ...rows.map((r) => r.id)])
    try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* Remains read for this visit. */ }
    setRead(next)
  }
  return <div className="bell-wrap" ref={box}>
    <button type="button" className="rbtn bell" title="إشعارات تجهيز المهام" aria-label={count ? `إشعارات تجهيز المهام: ${count} جديدة` : 'إشعارات تجهيز المهام'} aria-haspopup="dialog" aria-expanded={open} onClick={() => { setOpen(!open); if (!open) refresh.current() }}>
      <Bell size={19} aria-hidden="true" />{count > 0 && <span className="bell-n num">{count > 9 ? '9+' : count}</span>}
    </button>
    {open && <div className="notif prepared-notif" role="dialog" aria-label="إشعارات تجهيز المهام">
      <div className="notif-h"><b>تجهيز المهام</b><span className="grow" />{count > 0 && <button type="button" className="link-btn" onClick={markAll}>تعليم الكل كمقروء</button>}</div>
      <ul className="notif-list">
        {!rows.length && <li className="notif-empty">{loading ? 'جارٍ تحميل الإشعارات…' : connected ? 'ما في إشعارات تجهيز بعد.' : 'تعذّر تحديث الإشعارات. بنحاول تلقائيًا.'}</li>}
        {rows.map((r) => <li className={`notif-i${read.includes(r.id) ? '' : ' unread'}`} key={r.id}><span className="ni" aria-hidden="true">{r.who.slice(0, 1)}</span><span className="nt"><b>{r.who}</b><small>جهّز مهمة <bdi className="num">#{r.taskNumber}</bdi></small><time className="prepared-time num" dateTime={r.at}>{new Date(r.at).toLocaleString('ar-EG-u-nu-latn', { timeZone: 'Asia/Gaza', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time></span></li>)}
      </ul>
      {rows.length > 0 && <p className="notif-foot">{connected ? 'إشعارات تجهيز المهام فقط' : 'آخر نسخة محفوظة · بيتحدّث عند الاتصال'}</p>}
    </div>}
  </div>
}
