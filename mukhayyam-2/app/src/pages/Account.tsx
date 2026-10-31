import { ChevronLeft, Download, LogOut, Moon, RefreshCw, Settings, Smartphone, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useAuth, useEmployee } from '../auth/AuthProvider'
import { config, isDemo } from '../config'
import { formatPhone } from '../lib/phone'
import { useTheme } from '../lib/theme'
import { useDocumentTitle } from '../lib/useDocumentTitle'
import { isManagerRole, titleOf } from '../types'
import { Avatar, Button, Pill } from '../ui/primitives'
import { SyncStatus } from '../ui/status'
import { APK_PATH, isInstalled } from '../ui/InstallApp'
import { syncNow, usePendingCount, useSyncState } from '../data/sync'
import { formatTime } from '../lib/format'

export function Account() {
  useDocumentTitle('حسابي')
  const employee = useEmployee()
  const { signOut } = useAuth()
  const [theme, toggleTheme] = useTheme()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const pending = usePendingCount()
  const sync = useSyncState()

  // The sign-out button asks once; the question goes away by itself.
  useEffect(() => {
    if (!confirming) return
    const id = window.setTimeout(() => setConfirming(false), 4000)
    return () => window.clearTimeout(id)
  }, [confirming])

  return (
    <div className="account">
      <section className="profile glass">
        <Avatar name={employee.fullName} size={72} />
        <div>
          <h1>{employee.fullName}</h1>
          <p>
            {titleOf(employee)}
            {employee.phone && (
              <>
                {' · '}
                <span className="num ltr">{formatPhone(employee.phone)}</span>
              </>
            )}
          </p>
        </div>
      </section>

      <section className="card rows">
        <button type="button" className="row" onClick={toggleTheme}>
          <span className="ico-round">{theme === 'dark' ? <Moon size={16} /> : <Sun size={16} />}</span>
          <span className="row-label">المظهر</span>
          <span className="row-value">{theme === 'dark' ? 'ليلي' : 'نهاري'}</span>
        </button>
        <div className="row">
          <span className="row-label">الاتصال</span>
          <span className="row-value"><SyncStatus /></span>
        </div>
        {!isDemo && (
          <button type="button" className="row" disabled={sync.phase === 'syncing'} onClick={() => void syncNow()}>
            <span className="ico-round"><RefreshCw size={16} className={sync.phase === 'syncing' ? 'spin' : undefined} /></span>
            <span className="row-label">{sync.phase === 'syncing' ? 'جارٍ الإرسال والتحديث…' : 'إرسال وتحديث الآن'}</span>
            <span className="row-value">{sync.lastOkAt ? <>آخر تحديث <span className="num">{formatTime(new Date(sync.lastOkAt))}</span></> : '—'}</span>
          </button>
        )}
        <div className="row">
          <span className="row-label">البيانات</span>
          <span className="row-value">
            {isDemo ? <Pill tone="brand">وضع التجربة: على هذا الجهاز فقط</Pill> : <Pill tone="ok">قاعدة البيانات</Pill>}
          </span>
        </div>
        {isManagerRole(employee.role) && (
          <Link to="/settings" className="row">
            <span className="ico-round"><Settings size={16} /></span>
            <span className="row-label">الإعدادات</span>
            <ChevronLeft size={18} className="row-chevron" />
          </Link>
        )}
        {!isDemo && (
          <a className="row" href={APK_PATH} download>
            <Smartphone size={18} />
            <span className="row-label">تطبيق الأندرويد</span>
            <span className="row-value">{isInstalled() ? 'مثبّت' : 'تحميل'}</span>
            <Download size={16} className="row-chevron" />
          </a>
        )}
        <div className="row">
          <span className="row-label">الإصدار</span>
          <span className="row-value num ltr">{config.version}</span>
        </div>
      </section>

      <Button
        variant={confirming ? 'primary' : 'danger'}
        size="lg"
        block
        busy={busy}
        icon={<LogOut size={18} />}
        onClick={async () => {
          if (!confirming) return setConfirming(true)
          setBusy(true)
          await signOut()
        }}
      >
        {confirming ? 'اضغط مرة ثانية للتأكيد' : 'تسجيل الخروج'}
      </Button>
      {confirming && pending > 0 && (
        <p className="banner" role="alert">
          على هذا الجهاز {pending === 1 ? 'كشف لم يصل' : `${pending} كشوف لم تصل`} للخادم بعد. ستُرسل الآن قبل الخروج إن كان هناك إنترنت، وإلا تبقى محفوظة لك على الجهاز وتُرسل عند دخولك مرة ثانية.
        </p>
      )}
    </div>
  )
}
