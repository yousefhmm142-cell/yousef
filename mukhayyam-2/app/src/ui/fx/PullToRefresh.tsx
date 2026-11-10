import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router'
import { Zap } from 'lucide-react'
import { syncNow, useSyncState } from '../../data/sync'
import { usePageVisible, prefersReducedMotion } from '../../lib/motion'
import { useToast } from '../Toast'

/** A gesture only: existing sync/queue/auth rules remain the source of truth. */
export function PullToRefresh({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const visible = usePageVisible()
  const toast = useToast()
  const sync = useSyncState()
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const busy = useRef(false)
  const [refreshing, setRefreshing] = useState(false)
  const [distance, setDistance] = useState(0)
  useEffect(() => {
    let start: { x: number; y: number } | null = null
    let pull = 0
    let buzzed = false
    const reset = () => {
      start = null
      pull = 0
      setDistance(0)
    }
    const begin = (event: TouchEvent) => {
      reset()
      if (
        busy.current ||
        !matchMedia('(max-width: 900px)').matches ||
        event.touches.length !== 1 ||
        window.scrollY > 0 ||
        document.visibilityState !== 'visible'
      )
        return
      const target = event.target
      if (
        !(target instanceof Element) ||
        !document.getElementById('main')?.contains(target) ||
        target.closest('input,textarea,select,button,a,.bg,.rf-sheet,[contenteditable="true"]') ||
        document.querySelector('dialog[open],[role="dialog"][aria-modal="true"]') ||
        document.querySelector('main .bg,main .rf-sheet')
      )
        return
      for (let el: Element | null = target; el && el !== document.body; el = el.parentElement) {
        const style = getComputedStyle(el)
        if (
          (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight) ||
          (/(auto|scroll)/.test(style.overflowX) && el.scrollWidth > el.clientWidth)
        )
          return
      }
      start = { x: event.touches[0]!.clientX, y: event.touches[0]!.clientY }
      buzzed = false
    }
    const move = (event: TouchEvent) => {
      if (!start) return
      if (event.touches.length !== 1 || window.scrollY > 0) {
        reset()
        return
      }
      const touch = event.touches[0]!
      const dy = touch.clientY - start.y
      if (dy < 0 || Math.abs(touch.clientX - start.x) > Math.abs(dy)) {
        reset()
        return
      }
      pull = Math.min(100, dy * 0.65)
      setDistance(pull)
      if (pull >= 70 && !buzzed) {
        buzzed = true
        if (!prefersReducedMotion()) {
          try {
            navigator.vibrate?.(10)
          } catch {
            /* Optional on iOS. */
          }
        }
      }
    }
    const end = () => {
      const refresh = start && pull >= 70
      reset()
      if (!refresh || busy.current) return
      if (!navigator.onLine) {
        toast('ما في نت، بياناتك المحفوظة موجودة.', 'danger')
        return
      }
      busy.current = true
      setRefreshing(true)
      void (async () => {
        try {
          await syncNow()
          if (pathname === '/tasks' || pathname === '/my-tasks') {
            const { refreshTasks } = await import('../../features/tasks/repo')
            if (!(await refreshTasks())) throw new Error('refresh')
          }
        } catch {
          if (mounted.current) toast('تعذّر التحديث، حاول مرة ثانية.', 'danger')
        } finally {
          busy.current = false
          if (mounted.current) setRefreshing(false)
        }
      })()
    }
    document.addEventListener('touchstart', begin, { passive: true })
    document.addEventListener('touchmove', move, { passive: true })
    document.addEventListener('touchend', end, { passive: true })
    document.addEventListener('touchcancel', reset, { passive: true })
    return () => {
      document.removeEventListener('touchstart', begin)
      document.removeEventListener('touchmove', move)
      document.removeEventListener('touchend', end)
      document.removeEventListener('touchcancel', reset)
    }
  }, [pathname, toast])
  return (
    <>
      {children}
      <div
        className="fx-pull fx-decoration"
        role="status"
        aria-label={refreshing ? 'جاري التحديث' : distance >= 70 ? 'اترك للتحديث' : 'اسحب للتحديث'}
        data-refreshing={refreshing || undefined}
        data-paused={!visible || undefined}
        style={{
          transform: `translate(-50%,${refreshing ? 20 : distance - 80}px)`,
          opacity: refreshing || distance ? 1 : 0,
        }}
        aria-hidden={!refreshing && !distance}
      >
        <span className="fx-pull-icon">
          <Zap size={24} aria-hidden="true" />
          <span style={{ transform: `scaleY(${Math.min(1, distance / 70)})` }}>
            <Zap size={24} aria-hidden="true" />
          </span>
        </span>
        <small>{refreshing ? 'جاري التحديث…' : distance >= 70 ? 'اترك للتحديث' : 'اسحب للتحديث'}</small>
        {!refreshing && sync.phase === 'error' && <span className="sr-only">تعذّر آخر تحديث</span>}
      </div>
    </>
  )
}
