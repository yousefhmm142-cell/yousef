import { useTaskSearch } from './useTaskSearch'
import { useDayTasks } from './useDayTasks'
import { EmptyArt } from '../../ui/fx/EmptyArt'
import { CountUp } from '../../ui/fx/CountUp'
import { Skeleton } from '../../ui/fx/Skeleton'
import { useLiveQuery } from 'dexie-react-hooks'
import { Search,X,AlarmClock,CalendarDays,CheckCheck,ChevronLeft,ChevronRight,ListChecks,MapPin,Phone,PhoneIncoming,Plus,Printer,ScrollText,UserRound } from 'lucide-react'
import { taskMatrix } from '../reports/build'
import { TaskPrintSheet } from './TaskPrintSheet'
import { sealWorkAsTasks,useSealWork } from './sealWork'
import { fold } from './subscribers'
import type { TaskType } from './model'
import { ReportTable } from '../reports/ReportsPage'
import { useEffect,useMemo,useState } from 'react'
import { useNavigate,useSearchParams } from 'react-router'
import { TaskArchive } from './TaskArchive'
import { useEmployee } from '../../auth/AuthProvider'
import { db } from '../../data/db'
import { addDays,dayName,describeDay,toISODate,todayISO,type ISODate } from '../../lib/dates'
import { formatPhone } from '../../lib/phone'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { useNow } from '../../lib/useNow'
import type { Employee } from '../../types'
import { hasPage,isManagerRole } from '../../types'
import { Chip } from '../../ui/form'
import { Avatar,Button,Pill } from '../../ui/primitives'
import { useToast } from '../../ui/Toast'
import { useZones } from '../distribution/repo'
import { useConfirm } from '../../ui/Confirm'
import {
isSharedTask,taskAssignees,isAssignedTo,
durationText,
elapsedMinutes,isOpen,
isOverdue,
priorityInfo,taskStatusInfo,type Task
} from './model'
import { markDone,refreshTasks,useTasks,useTaskTypes } from './repo'
import { errText, useTechnicians, GiveDialog, NewTaskDialog, TaskDialog } from './TaskDialogs'
import { PrepareDialog,SubscribersButton } from './PrepareDialog'

type View = 'waiting' | 'open' | 'late' | 'today' | 'all'

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
  // «?view=late» (from the home page's «بدها انتباهك») opens on that list.
  const [picked, setView] = useState<View | null>(() => { const v = new URLSearchParams(location.search).get('view'); return v === 'late' || v === 'open' || v === 'today' || v === 'waiting' || v === 'all' ? v : null })
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
