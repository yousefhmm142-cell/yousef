import { Moon, Sun } from 'lucide-react'
import { isDemo } from '../config'
import { usePendingCount, useSyncState } from '../data/sync'
import { useTheme } from '../lib/theme'
import { useOnline } from '../lib/useOnline'

/** The connection in words: what to say, the extra detail, and the colour. */
export function useConnection() {
  const online = useOnline()
  const pending = usePendingCount()
  const sync = useSyncState()

  let label: string
  let detail: string | null = null
  let stuck = false
  if (!online) {
    label = 'بدون اتصال'
    detail = pending > 0 ? `${pending} بانتظار الإرسال` : 'يُحفظ على الجهاز'
  } else if (pending > 0 && sync.phase === 'error') {
    stuck = true
    label = 'لم يُرسل بعد'
    detail = sync.problem ? `كشف ${sync.problem} رفضه الخادم` : 'يُعاد المحاولة تلقائياً'
  } else if (pending > 0) {
    label = `يرسل ${pending}…`
  } else {
    label = isDemo ? 'وضع التجربة' : 'متصل'
  }
  const tone: 'ok' | 'warn' | 'brand' = !online || stuck ? 'warn' : isDemo ? 'brand' : 'ok'
  return { label, detail, tone }
}

/** Connection, unsent changes and demo mode, in one quiet line (the account page). */
export function SyncStatus() {
  const { label, detail, tone } = useConnection()
  return (
    <span className={`sync ${tone}`} role="status" aria-live="polite">
      <span className="sync-dot" aria-hidden="true" />
      <span className="sync-label">{label}</span>
      {detail && <span className="sync-detail"> · {detail}</span>}
    </span>
  )
}

/** Just a dot on the photo, like «online» on a messenger: green connected, orange not sending. */
export function StatusBadge() {
  const { label, detail, tone } = useConnection()
  return <span className={`status-badge ${tone}`} role="status" aria-label={detail ? `${label}: ${detail}` : label} title={detail ? `${label} · ${detail}` : label} />
}

export function ThemeToggle() {
  const [theme, toggle] = useTheme()
  const label = theme === 'dark' ? 'الوضع النهاري' : 'الوضع الليلي'
  return (
    <button type="button" className="icon-btn" onClick={toggle} aria-label={label} title={label}>
      {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  )
}
