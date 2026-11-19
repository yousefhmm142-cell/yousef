import { LoginLogo } from '../features/login/LoginLogo'
import '../styles/login-entry.css'
import { CircleAlert, ClipboardList, LayoutGrid, ListChecks, LockKeyhole, ScanLine, WifiOff } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { lastPhone, useAuth } from '../auth/AuthProvider'
import { AuthError, authErrorText, type AuthErrorCode } from '../auth/backends'
import { isDemo } from '../config'
import { databaseState, type DatabaseState } from '../data/admin'
import { DEMO_PIN, demoEmployees } from '../data/demo'
import { useDocumentTitle } from '../lib/useDocumentTitle'
import { formatPhone, isValidPhone, normalizePhone } from '../lib/phone'
import { titleOf } from '../types'
import { Button } from '../ui/primitives'
import { PinInput } from '../ui/PinInput'
import { FirstSetup } from './FirstSetup'
import { InstallAppLink } from '../ui/InstallApp'
import { ThemeToggle } from '../ui/status'
import { Splash } from './Splash'

const PIN_LENGTH = 6

/** One sample account per role. */
const demoAccountsByRole = demoEmployees.filter((e, i, all) => all.findIndex((x) => x.role === e.role) === i)

export function LoginRoute() {
  const { state } = useAuth()
  const location = useLocation()
  if (state.status === 'loading') return <Splash />
  if (state.status === 'signed_in') {
    const from = (location.state as { from?: string } | null)?.from
    return <Navigate to={from && from !== '/login' ? from : '/'} replace />
  }
  return <Login />
}

function Login() {
  useDocumentTitle('تسجيل الدخول')
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [phone, setPhone] = useState(lastPhone)
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [verified, setVerified] = useState(false)
  const submitting = useRef(false)
  const [error, setError] = useState<AuthErrorCode | null>(null)
  const [phoneTouched, setPhoneTouched] = useState(false)
  const phoneRef = useRef<HTMLInputElement>(null)
  const pinRef = useRef<HTMLInputElement>(null)
  const [db, setDb] = useState<DatabaseState>('unknown')

  // Real mode: a brand-new database opens on first-time setup instead of sign-in.
  useEffect(() => {
    if (isDemo) return
    let alive = true
    void databaseState().then((s) => alive && setDb(s))
    return () => {
      alive = false
    }
  }, [])

  // Fields are available immediately while the logo draws in its own place.
  useEffect(()=>{
    const frame=requestAnimationFrame(()=>{
      if(isValidPhone(lastPhone()))pinRef.current?.focus()
      else phoneRef.current?.focus()
    })
    return ()=>cancelAnimationFrame(frame)
  },[])

  const phoneInvalid = phoneTouched && phone.length > 0 && !isValidPhone(phone)

  async function submit(p = phone, code = pin) {
    if (submitting.current) return
    if (!isValidPhone(p)) {
      setPhoneTouched(true)
      phoneRef.current?.focus()
      return
    }
    if (code.length !== PIN_LENGTH) {
      pinRef.current?.focus()
      return
    }
    submitting.current = true
    setBusy(true)
    setError(null)
    try {
      await signIn(p, code, async () => {
        setVerified(true)
        await new Promise((resolve) => setTimeout(resolve, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 650))
      })
      const from = (location.state as { from?: string } | null)?.from
      navigate(from && from !== '/login' ? from : '/', { replace: true })
    } catch (e) {
      setError(e instanceof AuthError ? e.code : 'unknown')
      setPin('')
      setBusy(false)
      submitting.current = false
      requestAnimationFrame(() => pinRef.current?.focus())
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    void submit()
  }

  return (
    <div className="login entry-page">
      <section className="login-brand entry-side">
        <div className="entry-side-bg" aria-hidden="true"><i className="b1" /><i className="b2" /><i className="grain" /></div>
        <div className="entry-side-in">
          <div className="entry-logo"><LoginLogo /></div>
          <h1>نظام إدارة مكتب مخيم <span className="entry-two num">2</span></h1>
          <p>شركة أبناء فارس أبو زايد للتجارة والاستيراد</p>
          <ul className="login-modules" aria-label="أقسام النظام">
            <li style={{ '--d': '.5s' } as CSSProperties}><span className="em-ico"><ClipboardList size={19} /></span><span><b>التوليد</b><small>تقرير الموقع اليومي والسولار</small></span></li>
            <li style={{ '--d': '.58s' } as CSSProperties}><span className="em-ico"><LayoutGrid size={19} /></span><span><b>التوزيع</b><small>كشف المناطق والأحمال</small></span></li>
            <li style={{ '--d': '.66s' } as CSSProperties}><span className="em-ico"><ListChecks size={19} /></span><span><b>المهام</b><small>أوامر الفنيين وإنجازها</small></span></li>
            <li style={{ '--d': '.74s' } as CSSProperties}><span className="em-ico"><ScanLine size={19} /></span><span><b>الحضور</b><small>بمسح ورقة الـQR</small></span></li>
          </ul>
        </div>
        <footer className="entry-footer"><span>© {new Date().getFullYear()} أبناء فارس أبو زايد</span><i className="dot" aria-hidden="true" /><span>نظام إدارة مكتب مخيم 2</span></footer>
      </section>

      <span className="entry-divider" aria-hidden="true"><i /></span>

      <div className="entry-main">
        <div className="entry-main-bg" aria-hidden="true" />
        <div className="entry-theme"><ThemeToggle /></div>
      <section className="login-card glass" data-verified={verified || undefined}>
        {db === 'setup' ? (
          <FirstSetup onDone={() => setDb('ready')} />
        ) : (
        <>
        {db === 'not_installed' && (
          <div className="banner warn setup-note" role="status">
            <CircleAlert size={18} />
            <p>قاعدة البيانات لم تُجهَّز بعد<span>شغّل ملف setup.sql مرة واحدة في Supabase ‏(SQL Editor)، ثم حدّث هذه الصفحة.</span></p>
          </div>
        )}
        {db === 'bad_key' && (
          <div className="banner danger setup-note" role="alert">
            <CircleAlert size={18} />
            <p>بيانات الربط مع Supabase غير صحيحة<span>تأكد من رابط المشروع والمفتاح العام في إعدادات التطبيق.</span></p>
          </div>
        )}
        <div className="login-card-head">
          <span className="entry-badge" aria-hidden="true"><LockKeyhole size={22} /></span>
          <h2 aria-live="polite">{verified ? 'أهلاً وسهلاً' : 'تسجيل الدخول'}</h2>
          <p>{verified ? 'تم التحقق من الرمز' : 'برقم جوالك والرمز السري'}</p>
        </div>

        <form onSubmit={onSubmit} noValidate className="login-form">
          <div className="field">
            <label htmlFor="phone">رقم الجوال</label>
            <input
              ref={phoneRef}
              id="phone"
              className="input ltr num"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="059 000 0000"
              value={formatPhone(phone)}
              disabled={busy}
              aria-invalid={phoneInvalid || undefined}
              aria-describedby={phoneInvalid ? 'phone-error' : undefined}
              onBlur={() => setPhoneTouched(true)}
              onChange={(e) => {
                const next = normalizePhone(e.target.value)
                setPhone(next)
                setError(null)
                if (isValidPhone(next)) pinRef.current?.focus()
              }}
            />
            {phoneInvalid && (
              <span className="field-error" id="phone-error">
                <CircleAlert size={15} />
                الرقم 10 خانات ويبدأ بـ 059 أو 056
              </span>
            )}
          </div>

          <div className="field">
            <label htmlFor="pin">الرمز السري</label>
            <PinInput
              id="pin"
              inputRef={pinRef}
              value={pin}
              status={verified ? 'verified' : busy ? 'checking' : 'idle'}
              length={PIN_LENGTH}
              invalid={error === 'bad_credentials'}
              disabled={busy}
              describedBy={error ? 'login-error' : undefined}
              onChange={(v) => {
                setPin(v)
                if (error) setError(null)
              }}
              onComplete={(v) => void submit(phone, v)}
            />
          </div>

          {error && (
            <div className="banner danger" id="login-error" role="alert">
              <CircleAlert size={18} />
              <p>
                {authErrorText[error].title}
                <span>{authErrorText[error].detail}</span>
              </p>
            </div>
          )}

          <Button type="submit" variant="primary" size="lg" block busy={busy}>
            دخول
          </Button>
        </form>

        <p className="login-note">
          <WifiOff size={15} aria-hidden="true" />
          بعد أول دخول، يعمل التطبيق حتى بدون إنترنت.
        </p>

        {isDemo && (
          <div className="demo">
            <div className="demo-head">
              <b>وضع التجربة</b>
              <span>
                اضغط أي حساب للدخول به. الرمز لكل الحسابات: <b className="num ltr">{DEMO_PIN}</b>
              </span>
            </div>
            <div className="demo-list">
              {demoAccountsByRole.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  className="demo-item"
                  disabled={busy}
                  onClick={() => {
                    setPhone(e.phone!)
                    setPin(DEMO_PIN)
                    void submit(e.phone!, DEMO_PIN)
                  }}
                >
                  <b>{e.fullName}</b>
                  <small>{titleOf(e)}</small>
                </button>
              ))}
            </div>
          </div>
        )}
        </>
        )}
        <InstallAppLink />
      </section>
      </div>
    </div>
  )
}
