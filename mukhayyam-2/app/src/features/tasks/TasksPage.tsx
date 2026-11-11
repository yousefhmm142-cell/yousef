import { TechnicianPicker } from './TechnicianPicker'
import { sendSharedOrder, SharedSmsError } from './sharedSms'
import { useTaskSearch } from './useTaskSearch'
import { useDayTasks } from './useDayTasks'
import { EmptyArt } from '../../ui/fx/EmptyArt'
import { CountUp } from '../../ui/fx/CountUp'
import { Skeleton } from '../../ui/fx/Skeleton'
import { useLiveQuery } from 'dexie-react-hooks'
import { Search, X, AlarmClock, CalendarDays, CheckCheck, ChevronLeft, ChevronRight, Copy, ListChecks, MapPin, MessageCircle, MessageSquareText, Phone, PhoneIncoming, Plus, Printer, ScrollText, UserRound, XCircle } from 'lucide-react'
import { taskMatrix } from '../reports/build'
import { TaskPrintSheet } from './TaskPrintSheet'
import { sealWorkAsTasks, useSealWork } from './sealWork'
import { SubscriberField } from './SubscriberField'
import { FootHint, SummaryAside, saveOnCtrlEnter } from '../../ui/SummaryAside'
import { fold, importSubscribers, readSubscribersFile, searchSubscribers, useSubscribers, type Subscriber } from './subscribers'
import type { TaskType } from './model'
import { ReportTable } from '../reports/ReportsPage'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { TaskArchive } from './TaskArchive'
import { useEmployee } from '../../auth/AuthProvider'
import { db } from '../../data/db'
import { addDays, dayName, describeDay, toISODate, todayISO, type ISODate } from '../../lib/dates'
import { formatTime } from '../../lib/format'
import { formatPhone, isValidPhone, normalizePhone } from '../../lib/phone'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { useNow } from '../../lib/useNow'
import type { Employee } from '../../types'
import { hasPage, isManagerRole } from '../../types'
import { Dialog } from '../../ui/Dialog'
import { Chip, Segmented } from '../../ui/form'
import { Avatar, Button, Pill } from '../../ui/primitives'
import { useToast } from '../../ui/Toast'
import { useZones } from '../distribution/repo'
import { useConfirm } from '../../ui/Confirm'
import { SheetStateError } from '../sheets/workflow'
import { smsUrl, taskLink, taskMessage, taskSms, taskSmsFull, whatsappUrl } from './message'
import { sendCompanySms, smsError } from '../sms/repo'
import {
  isSharedTask, taskAssignees, isAssignedTo,
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
import { assignTask, cancelTask, markDone, createTask, recordSent, refreshTasks, useTasks, useTaskTypes } from './repo'

const errorText: Record<string, string> = {
  task_waiting_sync:'المهمة بعدها بانتظار المزامنة. لما توصل بتقدر تبعتها.',
  assignment_changed:'الفنيون تغيّروا على المهمة. افتحها من جديد وراجع الأسماء قبل الإرسال.',
  missing_technician_phone:'في فني مش فعّال أو ما إله رقم جوال. راجع الأسماء والأرقام.',
  task_closed:'المهمة انغلقت أو انلغت. ما انبعتت رسالة جديدة.',
  offline: 'المهام تحتاج إنترنت لأنها تُرسل برسالة. اتصل وحاول مرة أخرى.',
}
class SmsError extends Error {}
const errText = (e: unknown) => (e instanceof SmsError || e instanceof SharedSmsError ? e.message : errorText[e instanceof SheetStateError ? e.message : ''] ?? 'تعذّر الحفظ. حاول مرة أخرى.')

type View = 'waiting' | 'open' | 'late' | 'today' | 'all'

function useTechnicians(): Employee[] {
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

export function TasksPage() {
  useDocumentTitle('المهام الميدانية')
  const employee = useEmployee()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tasks = useTasks()
  const types = useTaskTypes()
  const zones = useZones()
  const technicians = useTechnicians()
  const now = useNow(30_000)
  const [search,setSearch]=useState('')
  const people=useLiveQuery(()=>db.employees.toArray(),[])
  const taskSearch=useTaskSearch(search,tasks,people,types,zones)
  const searching=!!fold(search)
  const [picked, setView] = useState<View | null>(null)
  const [who, setWho] = useState<string | null>(null)
  // null = today (the live board); a past day shows what happened that day.
  const [pastDay, setPastDay] = useState<ISODate | null>(null)
  const [creating, setCreating] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [giving, setGiving] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  // Fresh from the server while this screen is open: a finished task shows up within seconds.
  useEffect(() => {
    void refreshTasks()
    const id = window.setInterval(() => document.visibilityState === 'visible' && void refreshTasks(), 10_000)
    return () => window.clearInterval(id)
  }, [])

  const today = todayISO()
  const day=pastDay??today
  const dayTasksState=useDayTasks(day,tasks)
  const all = tasks ?? []
  // A call written down, waiting for a technician: shown on its own, above everything.
  const prepared = all.filter((t) => !t.assigneeId && isOpen(t)).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const open = all.filter((t) => isOpen(t) && !!t.assigneeId)
  const doneOnDay = dayTasksState.rows.filter((t) => t.status === 'done' && t.completedAt && toISODate(new Date(t.completedAt)) === day)
  const late = open.filter((t) => isOverdue(t, now))

  // Calls waiting for a technician come first when there are any.
  const view: View = picked ?? (prepared.length ? 'waiting' : 'open')
  // A past day: every task created, finished or cancelled that day (open ones first, then newest).
  const dayOf = (iso: string | null | undefined) => (iso ? toISODate(new Date(iso)) : null)
  const dayTasks = pastDay
    ? dayTasksState.rows.filter((t) => dayOf(t.createdAt) === pastDay || dayOf(t.completedAt) === pastDay || dayOf(t.cancelledAt) === pastDay).sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)) || b.number - a.number)
    : []
  const shown = searching ? taskSearch.rows : (pastDay ? dayTasks : view === 'late' ? late : view === 'today' ? doneOnDay : view === 'all' ? all.filter((t) => !!t.assigneeId) : open).filter((t) => !who || isAssignedTo(t,who))
  const stepDay = (by: number) => {
    const next = addDays(pastDay ?? today, by)
    setPastDay(next >= today ? null : next)
  }
  const typeName = (id: number) => types?.find((t) => t.id === id)?.name ?? 'مهمة'
  const zoneName = (id: number | null) => (id ? zones?.find((z) => z.id === id)?.name ?? null : null)
  const person = (id:string|null) => id ? people?.find(e=>e.id===id) ?? technicians.find(e=>e.id===id) : undefined
  const participants=(task:Task)=>taskAssignees(task).map(id=>person(id)).filter((p):p is Employee=>!!p)
  const givingTask = all.find((t) => t.id === giving) ?? taskSearch.rows.find(t=>t.id===giving) ?? null
  const confirmDone = useConfirm()
  const toastDone = useToast()
  async function doneFor(t: Task) {
    const who = participants(t).map(p=>p.fullName).join('، ') || 'الفني'
    const yes = await confirmDone({ title: isSharedTask(t) ? `خلصوا المهمة المشتركة؟` : `${who} خلّص المهمة؟`, message: `${typeName(t.typeId)}${t.subscriberName ? ` · ${t.subscriberName}` : ''}. ${isSharedTask(t) ? 'بتنحسب منجزة بأسمائهم' : 'بتنحسب منجزة باسمه'} بوقت هلأ.`, confirmLabel: 'تم الإنجاز ✓' })
    if (!yes) return
    try {
      await markDone(t)
      toastDone(`انحسبت منجزة لـ ${who}`)
    } catch (e) {
      toastDone(errText(e), 'danger')
    }
  }
  const openTask = all.find((t) => t.id === openId) ?? taskSearch.rows.find(t=>t.id===openId) ?? null
  // What the technicians did with seals today counts as their finished tasks too.
  const sealNames = useMemo(() => (people ? new Map(people.map((e) => [e.id, e.fullName] as [string, string])) : undefined), [people])
  const sealToday = useSealWork(day, day, sealNames)
  const sealDone = useMemo(() => sealWorkAsTasks(sealToday.filter(l=>l.date===day), types ?? []), [sealToday, types, day])

  if (params.get('view') === 'archive') return <div className="tasks"><TaskArchive onClose={() => setParams({})} /></div>

  return (
    <div className="tasks">
      <header className="ph">
        <div>
          <h1>المهام الميدانية</h1>
          <p className="muted task-sub">اكتب الأوردر، يصل للفني على واتساب أو SMS، وتعرف متى أنهاه.</p>
        </div>
      </header>

      <div className="task-search"><Search size={20} aria-hidden="true" /><input type="search" aria-label="بحث عام بالمهام" placeholder="ابحث برقم المهمة، المشترك، الفني أو التفاصيل…" maxLength={160} value={search} onChange={e=>setSearch(e.target.value)} />{search && <button type="button" className="icon-btn" aria-label="مسح البحث" onClick={()=>setSearch('')}><X size={18} /></button>}</div>
      {searching && <div className="task-search-summary" role="status"><b>نتائج البحث بكل المهام</b><span>{taskSearch.busy ? 'جاري البحث…' : `${taskSearch.rows.length}${taskSearch.more ? '+' : ''} نتيجة`}</span>{taskSearch.error && <p>{taskSearch.error}</p>}</div>}
      {!searching && <div className="task-daybar" role="group" aria-label="اليوم">
        <button type="button" className="tdb-step" aria-label="اليوم اللي قبله" onClick={() => stepDay(-1)}><ChevronRight size={22} /></button>
        <label className="tdb-day">
          <CalendarDays size={18} />
          <span><b>{dayName(pastDay ?? today, today)}</b><small className="num">{describeDay(pastDay ?? today).weekday} {describeDay(pastDay ?? today).date}</small></span>
          <input type="date" value={pastDay ?? today} max={today} onChange={(e) => e.target.value && setPastDay(e.target.value >= today ? null : e.target.value)} aria-label="اختيار يوم" />
        </label>
        <button type="button" className="tdb-step" aria-label="اليوم اللي بعده" disabled={!pastDay} onClick={() => stepDay(1)}><ChevronLeft size={22} /></button>
        {pastDay && <button type="button" className="tdb-today" onClick={() => setPastDay(null)}>رجوع لليوم</button>}
      </div>}

      {!searching && !pastDay && <div className="task-board" role="tablist" aria-label="حالة المهام">
        {([
          ['waiting', 'بانتظار فني', prepared.length, PhoneIncoming, prepared.length ? 'brand' : ''],
          ['open', 'عند الفنيين', open.length, ListChecks, ''],
          ['late', 'تجاوزت وقتها', late.length, AlarmClock, late.length ? 'danger' : ''],
          ['today', 'خلصت اليوم', doneOnDay.length + sealDone.tasks.length, CheckCheck, 'ok'],
        ] as const).map(([k, label, n, Icon, tone]) => (
          <button key={k} type="button" role="tab" aria-selected={view === k} className="tb-tile" data-tone={tone || undefined} onClick={() => setView(k)}>
            <span className="tb-top"><Icon size={17} />{label}</span>
            <b className="num"><CountUp value={n} /></b>
          </button>
        ))}
      </div>}

      <div className="ph-actions task-actions">
        <Button variant="secondary" size="lg" icon={<ListChecks size={18} />} onClick={() => setParams({ view: 'archive' })}>أرشيف الفنيين</Button>
        <Button variant="secondary" size="lg" icon={<UserRound size={18} />} onClick={() => navigate('/subscriber')}>ملف مشترك</Button>
        <Button variant="secondary" size="lg" icon={<Printer size={18} />} onClick={() => window.print()} disabled={dayTasksState.busy || !dayTasksState.ready} className="desk-only">
          {pastDay ? 'طباعة كشف اليوم المختار' : 'طباعة كشف اليوم'}
        </Button>
        {hasPage(employee, 'seal-work') && <Button variant="secondary" size="lg" icon={<ScrollText size={18} />} onClick={() => navigate('/tasks/seal-work')} className={isManagerRole(employee.role) ? undefined : 'desk-only'}>
          كشف أعمال الأختام
        </Button>}
        {isManagerRole(employee.role) && <span className="desk-only"><SubscribersButton /></span>}
        <Button variant="secondary" size="lg" icon={<Plus size={18} />} onClick={() => setCreating(true)}>
          مهمة جديدة
        </Button>
        <Button variant="primary" size="lg" icon={<PhoneIncoming size={18} />} onClick={() => setPreparing(true)} className="ph-action">
          تجهيز مهمة
        </Button>
      </div>

      {!searching && !pastDay && view === 'waiting' && <section className="card prep-card">
        <div className="card-h">
          <span className="ico-round brand"><PhoneIncoming size={16} /></span>
          <h2>مهام مجهّزة بانتظار فني</h2>
          <span className="meta num">{prepared.length}</span>
        </div>
        {prepared.length === 0 ? (
          <p className="card-empty">لما يتصل مشترك اضغط «تجهيز مهمة» واكتب طلبه، وبعدين أعطيها لفني من هون.</p>
        ) : (
          <ul className="prep-list">
            {prepared.map((t) => (
              <li key={t.id} className="prep-row">
                <span className="task-no num">{t.number || '…'}</span>
                <span className="prep-main">
                  <b>{typeName(t.typeId)}{t.details && <span className="prep-need"> · {t.details}</span>}</b>
                  <span className="prep-meta">
                    <span><UserRound size={14} />{t.subscriberName || 'بدون اسم'}</span>
                    {t.subscriberPhone && <a href={`tel:${t.subscriberPhone}`} className="num ltr" onClick={(e) => e.stopPropagation()}><Phone size={14} />{formatPhone(t.subscriberPhone)}</a>}
                    {(zoneName(t.zoneId) || t.location) && <span><MapPin size={14} />{[zoneName(t.zoneId), t.location].filter(Boolean).join(' · ')}</span>}
                    <span className="muted num">{(() => { const m = Math.round((now.getTime() - Date.parse(t.createdAt)) / 60000); return m < 1 ? 'الآن' : `من ${durationText(m)}` })()}</span>
                  </span>
                </span>
                <Button variant="primary" onClick={() => setGiving(t.id)}>أعطيها لفني</Button>
              </li>
            ))}
          </ul>
        )}
      </section>}

      {!searching && (pastDay || view !== 'waiting') && <div className="task-filters">
        <div className="chips">
          <Chip pressed={!who} onClick={() => setWho(null)}>الكل</Chip>
          {technicians.map((t) => (
            <Chip key={t.id} pressed={who === t.id} onClick={() => setWho(who === t.id ? null : t.id)}>
              {t.fullName}
              {open.some((x) => isAssignedTo(x,t.id)) && <span className="chip-count num">{open.filter((x) => isAssignedTo(x,t.id)).length}</span>}
            </Chip>
          ))}
          {!pastDay && <Chip pressed={view === 'all'} onClick={() => setView(view === 'all' ? 'open' : 'all')}>آخر 30 يوم</Chip>}
        </div>
      </div>}

      {!searching && pastDay && tasks && <p className="task-daysum"><b className="num">{dayTasks.length}</b> {dayTasks.length === 1 ? 'مهمة' : 'مهام'} · <b className="num">{dayTasks.filter((t) => t.status === 'done').length}</b> أُنجزت{dayTasks.some((t) => t.status === 'cancelled') && <> · <b className="num">{dayTasks.filter((t) => t.status === 'cancelled').length}</b> أُلغيت</>}</p>}

      {!searching && !pastDay && view === 'waiting' ? null : !tasks || (searching && taskSearch.busy && !taskSearch.rows.length) ? (
        <Skeleton kind="list" />
      ) : shown.length === 0 ? (
        <div className="empty card"><EmptyArt kind="tech" />
          <h3>{searching ? 'ما في مهام بتطابق البحث' : pastDay ? 'ما في مهام باليوم هاد' : view === 'open' ? 'لا مهام عند الفنيين' : view === 'late' ? 'ولا مهمة متأخرة 👌' : view === 'today' ? 'لم تُنجز مهام اليوم بعد' : 'لا مهام'}</h3>
          {searching && <p>جرّب رقم المهمة، اسم المشترك أو اسم الفني.</p>}
          {!searching && !pastDay && <p>اضغط «مهمة جديدة»، اختر الفني ونوع العمل، وأرسلها بضغطة.</p>}
        </div>
      ) : (
        <ul className="task-list">
          {shown.map((t) => {
            const tech = person(t.assigneeId)
            const mins = elapsedMinutes(t, now)
            const overdue = isOverdue(t, now)
            return (
              <li key={t.id} className="task-li">
                <button type="button" className="task-row card" data-late={overdue || undefined} onClick={() => setOpenId(t.id)}>
                  <span className="task-no num">{t.number || '…'}</span>
                  <span className="task-main">
                    <span className="task-title">
                      <b>{typeName(t.typeId)}</b>{isSharedTask(t) && <Pill tone="brand">مهمة مشتركة</Pill>}
                      {t.priority !== 'normal' && <Pill tone={priorityInfo[t.priority].tone}>{priorityInfo[t.priority].label}</Pill>}
                    </span>
                    {t.details && <span className="task-details">{t.details}</span>}
                    <span className="task-meta">
                      {tech && <><Avatar name={tech.fullName} size={20} />{participants(t).map(p=>p.fullName).join('، ')}</>}
                      {t.subscriberName && <> · {t.subscriberName}</>}
                      {zoneName(t.zoneId) && <> · {zoneName(t.zoneId)}</>}
                      {t.location && <> · {t.location}</>}
                    </span>
                  </span>
                  <span className="task-side">
                    <Pill tone={overdue ? 'danger' : taskStatusInfo[t.status].tone}>{overdue ? 'تجاوزت وقتها' : taskStatusInfo[t.status].label}</Pill>
                    <span className="task-clock num">
                      {t.status === 'new' ? 'لم تُرسل بعد' : t.status === 'done' ? `أُنجزت في ${durationText(mins)}` : t.status === 'cancelled' ? 'أُلغيت' : `${durationText(mins)} من ${durationText(t.expectedMinutes)}`}
                    </span>
                  </span>
                </button>
                {searching && !t.assigneeId && isOpen(t) && <Button onClick={()=>setGiving(t.id)}>أعطيها لفني</Button>}
                {t.assigneeId && isOpen(t) && (
                  <button type="button" className="done-btn" aria-label={`تم إنجاز المهمة ${t.number || ''}`} title="الفني خلّصها: علّمها منجزة" onClick={() => void doneFor(t)}>
                    <CheckCheck size={20} /><span>تم</span><small className="done-more">الفني خلّصها</small>
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {searching && taskSearch.more && <Button variant="secondary" busy={taskSearch.busy} onClick={taskSearch.loadMore}>عرض المزيد من النتائج</Button>}
      {dayTasksState.error && <p className="banner warn" role="status">{dayTasksState.error}</p>}
      {types && <TaskPrintSheet day={day} tasks={[...doneOnDay, ...sealDone.tasks]} employees={people ?? []} types={sealDone.types} />}

      <DailySheet day={day} busy={dayTasksState.busy} tasks={[...dayTasksState.rows.filter((t) => t.status !== 'cancelled' && toISODate(new Date(t.createdAt)) === day), ...sealDone.tasks]} types={sealDone.types} />

      {preparing && <PrepareDialog onClose={() => setPreparing(false)} />}
      {givingTask && <GiveDialog task={givingTask} technicians={technicians} typeName={typeName} zoneName={zoneName} onClose={() => setGiving(null)} />}
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
          tech={person(openTask.assigneeId)} participants={participants(openTask)}
          typeName={typeName(openTask.typeId)}
          zoneName={zoneName(openTask.zoneId)}
          now={now}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  )
}

/** The places the office uses when a subscriber says where he is (sorted, for quick finding). */
const PLACES = [
  'الشوافعة', 'الفقي', 'حارة الشافعي', 'القدس', 'الأهرام', 'أبو ذر', 'هويشل', 'مكتب', 'أبو رحمة', 'الطلاع', 'أبو عمرة', 'صبح', 'مدارس', 'شقاقي',
  'زهرة الربيع', 'مكتبة', 'الحاج', 'الأبراج', 'نونة', 'فنونة', 'أبو عمار', 'الحملاوي', 'نادي الأهلي', 'الدهلي', 'العلي', 'الحلو', 'عشرين', 'التحلي',
  'دباغ', 'الحسنات', 'النور', 'شمال', 'برج', 'أبو بطيحان', 'أبو عبيدة', 'شرقية', 'حميدة', 'أبو أنور', 'خوالدة', 'المقبرة', 'مدخل', 'محل', 'عاشور',
  'السنة', 'النهرام',
].sort((a, b) => a.localeCompare(b, 'ar'))

/** The subscriber's area as a place: the list's own spelling when it is one of them, else the area as written. */
function placeFor(area: string): string {
  const a = fold(area)
  if (!a) return ''
  return PLACES.find((p) => fold(p) === a) ?? PLACES.find((p) => a.includes(fold(p)) || fold(p).includes(a)) ?? area.trim()
}

/** A subscriber calls: write down who, what, where and the phone. The technician comes later. */
function PrepareDialog({ onClose }: { onClose(): void }) {
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
function SubscribersButton() {
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

/** A prepared task goes to a technician, and is sent at once. */
function GiveDialog({ task, technicians, typeName, zoneName, onClose }: {
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
        </div>
        {error && <p className="field-error" role="alert">{error}</p>}
      </fieldset>
    </Dialog>
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
  const [expected, setExpected] = useState(30)
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
          <span className="field-hint">بعدها تظهر المهمة «تجاوزت وقتها» عندك.</span>
        </div>
        {error && <p className="field-error" role="alert">{error}</p>}
      </fieldset>
    </Dialog>
  )
}

function TaskDialog({ task, tech, participants, typeName, zoneName, now, onClose }: {
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

/** The paper "daily electricians' tasks" sheet: each technician against each task type, with totals. */
function DailySheet({ day,busy,tasks, types: withSeals }: { day:ISODate;busy:boolean;tasks: Task[]; types: TaskType[] }) {
  const employees = useLiveQuery(() => db.employees.toArray(), [])
  const own = useTaskTypes()
  const types = own ? withSeals : undefined
  if (!employees || !types) return null
  const title=day===todayISO() ? 'كشف مهام اليوم' : `كشف مهام ${describeDay(day).weekday} ${describeDay(day).date}`
  const section = taskMatrix(tasks, employees, types,day,title)
  return (
    <section className="card">
      <div className="card-h">
        <h2>{title}</h2>
        <span className="meta">كل فني حسب نوع المهمة · <span className="num">{tasks.length}</span> مهمة</span>
      </div>
      <small className="card-empty">المهمة المشتركة بتنحسب لكل فني شارك فيها.</small>{busy ? <Skeleton kind="table" /> : <div className="table-wrap"><ReportTable section={section} /></div>}
    </section>
  )
}
