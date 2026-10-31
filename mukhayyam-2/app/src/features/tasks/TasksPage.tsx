import { useLiveQuery } from 'dexie-react-hooks'
import { AlarmClock, CheckCheck, Copy, Hammer, ListChecks, MessageCircle, MessageSquareText, Plus, TimerReset, Trash2, XCircle } from 'lucide-react'
import { formatAmount, parseDecimal } from '../../lib/numbers'
import { addMove, deleteMove } from '../stock/repo'
import { taskMatrix } from '../reports/build'
import { ReportTable } from '../reports/ReportsPage'
import { useEffect, useMemo, useState } from 'react'
import { useEmployee } from '../../auth/AuthProvider'
import { db } from '../../data/db'
import { toISODate, todayISO } from '../../lib/dates'
import { formatTime } from '../../lib/format'
import { formatPhone, isValidPhone, normalizePhone } from '../../lib/phone'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { useNow } from '../../lib/useNow'
import type { Employee } from '../../types'
import { Dialog } from '../../ui/Dialog'
import { Chip, Segmented } from '../../ui/form'
import { Avatar, Button, Pill } from '../../ui/primitives'
import { useToast } from '../../ui/Toast'
import { useZones } from '../distribution/repo'
import { useConfirmTap } from '../sheets/useDraft'
import { SheetStateError } from '../sheets/workflow'
import { smsUrl, taskLink, taskMessage, whatsappUrl } from './message'
import {
  durationText,
  elapsedMinutes,
  EXPECTED_OPTIONS,
  isOpen,
  isOverdue,
  priorityInfo,
  PRIORITY_OPTIONS,
  taskStatusInfo,
  type Channel,
  type Task,
  type TaskPriority,
} from './model'
import { cancelTask, createTask, recordSent, refreshTasks, useTasks, useTaskTypes } from './repo'

const errorText: Record<string, string> = {
  offline: 'المهام تحتاج إنترنت لأنها تُرسل برسالة. اتصل وحاول مرة أخرى.',
  reason_needed: 'اكتب سبب الإلغاء.',
}
const errText = (e: unknown) => errorText[e instanceof SheetStateError ? e.message : ''] ?? 'تعذّر الحفظ. حاول مرة أخرى.'

type View = 'open' | 'today' | 'all'
const views = [
  { value: 'open', label: 'المفتوحة' },
  { value: 'today', label: 'أُنجزت اليوم' },
  { value: 'all', label: 'آخر 30 يوماً' },
] as const

function useTechnicians(): Employee[] {
  return (
    useLiveQuery(async () => (await db.employees.toArray()).filter((e) => e.role === 'technician' && e.isActive).sort((a, b) => a.fullName.localeCompare(b.fullName, 'ar')), []) ?? []
  )
}

/** Sends an order: opens WhatsApp (new tab) or the SMS app with the text ready, then marks it sent. */
async function sendOrder(task: Task, channel: Channel, tech: Employee & { phone: string }, text: string) {
  const phone = tech.phone
  const url = channel === 'whatsapp' ? whatsappUrl(phone, text, tech.waCode ?? 972) : smsUrl(phone, text)
  // Opened before any waiting, so the browser does not block it as a pop-up.
  const win = channel === 'whatsapp' ? window.open('', '_blank') : null
  try {
    await recordSent(task, channel, phone, text)
  } catch (e) {
    win?.close()
    throw e
  }
  if (win) win.location.href = url
  else window.location.href = url
}

export function TasksPage() {
  useDocumentTitle('المهام الميدانية')
  const tasks = useTasks()
  const types = useTaskTypes()
  const zones = useZones()
  const technicians = useTechnicians()
  const now = useNow(30_000)
  const [view, setView] = useState<View>('open')
  const [who, setWho] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  // Fresh from the server while this screen is open: a finished task shows up within seconds.
  useEffect(() => {
    void refreshTasks()
    const id = window.setInterval(() => document.visibilityState === 'visible' && void refreshTasks(), 10_000)
    return () => window.clearInterval(id)
  }, [])

  const today = todayISO()
  const all = tasks ?? []
  const open = all.filter(isOpen)
  const doneToday = all.filter((t) => t.status === 'done' && t.completedAt && toISODate(new Date(t.completedAt)) === today)
  const late = open.filter((t) => isOverdue(t, now))
  const working = open.filter((t) => t.status === 'in_progress' || t.status === 'seen')
  const avgToday = doneToday.length ? Math.round(doneToday.reduce((n, t) => n + elapsedMinutes(t, now), 0) / doneToday.length) : null

  const shown = (view === 'open' ? open : view === 'today' ? doneToday : all).filter((t) => !who || t.assigneeId === who)
  const typeName = (id: number) => types?.find((t) => t.id === id)?.name ?? 'مهمة'
  const zoneName = (id: number | null) => (id ? zones?.find((z) => z.id === id)?.name ?? null : null)
  const person = (id: string) => technicians.find((e) => e.id === id)
  const openTask = all.find((t) => t.id === openId) ?? null

  return (
    <div className="tasks">
      <header className="ph">
        <div>
          <h1>المهام الميدانية</h1>
          <p className="muted">اكتب الأوردر، يصل للفني على واتساب أو SMS، وتعرف متى أنهاه.</p>
        </div>
        <Button variant="primary" size="lg" icon={<Plus size={18} />} onClick={() => setCreating(true)} className="ph-action">
          مهمة جديدة
        </Button>
      </header>

      <div className="kpis">
        <div className="kpi hero">
          <div className="kpi-label"><span className="kpi-ico"><ListChecks size={16} /></span>المفتوحة</div>
          <div className="kpi-value num">{open.length}<small>مهمة</small></div>
          <div className="kpi-sub">{working.length} عند الفنيين الآن</div>
        </div>
        <div className="kpi glass" data-tone={late.length ? 'danger' : undefined}>
          <div className="kpi-label"><span className="kpi-ico"><AlarmClock size={16} /></span>متأخرة</div>
          <div className="kpi-value num">{late.length}</div>
          <div className="kpi-sub">تجاوزت المدة التي حددتها</div>
        </div>
        <div className="kpi glass">
          <div className="kpi-label"><span className="kpi-ico"><CheckCheck size={16} /></span>أُنجزت اليوم</div>
          <div className="kpi-value num">{doneToday.length}</div>
          <div className="kpi-sub">{avgToday !== null ? `متوسط المدة ${durationText(avgToday)}` : 'لا شيء بعد'}</div>
        </div>
        <div className="kpi glass">
          <div className="kpi-label"><span className="kpi-ico"><Hammer size={16} /></span>الفنيون</div>
          <div className="kpi-value num">{technicians.length}</div>
          <div className="kpi-sub">{technicians.filter((t) => !t.phone).length ? `${technicians.filter((t) => !t.phone).length} بدون رقم جوال` : 'كلهم برقم جوال'}</div>
        </div>
      </div>

      <div className="task-filters">
        <Segmented<View> label="عرض المهام" value={view} options={views} onChange={setView} />
        <div className="chips">
          <Chip pressed={!who} onClick={() => setWho(null)}>الكل</Chip>
          {technicians.map((t) => (
            <Chip key={t.id} pressed={who === t.id} onClick={() => setWho(who === t.id ? null : t.id)}>
              {t.fullName}
              {open.some((x) => x.assigneeId === t.id) && <span className="chip-count num">{open.filter((x) => x.assigneeId === t.id).length}</span>}
            </Chip>
          ))}
        </div>
      </div>

      {!tasks ? (
        <div className="loading-block" aria-busy="true" />
      ) : shown.length === 0 ? (
        <div className="empty card">
          <h3>{view === 'open' ? 'لا مهام مفتوحة' : view === 'today' ? 'لم تُنجز مهام اليوم بعد' : 'لا مهام'}</h3>
          <p>اضغط «مهمة جديدة»، اختر الفني ونوع العمل، وأرسلها بضغطة.</p>
        </div>
      ) : (
        <ul className="task-list">
          {shown.map((t) => {
            const tech = person(t.assigneeId)
            const mins = elapsedMinutes(t, now)
            const overdue = isOverdue(t, now)
            return (
              <li key={t.id}>
                <button type="button" className="task-row card" data-late={overdue || undefined} onClick={() => setOpenId(t.id)}>
                  <span className="task-no num">{t.number}</span>
                  <span className="task-main">
                    <span className="task-title">
                      <b>{typeName(t.typeId)}</b>
                      {t.priority !== 'normal' && <Pill tone={priorityInfo[t.priority].tone}>{priorityInfo[t.priority].label}</Pill>}
                    </span>
                    {t.details && <span className="task-details">{t.details}</span>}
                    <span className="task-meta">
                      {tech && <><Avatar name={tech.fullName} size={20} />{tech.fullName}</>}
                      {t.subscriberName && <> · {t.subscriberName}</>}
                      {zoneName(t.zoneId) && <> · {zoneName(t.zoneId)}</>}
                    </span>
                  </span>
                  <span className="task-side">
                    <Pill tone={overdue ? 'danger' : taskStatusInfo[t.status].tone}>{overdue ? 'متأخرة' : taskStatusInfo[t.status].label}</Pill>
                    <span className="task-clock num">
                      {t.status === 'new' ? 'لم تُرسل بعد' : t.status === 'done' ? `أُنجزت في ${durationText(mins)}` : t.status === 'cancelled' ? 'أُلغيت' : `${durationText(mins)} من ${durationText(t.expectedMinutes)}`}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <DailySheet tasks={all.filter((t) => t.status !== 'cancelled' && toISODate(new Date(t.createdAt)) === today)} />

      {creating && (
        <NewTaskDialog
          technicians={technicians}
          onClose={() => setCreating(false)}
          typeName={typeName}
          zoneName={zoneName}
        />
      )}
      {openTask && (
        <TaskDialog
          task={openTask}
          tech={person(openTask.assigneeId)}
          typeName={typeName(openTask.typeId)}
          zoneName={zoneName(openTask.zoneId)}
          now={now}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  )
}

function NewTaskDialog({ technicians, onClose, typeName, zoneName }: {
  technicians: Employee[]
  onClose(): void
  typeName(id: number): string
  zoneName(id: number | null): string | null
}) {
  const me = useEmployee()
  const toast = useToast()
  const types = useTaskTypes()
  const zones = useZones()
  const [typeId, setTypeId] = useState<number | null>(null)
  const [assigneeId, setAssigneeId] = useState<string | null>(null)
  const [details, setDetails] = useState('')
  const [subscriberName, setSubscriberName] = useState('')
  const [subscriberPhone, setSubscriberPhone] = useState('')
  const [zoneId, setZoneId] = useState<number | null>(null)
  const [location, setLocation] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('normal')
  const [expected, setExpected] = useState(30)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<Channel | null>(null)

  const tech = technicians.find((t) => t.id === assigneeId)
  const activeTypes = useMemo(() => (types ?? []).filter((t) => t.isActive), [types])

  async function save(channel: Channel) {
    if (!typeId) return setError('اختر نوع المهمة.')
    if (!tech) return setError('اختر الفني.')
    if (!tech.phone) return setError(`لا يوجد رقم جوال لـ ${tech.fullName}. أضفه من الإعدادات.`)
    if (subscriberPhone && !isValidPhone(subscriberPhone)) return setError('رقم المشترك 10 خانات ويبدأ بـ 059 أو 056.')
    setBusy(channel)
    setError(null)
    try {
      const task = await createTask(
        { typeId, assigneeId: tech.id, details, subscriberName, subscriberPhone: subscriberPhone || null, zoneId, location, priority, expectedMinutes: expected },
        me.id,
      )
      const text = taskMessage(task, { type: typeName(task.typeId), zone: zoneName(task.zoneId) }, taskLink(task.linkToken))
      await sendOrder(task, channel, { ...tech, phone: tech.phone! }, text)
      toast(`أُرسلت المهمة ${task.number} إلى ${tech.fullName}`)
      onClose()
    } catch (e) {
      setError(errText(e))
      setBusy(null)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="مهمة جديدة"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>إلغاء</Button>
          <Button variant="secondary" icon={<MessageSquareText size={17} />} busy={busy === 'sms'} disabled={!!busy} onClick={() => void save('sms')}>SMS</Button>
          <Button variant="primary" icon={<MessageCircle size={17} />} busy={busy === 'whatsapp'} disabled={!!busy} onClick={() => void save('whatsapp')}>إرسال واتساب</Button>
        </>
      }
    >
      <div className="form-grid">
        <div className="field">
          <span className="label">الفني</span>
          <div className="chips">
            {technicians.length === 0 && <span className="field-hint">لا فنيين بعد. أضفهم من الإعدادات.</span>}
            {technicians.map((t) => (
              <Chip key={t.id} pressed={assigneeId === t.id} onClick={() => setAssigneeId(t.id)}>
                {t.fullName}
              </Chip>
            ))}
          </div>
          {tech && !tech.phone && <span className="field-error">لا يوجد رقم جوال لهذا الفني. أضفه من الإعدادات.</span>}
        </div>
        <div className="field">
          <span className="label">نوع المهمة</span>
          <div className="chips">
            {activeTypes.map((t) => (
              <Chip key={t.id} pressed={typeId === t.id} onClick={() => setTypeId(t.id)}>{t.name}</Chip>
            ))}
          </div>
        </div>
        <label className="field">
          <span className="label">التفاصيل</span>
          <textarea className="textarea" rows={3} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="ماذا يعمل بالضبط؟" />
        </label>
        <div className="two-col">
          <label className="field">
            <span className="label">اسم المشترك (اختياري)</span>
            <input className="input" value={subscriberName} onChange={(e) => setSubscriberName(e.target.value)} />
          </label>
          <label className="field">
            <span className="label">جوال المشترك (اختياري)</span>
            <input className="input ltr num" type="tel" inputMode="tel" placeholder="059 000 0000" value={formatPhone(subscriberPhone)} onChange={(e) => setSubscriberPhone(normalizePhone(e.target.value))} />
          </label>
        </div>
        <div className="two-col">
          <label className="field">
            <span className="label">المنطقة (اختياري)</span>
            <select className="select" value={zoneId ?? ''} onChange={(e) => setZoneId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">بدون</option>
              {(zones ?? []).filter((z) => z.isActive).map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="label">المكان بالتحديد (اختياري)</span>
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
          <span className="field-hint">بعدها تظهر المهمة «متأخرة» عندك.</span>
        </div>
        {error && <p className="field-error" role="alert">{error}</p>}
      </div>
    </Dialog>
  )
}

function TaskDialog({ task, tech, typeName, zoneName, now, onClose }: {
  task: Task
  tech: Employee | undefined
  typeName: string
  zoneName: string | null
  now: Date
  onClose(): void
}) {
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const [armed, arm, disarm] = useConfirmTap()
  const link = taskLink(task.linkToken)
  const text = taskMessage(task, { type: typeName, zone: zoneName }, link)
  const open = isOpen(task)

  async function send(channel: Channel) {
    if (!tech?.phone) return toast('لا يوجد رقم جوال لهذا الفني', 'danger')
    setBusy(channel)
    try {
      await sendOrder(task, channel, { ...tech, phone: tech.phone! }, text)
    } catch (e) {
      toast(errText(e), 'danger')
    } finally {
      setBusy(null)
    }
  }

  async function cancel() {
    if (!armed) return arm()
    setBusy('cancel')
    try {
      await cancelTask(task, reason)
      toast(`أُلغيت المهمة ${task.number}`)
      onClose()
    } catch (e) {
      toast(errText(e), 'danger')
      setBusy(null)
      disarm()
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
    <Dialog open onClose={onClose} title={`مهمة ${task.number} · ${typeName}`}>
      <div className="task-detail">
        <div className="task-detail-head">
          <Pill tone={isOverdue(task, now) ? 'danger' : taskStatusInfo[task.status].tone}>
            {isOverdue(task, now) ? 'متأخرة' : taskStatusInfo[task.status].label}
          </Pill>
          {task.priority !== 'normal' && <Pill tone={priorityInfo[task.priority].tone}>{priorityInfo[task.priority].label}</Pill>}
          <span className="muted num">
            {task.status === 'done' ? `أخذت ${durationText(elapsedMinutes(task, now))}` : task.status !== 'new' && open ? `${durationText(elapsedMinutes(task, now))} من ${durationText(task.expectedMinutes)}` : `المتوقع ${durationText(task.expectedMinutes)}`}
          </span>
        </div>

        <dl className="task-facts">
          {tech && <div><dt>الفني</dt><dd>{tech.fullName}{tech.phone && <> · <span className="num ltr">{formatPhone(tech.phone)}</span></>}</dd></div>}
          {task.details && <div><dt>التفاصيل</dt><dd>{task.details}</dd></div>}
          {(task.subscriberName || task.subscriberPhone) && (
            <div><dt>المشترك</dt><dd>{task.subscriberName}{task.subscriberPhone && <>{task.subscriberName ? ' · ' : ''}<span className="num ltr">{formatPhone(task.subscriberPhone)}</span></>}</dd></div>
          )}
          {(zoneName || task.location) && <div><dt>المكان</dt><dd>{[zoneName, task.location].filter(Boolean).join(' · ')}</dd></div>}
          {task.completionNotes && <div><dt>ملاحظة الفني</dt><dd>{task.completionNotes}</dd></div>}
          {task.cancelReason && <div><dt>سبب الإلغاء</dt><dd>{task.cancelReason}</dd></div>}
        </dl>

        <TaskMaterials task={task} />

        <ol className="task-steps">
          {steps.filter(([, at]) => at).map(([label, at]) => (
            <li key={label}><span>{label}</span><b className="num">{formatTime(new Date(at!))}</b></li>
          ))}
        </ol>

        {open && (
          <div className="task-actions">
            <Button variant={task.status === 'new' ? 'primary' : 'secondary'} icon={<MessageCircle size={17} />} busy={busy === 'whatsapp'} onClick={() => void send('whatsapp')}>
              {task.status === 'new' ? 'إرسال واتساب' : 'إعادة على واتساب'}
            </Button>
            <Button variant="secondary" icon={<MessageSquareText size={17} />} busy={busy === 'sms'} onClick={() => void send('sms')}>SMS</Button>
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
            {!cancelling ? (
              <Button variant="ghost" icon={<XCircle size={16} />} onClick={() => setCancelling(true)}>إلغاء المهمة</Button>
            ) : (
              <>
                <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="سبب الإلغاء" aria-label="سبب الإلغاء" autoFocus />
                <Button variant="danger" icon={<TimerReset size={16} />} busy={busy === 'cancel'} disabled={!reason.trim()} onClick={() => void cancel()}>
                  {armed ? 'اضغط مرة ثانية للتأكيد' : 'إلغاء المهمة'}
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </Dialog>
  )
}

/** Materials taken from the warehouse for this task: from the technician's link, or added here. */
function TaskMaterials({ task }: { task: Task }) {
  const me = useEmployee()
  const toast = useToast()
  const moves = useLiveQuery(() => db.stockMoves.where('taskId').equals(task.id).toArray(), [task.id])
  const items = useLiveQuery(async () => (await db.stockItems.toArray()).filter((i) => i.isActive), [])
  const [itemId, setItemId] = useState<number | null>(null)
  const [qty, setQty] = useState('')
  const [busy, setBusy] = useState(false)
  const name = (id: number) => items?.find((i) => i.id === id)
  const out = (moves ?? []).filter((m) => m.kind === 'out')

  async function add() {
    const q = parseDecimal(qty)
    const id = itemId ?? items?.[0]?.id
    if (!id || !q) return
    setBusy(true)
    try {
      await addMove({ itemId: id, kind: 'out', qty: q, note: `مهمة #${task.number}`, taskId: task.id }, me.id)
      setQty('')
    } catch (e) {
      toast(errText(e), 'danger')
    } finally {
      setBusy(false)
    }
  }

  if (!items?.length && !out.length) return null
  return (
    <div className="task-materials">
      <b>المواد المستخدمة</b>
      {out.length === 0 ? (
        <p className="muted">لم تُسجَّل مواد.</p>
      ) : (
        <ul>
          {out.map((m) => (
            <li key={m.id}>
              <span>{name(m.itemId)?.name ?? 'صنف'} <b className="num">{formatAmount(m.qty)}</b> {name(m.itemId)?.unit}</span>
              <button type="button" className="icon-btn sm" aria-label="حذف" onClick={() => void deleteMove(m.id).catch((e) => toast(errText(e), 'danger'))}><Trash2 size={14} /></button>
            </li>
          ))}
        </ul>
      )}
      {!!items?.length && (
        <div className="task-mat-add">
          <select className="select" aria-label="الصنف" value={itemId ?? items[0]!.id} onChange={(e) => setItemId(Number(e.target.value))}>
            {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
          <input className="input num" inputMode="decimal" aria-label="الكمية" placeholder="الكمية" value={qty} onChange={(e) => setQty(e.target.value)} />
          <Button variant="secondary" icon={<Plus size={16} />} busy={busy} disabled={!parseDecimal(qty)} onClick={() => void add()}>إضافة</Button>
        </div>
      )}
    </div>
  )
}

/** The paper "daily electricians' tasks" sheet: each technician against each task type, with totals. */
function DailySheet({ tasks }: { tasks: Task[] }) {
  const employees = useLiveQuery(() => db.employees.toArray(), [])
  const types = useTaskTypes()
  if (!employees || !types || tasks.length === 0) return null
  const section = taskMatrix(tasks, employees, types, 'today', 'كشف مهام اليوم')
  return (
    <section className="card">
      <div className="card-h">
        <h2>كشف مهام اليوم</h2>
        <span className="meta">كل فني حسب نوع المهمة · <span className="num">{tasks.length}</span> مهمة</span>
      </div>
      <div className="table-wrap"><ReportTable section={section} /></div>
    </section>
  )
}
