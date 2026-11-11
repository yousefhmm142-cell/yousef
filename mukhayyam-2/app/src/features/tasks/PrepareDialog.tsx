import { CheckCheck,PhoneIncoming,UserRound,XCircle } from 'lucide-react'
import { importSubscribers,readSubscribersFile,searchSubscribers,useSubscribers,type Subscriber } from './subscribers'
import { useMemo,useRef,useState } from 'react'
import { useEmployee } from '../../auth/AuthProvider'
import { formatPhone,isValidPhone,normalizePhone } from '../../lib/phone'
import { Dialog } from '../../ui/Dialog'
import { Chip } from '../../ui/form'
import { Button } from '../../ui/primitives'
import { useToast } from '../../ui/Toast'
import { createTask,useTaskTypes } from './repo'
import { errText } from './TaskDialogs'
import { PLACES,placeFor } from './places'
/** A subscriber calls: write down who, what, where and the phone. The technician comes later. */
export function PrepareDialog({ onClose }: { onClose(): void }) {
  const me = useEmployee()
  const toast = useToast()
  const types = useTaskTypes()
  const subscribers = useSubscribers()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [board, setBoard] = useState('')
  const [area, setArea] = useState('')
  const [picked, setPicked] = useState<Subscriber | null>(null)
  const [focus, setFocus] = useState(false)
  const [typeId, setTypeId] = useState<number | null>(null)
  // More than one job for one task: the first chosen is the task's type, the others are written with it.
  const [extraTypes, setExtraTypes] = useState<number[]>([])
  const toggleType = (id: number) => {
    if (typeId === id) { setTypeId(extraTypes[0] ?? null); setExtraTypes(extraTypes.slice(1)) }
    else if (extraTypes.includes(id)) setExtraTypes(extraTypes.filter((x) => x !== id))
    else if (typeId === null) setTypeId(id)
    else setExtraTypes([...extraTypes, id])
  }
  const [details, setDetails] = useState('')
  const [place, setPlace] = useState('')
  const [location, setLocation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const activeTypes = useMemo(() => (types ?? []).filter((t) => t.isActive), [types])
  const matches = useMemo(() => (picked ? [] : searchSubscribers(subscribers, name)), [subscribers, name, picked])
  const nameOf = (id: number | null) => activeTypes.find((t) => t.id === id)?.name ?? ''
  const typeLabel = [typeId, ...extraTypes].map(nameOf).filter(Boolean).join(' + ')
  const fullDetails = [extraTypes.map(nameOf).join(' + '), details.trim()].filter(Boolean).join(' · ')
  const where = [place, board && `طبلون ${board}`, location.trim()].filter(Boolean).join(' · ')

  function choose(s: Subscriber) {
    setPicked(s); setName(s.n); setPhone(s.p); setBoard(s.b); setArea(s.a); setPlace(placeFor(s.a)); setFocus(false)
  }
  function clearPick() {
    setPicked(null); setPhone(''); setBoard(''); setArea('')
  }

  async function save(again: boolean) {
    if (!typeId) return setError('اختر المطلوب.')
    if (phone && !isValidPhone(phone)) return setError('رقم الجوال 10 خانات ويبدأ بـ 059 أو 056.')
    setBusy(true)
    setError(null)
    try {
      const t = await createTask({ typeId, assigneeId: null, details: fullDetails, subscriberName: name, subscriberPhone: phone || null, zoneId: null, location: where, priority: 'normal', expectedMinutes: 30 }, me.id)
      toast(`جُهّزت المهمة ${t.number}، بانتظار فني`)
      if (again) {
        setName(''); clearPick(); setTypeId(null); setExtraTypes([]); setDetails(''); setPlace(''); setLocation(''); setBusy(false)
      } else onClose()
    } catch (e) {
      setError(errText(e))
      setBusy(false)
    }
  }

  const aside = (
    <>
      <h3>ملخص المهمة <span className="aside-tag">قبل الحفظ</span></h3>
      <div>
        <span className="aside-label">المشترك</span>
        <div className="aside-big">{name.trim() || '—'}</div>
      </div>
      <div className="aside-box">
        <div className="aside-row"><span>الجوال</span><b className="num ltr">{phone ? formatPhone(phone) : '—'}</b></div>
        <div className="aside-row"><span>المنطقة</span><b>{area || place || '—'}</b></div>
        <div className="aside-row"><span>الطبلون</span><b className="num">{board || '—'}</b></div>
      </div>
      <div className="aside-box aside-hide-sm">
        <div className="aside-row"><span>المطلوب</span><b>{typeLabel || '—'}</b></div>
        {details.trim() && <div className="aside-row"><span>التفاصيل</span><b>{details.trim()}</b></div>}
        <div className="aside-row"><span>الفني</span><b>يُختار بعدين</b></div>
      </div>
      <div className="aside-note">
        <span>بعد الحفظ بتظهر بـ «مهام مجهّزة بانتظار فني»، ومنها بتنبعت للفني.</span>
        <span><span className="kbd">Ctrl</span> + <span className="kbd">Enter</span> للحفظ</span>
      </div>
    </>
  )

  return (
    <Dialog
      open
      onClose={onClose}
      title="تجهيز مهمة"
      subtitle="سجّل طلب المشترك، والفني بتختاره بعدين."
      icon={<PhoneIncoming size={20} />}
      aside={aside}
      footer={
        <>
          <span className="foot-hint"><span className="kbd">Ctrl</span> + <span className="kbd">Enter</span> للحفظ</span>
          <Button variant="ghost" onClick={onClose}>إلغاء</Button>
          <Button variant="secondary" busy={busy} onClick={() => void save(true)}>حفظ وتجهيز ثانية</Button>
          <Button variant="primary" busy={busy} icon={<CheckCheck size={17} />} onClick={() => void save(false)}>تجهيز المهمة</Button>
        </>
      }
    >
      <div className="form-grid" onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void save(false) }}>
        {picked ? (
          <div className="sub-card">
            <span className="sub-avatar">{picked.n.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('')}</span>
            <span className="sub-main">
              <b>{picked.n}</b>
              <small>{[picked.a, picked.b && `طبلون ${picked.b}`].filter(Boolean).join(' · ') || '—'}</small>
            </span>
            {picked.p && <span className="sub-phone num ltr">{formatPhone(picked.p)}</span>}
            <button type="button" className="icon-btn sm" aria-label="تغيير المشترك" onClick={() => { clearPick(); setName('') }}><XCircle size={16} /></button>
          </div>
        ) : (
          <div className="form-card sub-search">
            <label className="field">
              <span className="form-card-title">اسم المشترك <small>· اكتب اسمين أو أكثر وبتطلع بياناته</small></span>
              <input className="input big" autoFocus value={name} onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 150)}
                onChange={(e) => setName(e.target.value)} placeholder="مثل: محمد أحمد" autoComplete="off"
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.ctrlKey && matches[0]) { e.preventDefault(); choose(matches[0]) } }} />
            </label>
            {focus && matches.length > 0 && (
              <ul className="sub-list" role="listbox">
                {matches.map((s, k) => (
                  <li key={k}>
                    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => choose(s)}>
                      <b>{s.n}</b>
                      <small>{[s.a, s.b && `طبلون ${s.b}`].filter(Boolean).join(' · ')}{s.p && <>{(s.a || s.b) && ' · '}<bdi className="num" dir="ltr">{formatPhone(s.p)}</bdi></>}</small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {!subscribers.length && <span className="field-hint">قائمة المشتركين لسا مش محمّلة. المدير بيرفعها من زر «قائمة المشتركين».</span>}
            <div className="two-col">
              <label className="field">
                <span className="label">رقم الجوال</span>
                <input className="input ltr num" type="tel" inputMode="tel" placeholder="059 000 0000" value={formatPhone(phone)} onChange={(e) => setPhone(normalizePhone(e.target.value))} />
              </label>
              <label className="field">
                <span className="label">الطبلون</span>
                <input className="input num" value={board} onChange={(e) => setBoard(e.target.value)} placeholder="رقم أو اسم الطبلون" />
              </label>
            </div>
          </div>
        )}
        <div className="form-card">
          <span className="form-card-title">المطلوب <small>· بتقدر تختار أكثر من عمل</small></span>
          <div className="chips">
            {activeTypes.map((t) => <Chip key={t.id} pressed={typeId === t.id || extraTypes.includes(t.id)} onClick={() => toggleType(t.id)}>{t.name}</Chip>)}
          </div>
          <input className="input" value={details} onChange={(e) => setDetails(e.target.value)} placeholder="تفاصيل إضافية (اختياري)، مثل: فصل خط + إحضار الساعة" />
        </div>
        <div className="form-card">
          <span className="form-card-title">المكان <small>· اختياري</small></span>
          <div className="two-col">
            <select className="select" aria-label="المكان (اختياري)" value={place} onChange={(e) => setPlace(e.target.value)}>
              <option value="">اختر من القائمة</option>
              {place && !PLACES.includes(place) && <option value={place}>{place}</option>}
              {PLACES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <input className="input" aria-label="وصف إضافي (اختياري)" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="وصف إضافي، مثل: قرب المسجد" />
          </div>
        </div>
        {error && <p className="field-error" role="alert">{error}</p>}
      </div>
    </Dialog>
  )
}

/** The office's list of subscribers, from its Excel file (the manager replaces it whole). */
export function SubscribersButton() {
  const toast = useToast()
  const subscribers = useSubscribers()
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  async function pick(file: File) {
    setBusy(true)
    try {
      const list = await readSubscribersFile(file)
      if (!list.length) throw new Error('empty')
      const n = await importSubscribers(list)
      toast(`تم تحميل ${n} مشترك`)
    } catch (e) {
      const m = e instanceof Error ? e.message : ''
      toast(m === 'frameset' ? 'هذا ملف الإطار فقط. ارفع ملف Excel (xlsx) أو ملف sheet001.htm من مجلد الملفات.' : m === 'no_header' ? 'ما لقيت عمود «الاسم» بالملف.' : m === 'not_allowed' ? 'رفع القائمة للمدير فقط.' : 'تعذّر قراءة الملف.', 'danger')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }
  return (
    <>
      <input ref={input} type="file" accept=".xlsx,.xltx,.xlsm,.csv,.htm,.html" hidden onChange={(e) => e.target.files?.[0] && void pick(e.target.files[0])} />
      <Button variant="ghost" size="lg" busy={busy} icon={<UserRound size={18} />} onClick={() => input.current?.click()}>
        قائمة المشتركين{subscribers.length ? ` (${subscribers.length})` : ''}
      </Button>
    </>
  )
}

