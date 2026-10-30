import { CircleAlert, ShieldCheck } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { setupFirstAdmin } from '../data/admin'
import { SheetStateError } from '../features/sheets/workflow'
import { formatPhone, isValidPhone, normalizePhone } from '../lib/phone'
import { Button } from '../ui/primitives'
import { PinInput } from '../ui/PinInput'

const errorText: Record<string, string> = {
  bad_name: 'اكتب اسمك الكامل (حرفان على الأقل).',
  bad_phone: 'رقم الجوال 10 خانات ويبدأ بـ 059 أو 056.',
  bad_pin: 'الرمز السري 6 أرقام.',
  phone_taken: 'هذا الرقم مسجّل لشخص آخر.',
  already_set_up: 'جُهّز النظام من قبل. ادخل برقمك ورمزك.',
  offline: 'لا يوجد اتصال بالإنترنت. اتصل وحاول مرة أخرى.',
}

/** Shown once, on a brand-new database: the person setting up becomes the system admin. */
export function FirstSetup({ onDone }: { onDone(): void }) {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const pinRef = useRef<HTMLInputElement>(null)
  const pin2Ref = useRef<HTMLInputElement>(null)

  async function submit(e?: FormEvent) {
    e?.preventDefault()
    if (busy) return
    if (name.trim().length < 2) return setError(errorText.bad_name!)
    if (!isValidPhone(phone)) return setError(errorText.bad_phone!)
    if (pin.length !== 6) {
      pinRef.current?.focus()
      return setError(errorText.bad_pin!)
    }
    if (pin2 !== pin) {
      setPin2('')
      pin2Ref.current?.focus()
      return setError('الرمزان غير متطابقين. أعد كتابة الرمز.')
    }
    setBusy(true)
    setError(null)
    try {
      await setupFirstAdmin(name, phone, pin)
      // The sign-in screen sends a signed-in person to state.from: open Settings to add the team.
      navigate(location.pathname, { replace: true, state: { from: '/settings' } })
      await signIn(phone, pin)
    } catch (err) {
      const code = err instanceof SheetStateError ? err.message : ''
      if (code === 'already_set_up') onDone()
      setError(errorText[code] ?? 'تعذّر التجهيز. حاول مرة أخرى.')
      setBusy(false)
    }
  }

  return (
    <>
      <div className="login-card-head">
        <span className="setup-badge"><ShieldCheck size={26} /></span>
        <h2>تجهيز النظام لأول مرة</h2>
        <p>أنت مسؤول النظام. بعدها تضيف الموظفين من الإعدادات.</p>
      </div>
      <form onSubmit={(e) => void submit(e)} noValidate className="login-form">
        <div className="field">
          <label htmlFor="setup-name">اسمك الكامل</label>
          <input id="setup-name" className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label htmlFor="setup-phone">رقم جوالك</label>
          <input
            id="setup-phone"
            className="input ltr num"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="059 000 0000"
            value={formatPhone(phone)}
            onChange={(e) => {
              const next = normalizePhone(e.target.value)
              setPhone(next)
              if (isValidPhone(next)) pinRef.current?.focus()
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="setup-pin">اختر رمزاً سرياً من 6 أرقام</label>
          <PinInput id="setup-pin" inputRef={pinRef} value={pin} onChange={setPin} onComplete={() => pin2Ref.current?.focus()} disabled={busy} />
        </div>
        <div className="field">
          <label htmlFor="setup-pin2">أعد كتابة الرمز</label>
          <PinInput
            id="setup-pin2"
            inputRef={pin2Ref}
            value={pin2}
            onChange={setPin2}
            invalid={pin2.length === 6 && pin2 !== pin}
            disabled={busy}
          />
        </div>
        {error && (
          <div className="banner danger" role="alert">
            <CircleAlert size={18} />
            <p>{error}</p>
          </div>
        )}
        <Button type="submit" variant="primary" size="lg" block busy={busy}>
          تجهيز النظام والدخول
        </Button>
      </form>
    </>
  )
}
