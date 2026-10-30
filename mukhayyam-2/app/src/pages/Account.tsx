import { ChevronLeft, LogOut, Moon, Settings, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useAuth, useEmployee } from '../auth/AuthProvider'
import { config, isDemo } from '../config'
import { formatPhone } from '../lib/phone'
import { useTheme } from '../lib/theme'
import { useDocumentTitle } from '../lib/useDocumentTitle'
import { roleLabel } from '../types'
import { Avatar, Button, Pill } from '../ui/primitives'
import { SyncStatus } from '../ui/status'

export function Account() {
  useDocumentTitle('حسابي')
  const employee = useEmployee()
  const { signOut } = useAuth()
  const [theme, toggleTheme] = useTheme()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

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
            {roleLabel[employee.role]}
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
        <div className="row">
          <span className="row-label">البيانات</span>
          <span className="row-value">
            {isDemo ? <Pill tone="brand">وضع التجربة: على هذا الجهاز فقط</Pill> : <Pill tone="ok">قاعدة البيانات</Pill>}
          </span>
        </div>
        {employee.role === 'admin' && (
          <Link to="/settings" className="row">
            <span className="ico-round"><Settings size={16} /></span>
            <span className="row-label">الإعدادات</span>
            <ChevronLeft size={18} className="row-chevron" />
          </Link>
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
    </div>
  )
}
