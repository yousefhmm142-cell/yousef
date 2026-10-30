import { Moon, Sun } from 'lucide-react'
import { isDemo } from '../config'
import { usePendingCount, useSyncState } from '../data/sync'
import { useTheme } from '../lib/theme'
import { useOnline } from '../lib/useOnline'

/** Connection, unsent changes and demo mode, in one quiet line. Phones show only the short part. */
export function SyncStatus() {
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

  const tone = !online || stuck ? 'warn' : isDemo ? 'brand' : 'ok'
  return (
    <span className={`sync ${tone}`} role="status" aria-live="polite">
      <span className="sync-dot" aria-hidden="true" />
      <span className="sync-label">{label}</span>
      {detail && <span className="sync-detail"> · {detail}</span>}
    </span>
  )
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
