import { useLiveQuery } from 'dexie-react-hooks'
import { Copy, KeyRound, MessageCircle, Pencil, Plus, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useEmployee } from '../../auth/AuthProvider'
import { isDemo } from '../../config'
import { byRoleThenName, saveEmployee } from '../../data/admin'
import { codeHolders, setAttendance as saveAttendance } from '../attendance/repo'
import { db } from '../../data/db'
import { formatPhone, isValidPhone, normalizePhone, toLatinDigits } from '../../lib/phone'
import { isManagerRole, isSiteRole, roleLabel, titleOf, type Employee, type Role } from '../../types'
import { clock12 } from '../../lib/format'

const waCodes = [
  { value: '972', label: '+972' },
  { value: '970', label: '+970' },
] as const
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

/** Only the manager, the admin and the site sign in; technicians get orders by message, staff use the office QR. */
const usesApp = (role: Role, canSeals = false) => isManagerRole(role) || isSiteRole(role) || canSeals

const randomPin = () => String(crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000).padStart(6, '0')
const randomCode = () => String(crypto.getRandomValues(new Uint32Array(1))[0]! % 10_000).padStart(4, '0')

/** Everyone on the team, their phone, and whether they can sign in. */
export function TeamCard() {
  const people = useLiveQuery(async () => (await db.employees.toArray()).sort(byRoleThenName), [])
  const [editing, setEditing] = useState<Employee | 'new' | null>(null)
  const [holders, setHolders] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (!editing) void codeHolders().then(setHolders)
  }, [editing])

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
                  {titleOf(e)}
                  {e.jobTitle && e.role !== 'technician' && e.role !== 'staff' && <> · {roleLabel[e.role]}</>}
                  {e.phone && <> · <span className="num ltr">{formatPhone(e.phone)}</span></>}
                </small>
              </span>
              {!e.isActive ? (
                <Pill>موقوف</Pill>
              ) : usesApp(e.role, e.canSeals) ? (
                e.hasLogin ? <Pill tone="ok">يدخل بجواله</Pill> : <Pill tone="warn">بدون دخول</Pill>
              ) : e.phone ? (
                <Pill dot={false}>{e.role === 'technician' ? 'تصله المهام برسالة' : 'بدون تطبيق'}</Pill>
              ) : (
                <Pill tone="warn">بدون رقم جوال</Pill>
              )}
              <button type="button" className="icon-btn" aria-label={`تعديل ${e.fullName}`} onClick={() => setEditing(e)}>
                <Pencil size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing && <EmployeeDialog person={editing === 'new' ? null : editing} hasCode={editing !== 'new' && holders.has(editing.id)} onClose={() => setEditing(null)} />}
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

function EmployeeDialog({ person, hasCode, onClose }: { person: Employee | null; hasCode: boolean; onClose(): void }) {
  const me = useEmployee()
  const toast = useToast()
  const [name, setName] = useState(person?.fullName ?? '')
  const [role, setRole] = useState<Role>(person?.role ?? 'technician')
  const [phone, setPhone] = useState(person?.phone ?? '')
  const [jobTitle, setJobTitle] = useState(person?.jobTitle ?? '')
  const [canSeals, setCanSeals] = useState<'yes' | 'no'>(person?.canSeals ? 'yes' : 'no')
  const [waCode, setWaCode] = useState<'972' | '970'>(person?.waCode === 970 ? '970' : '972')
  // New people get a PIN ready to hand over; existing logins keep theirs unless changed.
  const [pin, setPin] = useState(person?.hasLogin ? '' : randomPin())
  const [changePin, setChangePin] = useState(!person?.hasLogin)
  const [attendance, setAttendance] = useState<'yes' | 'no'>(person?.tracksAttendance === false ? 'no' : 'yes')
  const [active, setActive] = useState<'on' | 'off'>(person?.isActive === false ? 'off' : 'on')
  const schedules = useLiveQuery(() => db.schedules.toArray(), [])
  const [scheduleId, setScheduleId] = useState<number | null>(person?.scheduleId ?? null)
  // Everyone who records attendance needs a 4-digit code for the first scan on their phone.
  const [attCode, setAttCode] = useState(hasCode ? '' : randomCode())
  const [changeCode, setChangeCode] = useState(!hasCode)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [handover, setHandover] = useState<{ name: string; phone: string; pin: string | null; code: string | null; waCode: 970 | 972 } | null>(null)

  const self = person?.id === me.id

  async function save() {
    const newPin = usesApp(role, canSeals === 'yes') && changePin && phone ? pin : null
    if (newPin !== null && !/^\d{6}$/.test(pin)) return setError(errorText.bad_pin!)
    if (phone && !isValidPhone(phone)) return setError(errorText.bad_phone!)
    const newCode = attendance === 'yes' && changeCode ? attCode : null
    if (newCode !== null && !/^\d{4}$/.test(newCode)) return setError('رمز الحضور 4 أرقام.')
    setBusy(true)
    setError(null)
    try {
      const id = await saveEmployee({
        id: person?.id,
        fullName: name,
        role,
        phone: phone || null,
        pin: newPin,
        isActive: active === 'on',
        tracksAttendance: attendance === 'yes',
        jobTitle: jobTitle.trim() || null,
        canSeals: canSeals === 'yes',
        waCode: Number(waCode) as 970 | 972,
      })
      if (attendance === 'yes') await saveAttendance(id, scheduleId ?? schedules?.[0]?.id ?? null, newCode)
      if (newPin || newCode) {
        setHandover({ name: name.trim(), phone, pin: newPin, code: newCode, waCode: Number(waCode) as 970 | 972 })
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
          {(role === 'admin' || role === 'manager') && !self && <span className="field-hint">مسؤول النظام والمدير: كل الصلاحيات.</span>}
        </label>
        <TextField label="المسمى الوظيفي (اختياري)" value={jobTitle} onChange={setJobTitle} placeholder="مثل: نائب المدير، محاسبة، فني" />
        {role === 'staff' && (
          <div className="field">
            <span className="label">صلاحية الأختام</span>
            <Segmented<'yes' | 'no'> label="صلاحية الأختام" value={canSeals} options={yesNo} onChange={setCanSeals} />
            <span className="field-hint">
              {canSeals === 'yes'
                ? 'تفتح لها صفحتا «صرف الأختام» و«سجل الأختام» فقط. تحتاج رقم جوال ورمزاً سرياً للدخول.'
                : 'المدير ومسؤول النظام لديهم هذه الصلاحية دائماً.'}
            </span>
          </div>
        )}
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
          <span className="field-hint">{usesApp(role, canSeals === 'yes') ? 'يدخل به للتطبيق.' : role === 'technician' ? 'تصله عليه أوامر المهام على واتساب أو SMS.' : 'للتواصل.'}</span>
        </label>
        {phone && (
          <div className="field">
            <span className="label">مقدمة الواتساب</span>
            <Segmented<'972' | '970'> label="مقدمة الواتساب" value={waCode} options={waCodes} onChange={setWaCode} />
            <span className="field-hint">حسب ما سجّل الموظف واتسابه. إذا ما فتح الرابط محادثته، جرّب الثانية.</span>
          </div>
        )}
        {phone && usesApp(role, canSeals === 'yes') && (
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
        {attendance === 'yes' && (
          <>
            <div className="field">
              <span className="label">الدوام</span>
              <Segmented<string>
                label="الدوام"
                value={String(scheduleId ?? schedules?.[0]?.id ?? '')}
                options={(schedules ?? []).map((s) => ({ value: String(s.id), label: `${s.name} (${clock12(s.start)} – ${clock12(s.end)})` }))}
                onChange={(v) => setScheduleId(Number(v))}
              />
            </div>
            <div className="field">
              <span className="label">رمز الحضور</span>
              {changeCode ? (
                <div className="pin-row">
                  <input
                    className="input ltr num pin-plain"
                    inputMode="numeric"
                    maxLength={4}
                    aria-label="رمز الحضور"
                    value={attCode}
                    onChange={(e) => setAttCode(toLatinDigits(e.target.value).replace(/\D/g, '').slice(0, 4))}
                  />
                  <Button variant="ghost" icon={<KeyRound size={16} />} onClick={() => setAttCode(randomCode())}>رمز جديد</Button>
                </div>
              ) : (
                <Button variant="secondary" icon={<KeyRound size={16} />} onClick={() => { setChangeCode(true); setAttCode(randomCode()) }}>
                  تغيير رمز الحضور
                </Button>
              )}
              <span className="field-hint">4 أرقام يكتبها أول مرة يصوّر ورقة الحضور على جواله.</span>
            </div>
          </>
        )}
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
function Handover({ name, phone, pin, code, waCode, onClose }: { name: string; phone: string; pin: string | null; code: string | null; waCode: 970 | 972; onClose(): void }) {
  const toast = useToast()
  const link = isDemo ? '' : window.location.origin
  const lines = [`مرحباً ${name}،`]
  if (pin) lines.push('هذا حسابك في نظام مخيم 2:', `رقم الجوال: ${phone}`, `الرمز السري: ${pin}`, ...(link ? [`الرابط: ${link}`, `تطبيق الأندرويد: ${link}/mukhayyam2.apk`] : []))
  if (code) lines.push(`رمز الحضور: ${code}`, 'أول مرة تصوّر ورقة الحضور في المكتب: اختر اسمك واكتب هذا الرمز. بعدها كل تصويرة تسجّل لحالها.')
  const message = lines.join('\n')
  const wa = phone ? `https://wa.me/${waCode}${phone.slice(1)}?text=${encodeURIComponent(message)}` : ''

  return (
    <Dialog
      open
      onClose={onClose}
      title="حُفظ. أعطِ الموظف بياناته"
      footer={<Button variant="primary" onClick={onClose}>تم</Button>}
    >
      <div className="handover">
        <p className="muted">{pin ? `${name} يدخل للتطبيق برقمه ورمزه السري.` : ''}{code ? ' رمز الحضور لأول تصويرة على جواله فقط.' : ''}</p>
        <dl>
          {pin && <div><dt>رقم الجوال</dt><dd className="num ltr">{formatPhone(phone)}</dd></div>}
          {pin && <div><dt>الرمز السري</dt><dd className="num ltr pin-big">{pin}</dd></div>}
          {code && <div><dt>رمز الحضور</dt><dd className="num ltr pin-big">{code}</dd></div>}
        </dl>
        <div className="handover-actions">
          {wa && (
            <a className="btn primary" href={wa} target="_blank" rel="noreferrer">
              <MessageCircle size={17} /> إرسال على واتساب
            </a>
          )}
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
