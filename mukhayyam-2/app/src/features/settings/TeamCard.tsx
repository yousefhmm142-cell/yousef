import { useLiveQuery } from 'dexie-react-hooks'
import { Copy, KeyRound, MessageCircle, Pencil, Plus, Users } from 'lucide-react'
import { useState } from 'react'
import { useEmployee } from '../../auth/AuthProvider'
import { isDemo } from '../../config'
import { byRoleThenName, saveEmployee } from '../../data/admin'
import { db } from '../../data/db'
import { formatPhone, isValidPhone, normalizePhone, toLatinDigits } from '../../lib/phone'
import { roleLabel, type Employee, type Role } from '../../types'
import { Dialog } from '../../ui/Dialog'
import { Segmented, TextField } from '../../ui/form'
import { Avatar, Button, Pill } from '../../ui/primitives'
import { useToast } from '../../ui/Toast'
import { SheetStateError } from '../sheets/workflow'

// One site role in the list; older people with the second site role keep it.
const baseRoles: Role[] = ['manager', 'generation_operator', 'technician', 'staff', 'admin']

const errorText: Record<string, string> = {
  bad_name: 'اكتب الاسم الكامل.',
  bad_phone: 'رقم الجوال 10 خانات ويبدأ بـ 059 أو 056. الرمز السري يحتاج رقم جوال.',
  bad_pin: 'الرمز السري 6 أرقام.',
  phone_taken: 'هذا الرقم مسجّل لموظف آخر.',
  pin_needed: 'اكتب رمزاً سرياً لهذا الرقم.',
  last_admin: 'لا يمكن إيقاف آخر مسؤول للنظام أو تغيير دوره.',
  not_allowed: 'هذه الخطوة لمسؤول النظام فقط.',
  offline: 'إضافة الموظفين تحتاج إنترنت. اتصل وحاول مرة أخرى.',
  missing: 'لم يعد هذا الموظف موجوداً. حدّث الصفحة.',
}

const randomPin = () => String(crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000).padStart(6, '0')

/** Everyone on the team, their phone, and whether they can sign in. */
export function TeamCard() {
  const people = useLiveQuery(async () => (await db.employees.toArray()).sort(byRoleThenName), [])
  const [editing, setEditing] = useState<Employee | 'new' | null>(null)

  return (
    <section className="card">
      <div className="card-h">
        <span className="ico-round brand"><Users size={16} /></span>
        <h2>الفريق وحسابات الدخول</h2>
        <Button variant="primary" icon={<Plus size={17} />} onClick={() => setEditing('new')} className="card-h-action">
          إضافة موظف
        </Button>
      </div>
      {!people ? (
        <div className="loading-block" aria-busy="true" />
      ) : (
        <ul className="gen-list team-admin">
          {people.map((e) => (
            <li key={e.id} data-off={!e.isActive || undefined}>
              <Avatar name={e.fullName} size={36} />
              <span className="gen-main">
                <b>{e.fullName}</b>
                <small>
                  {roleLabel[e.role]}
                  {e.phone && <> · <span className="num ltr">{formatPhone(e.phone)}</span></>}
                </small>
              </span>
              {!e.isActive ? <Pill>موقوف</Pill> : e.hasLogin ? <Pill tone="ok">يدخل بجواله</Pill> : <Pill tone="warn">بدون دخول</Pill>}
              <button type="button" className="icon-btn" aria-label={`تعديل ${e.fullName}`} onClick={() => setEditing(e)}>
                <Pencil size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing && <EmployeeDialog person={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </section>
  )
}

const yesNo = [
  { value: 'yes', label: 'نعم' },
  { value: 'no', label: 'لا' },
] as const
const activeOptions = [
  { value: 'on', label: 'فعّال' },
  { value: 'off', label: 'موقوف' },
] as const

function EmployeeDialog({ person, onClose }: { person: Employee | null; onClose(): void }) {
  const me = useEmployee()
  const toast = useToast()
  const [name, setName] = useState(person?.fullName ?? '')
  const [role, setRole] = useState<Role>(person?.role ?? 'technician')
  const [phone, setPhone] = useState(person?.phone ?? '')
  // New people get a PIN ready to hand over; existing logins keep theirs unless changed.
  const [pin, setPin] = useState(person?.hasLogin ? '' : randomPin())
  const [changePin, setChangePin] = useState(!person?.hasLogin)
  const [attendance, setAttendance] = useState<'yes' | 'no'>(person?.tracksAttendance === false ? 'no' : 'yes')
  const [active, setActive] = useState<'on' | 'off'>(person?.isActive === false ? 'off' : 'on')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [handover, setHandover] = useState<{ name: string; phone: string; pin: string } | null>(null)

  const self = person?.id === me.id

  async function save() {
    const newPin = changePin && phone ? pin : null
    if (changePin && phone && !/^\d{6}$/.test(pin)) return setError(errorText.bad_pin!)
    if (phone && !isValidPhone(phone)) return setError(errorText.bad_phone!)
    setBusy(true)
    setError(null)
    try {
      await saveEmployee({
        id: person?.id,
        fullName: name,
        role,
        phone: phone || null,
        pin: newPin,
        isActive: active === 'on',
        tracksAttendance: attendance === 'yes',
      })
      if (newPin) {
        setHandover({ name: name.trim(), phone, pin: newPin })
        setBusy(false)
      } else {
        toast(person ? 'حُفظ التعديل' : 'أُضيف الموظف')
        onClose()
      }
    } catch (e) {
      const code = e instanceof SheetStateError ? e.message : ''
      setError(errorText[code] ?? 'تعذّر الحفظ. حاول مرة أخرى.')
      setBusy(false)
    }
  }

  if (handover) return <Handover {...handover} onClose={onClose} />

  return (
    <Dialog
      open
      onClose={onClose}
      title={person ? `تعديل ${person.fullName}` : 'إضافة موظف'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>إلغاء</Button>
          <Button variant="primary" busy={busy} onClick={() => void save()}>حفظ</Button>
        </>
      }
    >
      <div className="form-grid">
        <TextField label="الاسم الكامل" value={name} onChange={setName} placeholder="مثل: قصي الشافعي" />
        <label className="field">
          <span className="label">الدور</span>
          <select className="select" value={role} disabled={self} onChange={(e) => setRole(e.target.value as Role)}>
            {(person?.role === 'distribution_supervisor' ? [...baseRoles, 'distribution_supervisor' as Role] : baseRoles).map((r) => (
              <option key={r} value={r}>{roleLabel[r]}</option>
            ))}
          </select>
          {self && <span className="field-hint">لا يمكنك تغيير دورك بنفسك.</span>}
        </label>
        <label className="field">
          <span className="label">رقم الجوال</span>
          <input
            className="input ltr num"
            type="tel"
            inputMode="tel"
            placeholder="059 000 0000"
            value={formatPhone(phone)}
            onChange={(e) => setPhone(normalizePhone(e.target.value))}
          />
          <span className="field-hint">يدخل به الموظف، وتصله عليه رسائل المهام.</span>
        </label>
        {phone && (
          <div className="field">
            <span className="label">الرمز السري</span>
            {changePin ? (
              <div className="pin-row">
                <input
                  className="input ltr num pin-plain"
                  inputMode="numeric"
                  maxLength={6}
                  aria-label="الرمز السري"
                  value={pin}
                  onChange={(e) => setPin(toLatinDigits(e.target.value).replace(/\D/g, '').slice(0, 6))}
                />
                <Button variant="ghost" icon={<KeyRound size={16} />} onClick={() => setPin(randomPin())}>رمز جديد</Button>
              </div>
            ) : (
              <Button variant="secondary" icon={<KeyRound size={16} />} onClick={() => { setChangePin(true); setPin(randomPin()) }}>
                تغيير الرمز
              </Button>
            )}
            <span className="field-hint">
              {person?.hasLogin && changePin ? 'الرمز الجديد يُخرجه من كل الأجهزة حتى يدخل به.' : '6 أرقام يعطيها للموظف ليدخل بها.'}
            </span>
          </div>
        )}
        <div className="field">
          <span className="label">يسجّل حضوره بالـ QR</span>
          <Segmented<'yes' | 'no'> label="يسجّل حضوره" value={attendance} options={yesNo} onChange={setAttendance} />
        </div>
        <div className="field">
          <span className="label">الحالة</span>
          <Segmented<'on' | 'off'> label="حالة الموظف" value={active} options={activeOptions} onChange={setActive} />
          <span className="field-hint">الموقوف لا يستطيع الدخول، وتبقى تقاريره السابقة كما هي.</span>
        </div>
        {error && <p className="field-error" role="alert">{error}</p>}
      </div>
    </Dialog>
  )
}

/** After a PIN is set: the details to hand to the person, by WhatsApp or copied. */
function Handover({ name, phone, pin, onClose }: { name: string; phone: string; pin: string; onClose(): void }) {
  const toast = useToast()
  const link = isDemo ? '' : window.location.origin
  const message = `مرحباً ${name}،\nهذا حسابك في نظام مخيم 2:\nرقم الجوال: ${phone}\nالرمز السري: ${pin}${link ? `\nالرابط: ${link}` : ''}`
  const wa = `https://wa.me/970${phone.slice(1)}?text=${encodeURIComponent(message)}`

  return (
    <Dialog
      open
      onClose={onClose}
      title="حُفظ. أعطِ الموظف بيانات دخوله"
      footer={<Button variant="primary" onClick={onClose}>تم</Button>}
    >
      <div className="handover">
        <p className="muted">{name} يدخل بهذين فقط، ثم يعمل التطبيق على جواله حتى بدون إنترنت.</p>
        <dl>
          <div><dt>رقم الجوال</dt><dd className="num ltr">{formatPhone(phone)}</dd></div>
          <div><dt>الرمز السري</dt><dd className="num ltr pin-big">{pin}</dd></div>
        </dl>
        <div className="handover-actions">
          <a className="btn primary" href={wa} target="_blank" rel="noreferrer">
            <MessageCircle size={17} /> إرسال على واتساب
          </a>
          <Button
            variant="secondary"
            icon={<Copy size={16} />}
            onClick={() => {
              void navigator.clipboard?.writeText(message).then(
                () => toast('نُسخت البيانات'),
                () => toast('تعذّر النسخ', 'danger'),
              )
            }}
          >
            نسخ
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
