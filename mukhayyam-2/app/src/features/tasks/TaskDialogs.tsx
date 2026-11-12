import { TechnicianPicker } from './TechnicianPicker'
import { sendSharedOrder,SharedSmsError } from './sharedSms'
import { useLiveQuery } from 'dexie-react-hooks'
import { Copy,MessageCircle,MessageSquareText,Plus,XCircle } from 'lucide-react'
import { SubscriberField } from './SubscriberField'
import { FootHint,SummaryAside,saveOnCtrlEnter } from '../../ui/SummaryAside'
import { useEffect,useMemo,useRef,useState } from 'react'
import { useEmployee } from '../../auth/AuthProvider'
import { db } from '../../data/db'
import { formatTime } from '../../lib/format'
import { formatPhone,isValidPhone,normalizePhone } from '../../lib/phone'
import type { Employee } from '../../types'
import { isManagerRole } from '../../types'
import { Dialog } from '../../ui/Dialog'
import { Chip,Segmented } from '../../ui/form'
import { Button,Pill } from '../../ui/primitives'
import { useToast } from '../../ui/Toast'
import { useConfirm } from '../../ui/Confirm'
import { SheetStateError } from '../sheets/workflow'
import { smsUrl,taskLink,taskMessage,taskSms,taskSmsFull,whatsappUrl } from './message'
import { sendCompanySms,smsError } from '../sms/repo'
import {
isSharedTask,durationText,typicalMinutes,
elapsedMinutes,
EXPECTED_OPTIONS,
isOpen,
isOverdue,
priorityInfo,
PRIORITY_OPTIONS,
taskStatusInfo,
type Channel,
type Task,
type TaskPriority
} from './model'
import { assignTask,cancelTask,createTask,recordSent,refreshTasks,useTasks,useTaskTypes } from './repo'
import { SubscriberHistoryNote } from './SubscriberHistoryNote'
import { PLACES,placeFor } from './places'
export const errorText: Record<string, string> = {
  task_waiting_sync:'المهمة بعدها بانتظار المزامنة. لما توصل بتقدر تبعتها.',
  assignment_changed:'الفنيون تغيّروا على المهمة. افتحها من جديد وراجع الأسماء قبل الإرسال.',
  missing_technician_phone:'في فني مش فعّال أو ما إله رقم جوال. راجع الأسماء والأرقام.',
  task_closed:'المهمة انغلقت أو انلغت. ما انبعتت رسالة جديدة.',
  offline: 'المهام تحتاج إنترنت لأنها تُرسل برسالة. اتصل وحاول مرة أخرى.',
}
export class SmsError extends Error {}
export const errText = (e: unknown) => (e instanceof SmsError || e instanceof SharedSmsError ? e.message : errorText[e instanceof SheetStateError ? e.message : ''] ?? 'تعذّر الحفظ. حاول مرة أخرى.')

export function useTechnicians(): Employee[] {
  return (
    useLiveQuery(async () => (await db.employees.toArray()).filter((e) => e.role === 'technician' && e.isActive).sort((a, b) => a.fullName.localeCompare(b.fullName, 'ar')), []) ?? []
  )
}

/**
 * Sends an order. WhatsApp: the full text with the «finished» link. SMS: one short message (no link);
 * the manager's go out from the company's subscription when there is internet, anyone else's (مهند)
 * from his own phone's SMS app, as before.
 */
async function sendOrder(task: Task, channel: Channel, tech: Employee & { phone: string }, names: { type: string; zone?: string | null }, company: boolean): Promise<'company' | 'phone'> {
  const phone = tech.phone
  if (channel === 'sms' && company && navigator.onLine) {
    const r = await sendCompanySms([phone], taskSms(task, names), task.id)
    if (!r.sent) throw new SmsError(`ما انبعتت الرسالة: ${smsError(r.failed[0]?.code ?? '')}`)
    await refreshTasks()
    return 'company'
  }
  // From a phone (مهند): the full order, even if it takes two messages, so the whole name shows.
  const text = channel === 'sms' ? taskSmsFull(task, names) : taskMessage(task, names, taskLink(task.linkToken))
  // Without internet WhatsApp's web link cannot open, but the WhatsApp app itself can (it sends when online); SMS needs no internet.
  const web = whatsappUrl(phone, text, tech.waCode ?? 972)
  const url = channel === 'whatsapp' ? (navigator.onLine ? web : web.replace(/^https:\/\/wa\.me\/(\d+)\?text=/, 'whatsapp://send?phone=$1&text=')) : smsUrl(phone, text)
  // Opened before any waiting, so the browser does not block it as a pop-up.
  const win = channel === 'whatsapp' && navigator.onLine ? window.open('', '_blank') : null
  try {
    await recordSent(task, channel, phone, text)
  } catch (e) {
    win?.close()
    throw e
  }
  if (win) win.location.href = url
  else window.location.href = url
  return 'phone'
}

/** A prepared task goes to a technician, and is sent at once. */
export function GiveDialog({ task, technicians, typeName, zoneName, onClose }: {
  task: Task
  technicians: Employee[]
  typeName(id: number): string
  zoneName(id: number | null): string | null
  onClose(): void
}) {
  const toast = useToast()
  const me = useEmployee()
  const [assigneeIds,setAssigneeIds]=useState<string[]>([])
  const request=useRef<string|null>(null)
  const saved=useRef<Task|null>(null)
  const [locked,setLocked]=useState(false)
  const [priority, setPriority] = useState<TaskPriority>(task.priority)
  const [expected, setExpected] = useState(task.expectedMinutes)
  const [busy, setBusy] = useState<Channel | 'cancel' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const confirm = useConfirm()
  const selected=assigneeIds.map(id=>technicians.find(t=>t.id===id)).filter((p):p is Employee=>!!p)
  const tech=selected[0]
  const shared=selected.length>1
  const selectedNames=selected.map(t=>t.fullName).join('، ')

  async function give(channel: Channel) {
    if (!tech) return setError('اختر الفني.')
    const missing=selected.find(t=>!t.phone)
    if (missing) return setError(`لا يوجد رقم جوال لـ ${missing.fullName}. أضفه من الإعدادات.`)
    setBusy(channel)
    setError(null)
    try {
      const next = saved.current ?? await assignTask(task, tech.id, priority, expected,assigneeIds)
      saved.current=next;setLocked(true)
      const via = shared && channel==='sms' ? await sendSharedOrder(next,request) : await sendOrder(next, channel, { ...tech, phone: tech.phone! }, { type: typeName(next.typeId), zone: zoneName(next.zoneId) }, isManagerRole(me.role))
      toast(via==='already' ? 'الرسالة مُرسلة للفنيين من قبل، ما كرّرنا الإرسال.' : `أُرسلت المهمة ${next.number} إلى ${selectedNames}${via === 'company' ? ' · SMS من اشتراك الشركة' : ''}`)
      onClose()
    } catch (e) {
      setError(errText(e))
      setBusy(null)
    }
  }

  async function cancel() {
    if (busy) return
    const yes = await confirm({ title: `إلغاء المهمة ${task.number}؟`, confirmLabel: 'أوكي', danger: true })
    if (!yes) return
    setBusy('cancel')
    try {
      await cancelTask(task)
      toast(`أُلغيت المهمة ${task.number}`)
      onClose()
    } catch (e) {
      setError(errText(e))
      setBusy(null)
    }
  }

  const aside = (
    <SummaryAside
      title="ملخص الإرسال"
      tag={`مهمة ${task.number}`}
      bigLabel="الفني"
      big={selectedNames || 'اختر الفنيين'}
      rows={[['المطلوب', typeName(task.typeId)], ['المشترك', task.subscriberName], ['الجوال', task.subscriberPhone ? <bdi dir="ltr">{formatPhone(task.subscriberPhone)}</bdi> : ''], ['المكان', [zoneName(task.zoneId), task.location].filter(Boolean).join(' · ')]]}
      more={[['الأولوية', priorityInfo[priority].label], ['المدة المتوقعة', durationText(expected)]]}
      note={<span>{shared ? 'نفس الرسالة لكل الفنيين من رصيد الشركة؛ رسالة لكل رقم. المكتب بيسجّل الإنجاز.' : 'بيفتح واتساب أو الرسائل والنص جاهز.'}</span>}
    />
  )

  return (
    <Dialog
      open
      onClose={onClose}
      title={`أعطِ المهمة ${task.number} للفنيين`}
      subtitle="اختر فني أو أكثر وابعتها بضغطة."
      icon={<MessageCircle size={20} />}
      aside={aside}
      footer={
        <>
          <FootHint />
          <Button variant="ghost" busy={busy === 'cancel'} disabled={!!busy} onClick={() => void cancel()}>إلغاء الطلب</Button>
          <Button variant="primary" icon={<MessageSquareText size={17} />} busy={busy === 'sms'} disabled={!!busy} onClick={() => void give('sms')}>{shared ? 'SMS للكل من رصيد الشركة' : 'SMS'}</Button>
          <Button variant="secondary" icon={<MessageCircle size={17} />} busy={busy === 'whatsapp'} disabled={!!busy || shared} title={shared ? 'المهمة المشتركة تُرسل SMS من رصيد الشركة' : undefined} onClick={() => void give('whatsapp')}>إرسال واتساب</Button>
        </>
      }
    >
      <fieldset className="form-grid task-compose-fields" disabled={!!busy || locked} onKeyDown={saveOnCtrlEnter(() => void give('sms'))}>
        <div className="prep-summary">
          <b>{typeName(task.typeId)}{task.details && ` · ${task.details}`}</b>
          <span>{[task.subscriberName, task.subscriberPhone && formatPhone(task.subscriberPhone), zoneName(task.zoneId), task.location].filter(Boolean).join(' · ') || 'بدون تفاصيل المشترك'}</span>
          {task.subscriberName && <a className="link-btn" href={`/subscriber?${new URLSearchParams({ name: task.subscriberName, ...(task.subscriberPhone ? { phone: task.subscriberPhone } : {}) })}`} target="_blank" rel="noreferrer">شو صار لهالمشترك قبل؟</a>}
        </div>
        <SubscriberHistoryNote name={task.subscriberName ?? ''} phone={task.subscriberPhone} exceptId={task.id} />
        <TechnicianPicker technicians={technicians} value={assigneeIds} onChange={setAssigneeIds} />
        <div className="field">
          <span className="label">الأولوية</span>
          <Segmented<TaskPriority> label="الأولوية" value={priority} options={PRIORITY_OPTIONS} onChange={setPriority} />
        </div>
        <div className="field">
          <span className="label">المدة المتوقعة</span>
          <div className="chips">
            {EXPECTED_OPTIONS.map((m) => <Chip key={m} pressed={expected === m} onClick={() => setExpected(m)}>{durationText(m)}</Chip>)}
          </div>
          <ExpectedHint typeId={task.typeId} />
        </div>
        {error && <p className="field-error" role="alert">{error}</p>}
      </fieldset>
    </Dialog>
  )
}

export function NewTaskDialog({ technicians, onClose, typeName, zoneName }: {
  technicians: Employee[]
  onClose(): void
  typeName(id: number): string
  zoneName(id: number | null): string | null
}) {
  const me = useEmployee()
  const toast = useToast()
  const types = useTaskTypes()
  const [typeId, setTypeId] = useState<number | null>(null)
  // More than one job for one task: the first chosen is the task's type, the others are written with it.
  const [extraTypes, setExtraTypes] = useState<number[]>([])
  const toggleType = (id: number) => {
    if (typeId === id) { setTypeId(extraTypes[0] ?? null); setExtraTypes(extraTypes.slice(1)) }
    else if (extraTypes.includes(id)) setExtraTypes(extraTypes.filter((x) => x !== id))
    else if (typeId === null) setTypeId(id)
    else setExtraTypes([...extraTypes, id])
  }
  const [assigneeIds,setAssigneeIds]=useState<string[]>([])
  const request=useRef<string|null>(null)
  const saved=useRef<Task|null>(null)
  const [locked,setLocked]=useState(false)
  const [details, setDetails] = useState('')
  const [subscriberName, setSubscriberName] = useState('')
  const [subscriberPhone, setSubscriberPhone] = useState('')
  const [place, setPlace] = useState('')
  const [location, setLocation] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('normal')
  const [expected, setExpectedRaw] = useState(30)
  // The time follows the usual one for the chosen kind, until it is picked by hand.
  const touched = useRef(false)
  const setExpected = (m: number) => { touched.current = true; setExpectedRaw(m) }
  const allTasks = useTasks()
  useEffect(() => {
    if (touched.current || typeId === null) return
    setExpectedRaw(typicalMinutes(allTasks ?? [], typeId) ?? 30)
  }, [typeId, allTasks])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<Channel | null>(null)

  const selected=assigneeIds.map(id=>technicians.find(t=>t.id===id)).filter((p):p is Employee=>!!p)
  const tech=selected[0]
  const shared=selected.length>1
  const selectedNames=selected.map(t=>t.fullName).join('، ')
  const activeTypes = useMemo(() => (types ?? []).filter((t) => t.isActive), [types])

  async function save(channel: Channel) {
    if (!typeId) return setError('اختر نوع المهمة.')
    if (!tech) return setError('اختر الفني.')
    const missing=selected.find(t=>!t.phone)
    if (missing) return setError(`لا يوجد رقم جوال لـ ${missing.fullName}. أضفه من الإعدادات.`)
    if (subscriberPhone && !isValidPhone(subscriberPhone)) return setError('رقم المشترك 10 خانات ويبدأ بـ 059 أو 056.')
    setBusy(channel)
    setError(null)
    try {
      const task = saved.current ?? await createTask(
        { typeId, assigneeId: tech.id, assigneeIds, details: [extraTypes.map((x) => activeTypes.find((t) => t.id === x)?.name ?? '').filter(Boolean).join(' + '), details.trim()].filter(Boolean).join(' · '), subscriberName, subscriberPhone: subscriberPhone || null, zoneId: null, location: [place, location.trim()].filter(Boolean).join(' · '), priority, expectedMinutes: expected },
        me.id,
      )
      saved.current=task;setLocked(true)
      const via = shared && channel==='sms' ? await sendSharedOrder(task,request) : await sendOrder(task, channel, { ...tech, phone: tech.phone! }, { type: typeName(task.typeId), zone: zoneName(task.zoneId) }, isManagerRole(me.role))
      toast(via==='already' ? 'الرسالة مُرسلة للفنيين من قبل، ما كرّرنا الإرسال.' : `أُرسلت المهمة ${task.number} إلى ${selectedNames}${via === 'company' ? ' · SMS من اشتراك الشركة' : ''}`)
      onClose()
    } catch (e) {
      setError(errText(e))
      setBusy(null)
    }
  }

  const aside = (
    <SummaryAside
      title="ملخص المهمة"
      bigLabel="الفني"
      big={selectedNames || 'اختر الفنيين'}
      rows={[['المطلوب', [typeId, ...extraTypes].map((x) => activeTypes.find((t) => t.id === x)?.name ?? '').filter(Boolean).join(' + ')], ['المشترك', subscriberName.trim()], ['الجوال', subscriberPhone ? <bdi dir="ltr">{formatPhone(subscriberPhone)}</bdi> : ''], ['المكان', [place, location.trim()].filter(Boolean).join(' · ')]]}
      more={[['الأولوية', priorityInfo[priority].label], ['المدة المتوقعة', durationText(expected)]]}
      note={<span>{shared ? 'مهمة مشتركة: نفس SMS لكل الفنيين من رصيد الشركة، والمكتب بيسجّل الإنجاز.' : 'واتساب: الرسالة كاملة. SMS: من اشتراك الشركة أو جوالك.'}</span>}
    />
  )

  return (
    <Dialog
      open
      onClose={onClose}
      title="مهمة جديدة"
      subtitle="اختر فني أو أكثر والمطلوب، وابعتها بضغطة."
      icon={<Plus size={20} />}
      aside={aside}
      footer={
        <>
          <FootHint />
          <Button variant="ghost" onClick={onClose}>إلغاء</Button>
          <Button variant="primary" icon={<MessageSquareText size={17} />} busy={busy === 'sms'} disabled={!!busy} onClick={() => void save('sms')}>{shared ? 'SMS للكل من رصيد الشركة' : 'SMS'}</Button>
          <Button variant="secondary" icon={<MessageCircle size={17} />} busy={busy === 'whatsapp'} disabled={!!busy || shared} title={shared ? 'المهمة المشتركة تُرسل SMS من رصيد الشركة' : undefined} onClick={() => void save('whatsapp')}>إرسال واتساب</Button>
        </>
      }
    >
      <fieldset className="form-grid task-compose-fields" disabled={!!busy || locked} onKeyDown={saveOnCtrlEnter(() => void save('sms'))}>
        <TechnicianPicker technicians={technicians} value={assigneeIds} onChange={setAssigneeIds} />
        <div className="field">
          <span className="label">نوع المهمة <small className="muted">· بتقدر تختار أكثر من عمل</small></span>
          <div className="chips">
            {activeTypes.map((t) => (
              <Chip key={t.id} pressed={typeId === t.id || extraTypes.includes(t.id)} onClick={() => toggleType(t.id)}>{t.name}</Chip>
            ))}
          </div>
        </div>
        <label className="field">
          <span className="label">التفاصيل</span>
          <textarea className="textarea" rows={3} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="ماذا يعمل بالضبط؟" />
        </label>
        <div className="two-col">
          <SubscriberField label="اسم المشترك (اختياري)" value={subscriberName} onChange={setSubscriberName} onPick={(x) => { if (x.p) setSubscriberPhone(x.p); setPlace(placeFor(x.a)); if (x.b) setDetails((d) => d || `طبلون ${x.b}`) }} placeholder="اكتب اسمين وبتطلع بياناته" />
          <label className="field">
            <span className="label">جوال المشترك (اختياري)</span>
            <input className="input ltr num" type="tel" inputMode="tel" placeholder="059 000 0000" value={formatPhone(subscriberPhone)} onChange={(e) => setSubscriberPhone(normalizePhone(e.target.value))} />
          </label>
        </div>
        <SubscriberHistoryNote name={subscriberName} phone={subscriberPhone || null} />
        <div className="two-col">
          <label className="field">
            <span className="label">المكان (اختياري)</span>
            <select className="select" value={place} onChange={(e) => setPlace(e.target.value)}>
              <option value="">اختر من القائمة</option>
              {place && !PLACES.includes(place) && <option value={place}>{place}</option>}
              {PLACES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="label">وصف إضافي (اختياري)</span>
            <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="مثل: قرب المسجد" />
          </label>
        </div>
        <div className="field">
          <span className="label">الأولوية</span>
          <Segmented<TaskPriority> label="الأولوية" value={priority} options={PRIORITY_OPTIONS} onChange={setPriority} />
        </div>
        <div className="field">
          <span className="label">المدة المتوقعة</span>
          <div className="chips">
            {EXPECTED_OPTIONS.map((m) => (
              <Chip key={m} pressed={expected === m} onClick={() => setExpected(m)}>{durationText(m)}</Chip>
            ))}
          </div>
          {typeId !== null && <ExpectedHint typeId={typeId} />}
          <span className="field-hint">بعدها تظهر المهمة «تجاوزت وقتها» عندك.</span>
        </div>
        {error && <p className="field-error" role="alert">{error}</p>}
      </fieldset>
    </Dialog>
  )
}

export function TaskDialog({ task, tech, participants, typeName, zoneName, now, onClose }: {
  task: Task
  tech: Employee | undefined
  participants: Employee[]
  typeName: string
  zoneName: string | null
  now: Date
  onClose(): void
}) {
  const request=useRef<string|null>(null)
  const toast = useToast()
  const me = useEmployee()
  const [busy, setBusy] = useState<string | null>(null)
  const confirm = useConfirm()
  const link = taskLink(task.linkToken)
  const text = taskMessage(task, { type: typeName, zone: zoneName }, link)
  const open = isOpen(task)

  async function send(channel: Channel) {
    if (!tech?.phone) return toast('لا يوجد رقم جوال لهذا الفني', 'danger')
    setBusy(channel)
    try {
      const via = isSharedTask(task) && channel==='sms' ? await sendSharedOrder(task,request) : await sendOrder(task, channel, { ...tech, phone: tech.phone! }, { type: typeName, zone: zoneName }, isManagerRole(me.role))
      if (via === 'already') toast('الرسالة مُرسلة من قبل، ما كرّرنا الإرسال.')
      else if (via === 'company') toast(`انبعتت SMS لـ ${participants.map(p=>p.fullName).join("، ")} من اشتراك الشركة`)
    } catch (e) {
      toast(errText(e), 'danger')
    } finally {
      setBusy(null)
    }
  }

  async function cancel() {
    if (busy) return
    const yes = await confirm({ title: `إلغاء المهمة ${task.number}؟`, confirmLabel: 'أوكي', danger: true })
    if (!yes) return
    setBusy('cancel')
    try {
      await cancelTask(task)
      toast(`أُلغيت المهمة ${task.number}`)
      onClose()
    } catch (e) {
      toast(errText(e), 'danger')
      setBusy(null)
    }
  }

  const steps: Array<[string, string | null]> = [
    ['أُنشئت', task.createdAt],
    ['أُرسلت', task.sentAt],
    ['فتحها الفني', task.seenAt],
    ['بدأ العمل', task.startedAt && task.startedAt !== task.completedAt ? task.startedAt : null],
    ['أنهاها', task.completedAt],
    ['أُلغيت', task.cancelledAt],
  ]

  return (
    <Dialog open onClose={onClose} title={`مهمة${isSharedTask(task) ? ' مشتركة' : ''} ${task.number} · ${typeName}`} >
      <div className="task-detail">
        <div className="task-detail-head">
          <Pill tone={isOverdue(task, now) ? 'danger' : taskStatusInfo[task.status].tone}>
            {isOverdue(task, now) ? 'تجاوزت وقتها' : taskStatusInfo[task.status].label}
          </Pill>
          {task.priority !== 'normal' && <Pill tone={priorityInfo[task.priority].tone}>{priorityInfo[task.priority].label}</Pill>}
          <span className="muted num">
            {task.status === 'done' ? `أخذت ${durationText(elapsedMinutes(task, now))}` : task.status !== 'new' && open ? `${durationText(elapsedMinutes(task, now))} من ${durationText(task.expectedMinutes)}` : `المتوقع ${durationText(task.expectedMinutes)}`}
          </span>
        </div>

        <dl className="task-facts">
          {tech && <div><dt>الفنيون</dt><dd>{participants.map(p=>p.fullName).join('، ')}{!isSharedTask(task) && tech.phone && <> · <span className="num ltr">{formatPhone(tech.phone)}</span></>}</dd></div>}
          {task.details && <div><dt>التفاصيل</dt><dd>{task.details}</dd></div>}
          {(task.subscriberName || task.subscriberPhone) && (
            <div><dt>المشترك</dt><dd>{task.subscriberName}{task.subscriberPhone && <>{task.subscriberName ? ' · ' : ''}<span className="num ltr">{formatPhone(task.subscriberPhone)}</span></>}</dd></div>
          )}
          {(zoneName || task.location) && <div><dt>المكان</dt><dd>{[zoneName, task.location].filter(Boolean).join(' · ')}</dd></div>}
          {task.completionNotes && <div><dt>ملاحظة الفني</dt><dd>{task.completionNotes}</dd></div>}
          {task.cancelReason && <div><dt>سبب الإلغاء</dt><dd>{task.cancelReason}</dd></div>}
        </dl>

        <ol className="task-steps">
          {steps.filter(([, at]) => at).map(([label, at]) => (
            <li key={label}><span>{label}</span><b className="num">{formatTime(new Date(at!))}</b></li>
          ))}
        </ol>

        {open && (
          <div className="task-actions">
            <Button variant="primary" icon={<MessageSquareText size={17} />} busy={busy === 'sms'} onClick={() => void send('sms')}>{isSharedTask(task) ? 'SMS للكل من رصيد الشركة' : 'SMS'}</Button>
            <Button variant="secondary" icon={<MessageCircle size={17} />} busy={busy === 'whatsapp'} disabled={!!busy || isSharedTask(task)} onClick={() => void send('whatsapp')}>
              {task.status === 'new' ? 'إرسال واتساب' : 'إعادة على واتساب'}
            </Button>
            <Button
              variant="ghost"
              icon={<Copy size={16} />}
              onClick={() => void navigator.clipboard?.writeText(text).then(() => toast('نُسخت الرسالة'), () => toast('تعذّر النسخ', 'danger'))}
            >
              نسخ الرسالة
            </Button>
          </div>
        )}

        {open && (
          <div className="task-cancel">
            <Button variant="ghost" icon={<XCircle size={16} />} busy={busy === 'cancel'} disabled={!!busy} onClick={() => void cancel()}>إلغاء المهمة</Button>
          </div>
        )}
      </div>
    </Dialog>
  )
}


/** «المعتاد لهالنوع: 45 دقيقة» under the time choices, once enough tasks of the kind are done. */
function ExpectedHint({ typeId }: { typeId: number }) {
  const tasks = useTasks()
  const m = typicalMinutes(tasks ?? [], typeId)
  return m ? <span className="expected-hint">المعتاد لهالنوع (من آخر المهام المنجزة): <b className="num">{durationText(m)}</b></span> : null
}
