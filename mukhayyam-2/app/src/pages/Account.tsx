import { RejectedWrites } from '../ui/RejectedWrites'
import { ChevronLeft, Download, LogOut, Moon, RefreshCw, Settings, Smartphone, Sun } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { useAuth, useEmployee } from '../auth/AuthProvider'
import { isDemo } from '../config'
import { buildLabel, checkNow } from '../app/update'
import { useToast } from '../ui/Toast'
import { Chip, Segmented } from '../ui/form'
import { FONTS, setFont, setTextSize, TEXT_SIZES, useFont, useTextSize, type TextSize } from '../lib/appearance'
import { useConfirm } from '../ui/Confirm'
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
  const toast = useToast()
  const textSize = useTextSize()
  const font = useFont()
  const { signOut } = useAuth()
  const [theme, toggleTheme] = useTheme()
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const pending = usePendingCount()
  const sync = useSyncState()

  return (
    <div className="account">
      {!isManagerRole(employee.role) && <div className="chips"><Link className="btn" to="/my-attendance">سجل حضوري</Link>{employee.role === 'technician' && <Link className="btn" to="/my-tasks">مهامي</Link>}</div>}
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

      <RejectedWrites />
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
          <span className="row-value">
            <span className="num">{buildLabel()}</span>
            <button
              type="button"
              className="link-btn"
              onClick={() =>
                void checkNow().then((r) => toast(r === 'current' ? 'أنت على آخر نسخة' : r === 'updating' ? 'جاري تحديث الموقع…' : 'لا يوجد اتصال بالإنترنت', r === 'offline' ? 'danger' : undefined))
              }
            >
              تحقق من تحديث
            </button>
          </span>
        </div>
      </section>

      <section className="card appearance" aria-label="الخط والحجم">
        <div className="card-h"><h2>الخط والحجم</h2></div>
        <div className="appearance-body">
          <div className="field">
            <span className="label">حجم الكتابة</span>
            <Segmented<TextSize> label="حجم الكتابة" value={textSize} options={TEXT_SIZES} onChange={setTextSize} />
          </div>
          <div className="field">
            <span className="label">نوع الخط</span>
            <div className="chips">
              {FONTS.map((f) => (
                <Chip key={f.value} pressed={font === f.value} onClick={() => setFont(f.value)}>
                  <span style={{ fontFamily: f.css }}>{f.label}</span>
                </Chip>
              ))}
            </div>
          </div>
          <p className="appearance-preview">هيك بتظهر الكتابة: تقرير اليوم، الرصيد المتبقي 1250 لتر، التشغيلة الأولى من 6:00 ص إلى 9:30 ص.</p>
          <small className="muted">يُحفظ على هذا الجهاز فقط.</small>
        </div>
      </section>

      <Button
        variant="danger"
        size="lg"
        block
        busy={busy}
        icon={<LogOut size={18} />}
        onClick={async () => {
          const yes = await confirm({
            title: 'تسجيل الخروج؟',
            message:
              pending > 0
                ? `على هذا الجهاز ${pending === 1 ? 'كشف لم يصل' : `${pending} كشوف لم تصل`} للخادم بعد. ستُرسل الآن قبل الخروج إن كان هناك إنترنت، وإلا تبقى محفوظة لك على الجهاز وتُرسل عند دخولك مرة ثانية.`
                : 'ستحتاج رقم جوالك ورمزك السري لتدخل من جديد.',
            confirmLabel: 'تسجيل الخروج',
            danger: true,
          })
          if (!yes) return
          setBusy(true)
          await signOut()
        }}
      >
        تسجيل الخروج
      </Button>
    </div>
  )
}
