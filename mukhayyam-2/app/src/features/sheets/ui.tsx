import { CalendarDays, Check, ChevronLeft, ChevronRight, CircleCheck, ClipboardList, Clock, Printer, Send, TriangleAlert, Undo2, WifiOff, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { formatTime, formatWeekday } from '../../lib/format'
import { addDays, dayName, describeDay, isISODate, todayISO, type ISODate } from '../../lib/dates'
import { useNow } from '../../lib/useNow'
import { Dialog } from '../../ui/Dialog'
import { Button, Pill } from '../../ui/primitives'
import { useToast } from '../../ui/Toast'
import { useConfirmTap, type SaveState } from './useDraft'
import { statusInfo, type SheetMeta, type SheetStatus } from './workflow'

/** "الخميس · 11:42 م" for a stored time. */
export const stamp = (iso: string | null) => (iso ? `${formatWeekday(new Date(iso))} · ${formatTime(new Date(iso))}` : '')

// ---------- On the phone ----------
export function SaveBadge({ state, online }: { state: SaveState; online: boolean }) {
  if (state === 'error') return <Pill tone="danger">تعذّر الحفظ</Pill>
  if (state === 'idle') return <span className="save-badge muted">يُحفظ أثناء الكتابة</span>
  return (
    <span className={`save-badge ${online ? '' : 'offline'}`} role="status">
      {state === 'saving' ? <span className="spinner sm" /> : online ? <CircleCheck size={16} /> : <WifiOff size={16} />}
      {state === 'saving' ? 'يُحفظ…' : 'محفوظ على الجهاز'}
    </span>
  )
}

export interface StepItem {
  key: string
  label: string
  icon?: LucideIcon
  done: boolean
}

export function Stepper({ items, current, onSelect, label, scroll }: {
  items: StepItem[]
  current: number
  onSelect(index: number): void
  label: string
  /** Many short steps (zones): one scrolling row instead of equal columns. */
  scroll?: boolean
}) {
  const active = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (scroll) active.current?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [current, scroll])
  return (
    <nav className={`stepper ${scroll ? 'scroll' : ''}`} aria-label={label} style={scroll ? undefined : { gridTemplateColumns: `repeat(${items.length}, 1fr)` }}>
      {items.map((s, i) => {
        const Icon = s.icon
        return (
          <button
            key={s.key}
            ref={i === current ? active : undefined}
            type="button"
            className="step"
            aria-current={i === current ? 'step' : undefined}
            data-done={s.done || undefined}
            onClick={() => onSelect(i)}
          >
            <span className="step-dot">
              {s.done && i !== current ? <Check size={14} strokeWidth={3} /> : Icon ? <Icon size={15} /> : <span className="num">{i + 1}</span>}
            </span>
            <span className="step-label">{s.label}</span>
          </button>
        )
      })}
    </nav>
  )
}

/** After sending: confirmation for the person on site, then approval once the manager approves. */
export function SentHeader({ sheet, date, noun }: { sheet: SheetMeta; date: ISODate; noun: string }) {
  const approved = sheet.status === 'approved'
  const { weekday, date: longDate } = describeDay(date)
  return (
    <section className={`sent glass ${approved ? 'ok' : 'wait'}`}>
      <span className="sent-ring" aria-hidden="true">{approved ? <CircleCheck size={30} /> : <Send size={26} />}</span>
      <div>
        <h1>{approved ? `اعتمد المدير ${noun}` : `أُغلق ${noun} ووصل للمدير`}</h1>
        <p>
          {weekday} · <span className="num">{longDate}</span>
          {' · '}
          {approved ? stamp(sheet.approvedAt) : `أُغلق ${stamp(sheet.submittedAt)}`}
        </p>
      </div>
      <Pill tone={statusInfo[sheet.status].tone}>{statusInfo[sheet.status].label}</Pill>
    </section>
  )
}

/** Earlier days that were started or returned but not sent. */
export function UnsentBanner({ sheets, hrefFor, title }: {
  sheets: Array<{ id: string; date: ISODate; status: SheetStatus }>
  hrefFor(date: ISODate): string
  title: string
}) {
  if (!sheets.length) return null
  return (
    <div className="banner info">
      <Clock size={18} />
      <p>
        {title}
        <span>
          {sheets.map((s, i) => (
            <span key={s.id}>
              {i > 0 && '، '}
              <Link to={hrefFor(s.date)}>{dayName(s.date)} ({statusInfo[s.status].label})</Link>
            </span>
          ))}
        </span>
      </p>
    </div>
  )
}

// ---------- On the manager's laptop ----------
/** Previous / next day, a calendar, and the arrow keys (right = earlier, as the page reads right to left). */
export function DateNav({ date, onChange }: { date: ISODate; onChange(date: ISODate): void }) {
  const today = todayISO()
  const picker = useRef<HTMLInputElement>(null)
  const { weekday, date: longDate } = describeDay(date)
  const relative = dayName(date, today)
  const go = (d: ISODate) => d <= today && onChange(d)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select, dialog')) return
      if (e.key === 'ArrowRight') go(addDays(date, -1))
      if (e.key === 'ArrowLeft') go(addDays(date, 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="datenav glass">
      <button type="button" aria-label="اليوم السابق" onClick={() => go(addDays(date, -1))}>
        <ChevronRight size={20} />
      </button>
      <div className="datenav-label">
        <b>{relative === weekday ? weekday : `${relative} · ${weekday}`}</b>
        <small className="num">{longDate}</small>
      </div>
      <button type="button" aria-label="اليوم التالي" disabled={date >= today} onClick={() => go(addDays(date, 1))}>
        <ChevronLeft size={20} />
      </button>
      <button type="button" aria-label="اختيار يوم من التقويم" onClick={() => picker.current?.showPicker?.()}>
        <CalendarDays size={18} />
      </button>
      <input
        ref={picker}
        type="date"
        className="sr-only"
        tabIndex={-1}
        max={today}
        value={date}
        onChange={(e) => isISODate(e.target.value) && go(e.target.value)}
      />
    </div>
  )
}

/** Status, where it came from, and the manager's actions: return with a reason, print, approve. */
export function StatusBar({ sheet, source, canAct, onApprove, onReturn, returnPlaceholder }: {
  sheet: SheetMeta
  source: string
  canAct: boolean
  onApprove(): Promise<void>
  onReturn(reason: string): Promise<void>
  returnPlaceholder: string
}) {
  const toast = useToast()
  const [armed, arm, reset] = useConfirmTap()
  const [busy, setBusy] = useState(false)
  const [returnOpen, setReturnOpen] = useState(false)
  const [reason, setReason] = useState('')
  const info = statusInfo[sheet.status]
  const waiting = canAct && sheet.status === 'submitted'
  const canReopen = canAct && (sheet.status === 'submitted' || sheet.status === 'approved')

  async function approve() {
    if (!armed) return arm()
    setBusy(true)
    try {
      await onApprove()
      toast('اعتُمد')
    } catch {
      toast('تعذّر الاعتماد. حدّث الصفحة وحاول مرة أخرى.', 'danger')
    } finally {
      setBusy(false)
      reset()
    }
  }

  async function sendBack() {
    if (!reason.trim()) return
    setBusy(true)
    try {
      await onReturn(reason)
      setReturnOpen(false)
      setReason('')
      toast('أُعيد فتح اليوم')
    } catch {
      toast('تعذّرت إعادة الفتح. حاول مرة أخرى.', 'danger')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="statusbar glass">
      <Pill tone={info.tone}>{info.label}</Pill>
      <p>
        وصل من {source} <span className="muted">· {stamp(sheet.submittedAt)}</span>
        {sheet.recordedOffline && <span className="muted"> · <WifiOff size={13} className="inline-ico" /> أُرسل بدون اتصال</span>}
        {sheet.status === 'returned' && <span className="muted"> · أُعيد فتحه: {sheet.returnedReason}</span>}
      </p>
      <div className="statusbar-actions">
        {canReopen && (
          <Button variant="ghost" icon={<Undo2 size={17} />} onClick={() => setReturnOpen(true)}>
            إعادة فتح اليوم
          </Button>
        )}
        <Button icon={<Printer size={17} />} onClick={() => window.print()}>
          طباعة كالورقة
        </Button>
        {waiting && (
          <Button variant="primary" busy={busy} icon={<Check size={17} />} onClick={() => void approve()}>
            {armed ? 'اضغط مرة ثانية للتأكيد' : 'اعتماد'}
          </Button>
        )}
      </div>

      <Dialog
        open={returnOpen}
        onClose={() => setReturnOpen(false)}
        title="إعادة فتح اليوم"
        footer={
          <>
            <Button variant="ghost" onClick={() => setReturnOpen(false)}>إلغاء</Button>
            <Button variant="primary" busy={busy} disabled={!reason.trim()} icon={<Undo2 size={17} />} onClick={() => void sendBack()}>
              إعادة الفتح
            </Button>
          </>
        }
      >
        <label className="field">
          <span className="label">لماذا يُعاد فتحه؟ يظهر هذا أعلى الصفحة عند موظف الموقع ليصحّح ثم يغلقه من جديد.</span>
          <textarea className="textarea" rows={3} value={reason} autoFocus onChange={(e) => setReason(e.target.value)} placeholder={returnPlaceholder} />
        </label>
      </Dialog>
    </div>
  )
}

/** A day with nothing sent yet: still being filled, expected later, or late. */
export function NoSheet({ date, drafting, noun, source, listHref }: {
  date: ISODate
  drafting: boolean
  noun: string
  source: string
  listHref: string
}) {
  const now = useNow(60_000)
  const today = todayISO()
  const gazaHour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Gaza' }).format(now))
  const late = date < addDays(today, -1) || (date === addDays(today, -1) && gazaHour >= 10)
  return (
    <div className="empty card">
      <span className="halo"><Clock size={30} /></span>
      <h3>{drafting ? `${noun} قيد التعبئة` : `لم يصل ${noun} هذا اليوم`}</h3>
      <p>
        {drafting
          ? `بدأ ${source} تعبئته ولم يرسله بعد. يظهر هنا كاملاً لحظة إرساله.`
          : date === today
            ? 'يصل عادة في نهاية اليوم بعد آخر تشغيلة.'
            : late
              ? `تأخر. تواصل مع ${source}.`
              : 'يصل عادة صباح اليوم التالي.'}
      </p>
      {late && !drafting && <Pill tone="warn">متأخر</Pill>}
      <Link to={listHref} className="btn">آخر ما وصل</Link>
    </div>
  )
}

/** The paper's signature line: who sent it and when, who approved it and when. */
export function Signatures({ sheet, names, sender }: { sheet: SheetMeta; names: Map<string, string>; sender: string }) {
  return (
    <div className="sign">
      <div>
        <span className={`sign-ico ${sheet.submittedAt ? 'ok' : 'wait'}`}>{sheet.submittedAt ? <CircleCheck size={18} /> : <Clock size={18} />}</span>
        <div>
          <b>{sheet.submittedAt ? `أرسله ${names.get(sheet.submittedBy ?? '') ?? sender}` : 'لم يُرسل بعد'}</b>
          <span>
            {stamp(sheet.submittedAt)} · بتوقيت الخادم
            {sheet.recordedOffline && <><WifiOff size={13} className="inline-ico" /> أُرسل بدون اتصال</>}
          </span>
        </div>
      </div>
      <div>
        <span className={`sign-ico ${sheet.approvedAt ? 'ok' : 'wait'}`}>{sheet.approvedAt ? <CircleCheck size={18} /> : <Clock size={18} />}</span>
        <div>
          <b>{sheet.approvedAt ? `اعتمده ${names.get(sheet.approvedBy ?? '') ?? 'المدير'}` : 'اعتماد المدير'}</b>
          <span>{sheet.approvedAt ? stamp(sheet.approvedAt) : sheet.status === 'returned' ? 'أُعيد فتحه' : 'بانتظار الاعتماد'}</span>
        </div>
      </div>
    </div>
  )
}

/** The day's warnings; red before amber. */
export function AlertsCard({ alerts }: { alerts: Array<{ id: string; level: 'warn' | 'danger'; title: string; detail: string }> }) {
  if (!alerts.length) return null
  return (
    <section className="card">
      <div className="card-h"><span className="ico-round"><TriangleAlert size={16} /></span><h2>تنبيهات هذا اليوم</h2></div>
      <ul className="alerts">
        {alerts.map((a) => (
          <li key={a.id} className={`alert ${a.level}`}>
            <span className="alert-ico" aria-hidden="true"><TriangleAlert size={17} /></span>
            <div>
              <b>{a.title}</b>
              <span>{a.detail}</span>
            </div>
            <span className="sr-only">{a.level === 'danger' ? 'خطر' : 'تحذير'}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export interface HistoryItem {
  id: string
  date: ISODate
  status: SheetStatus
  figures: ReactNode
  href: string
}

/** Earlier days for the person who fills the form, newest first, with a shortcut to today's. */
export function SheetHistory({ title, items, todayMissing, todayLabel, todayHref = '/', emptyText }: {
  title: string
  /** Where today's form is filled. */
  todayHref?: string
  items: HistoryItem[] | undefined
  todayMissing: boolean
  todayLabel: string
  emptyText: string
}) {
  const today = todayISO()
  return (
    <div className="history">
      <header className="ph">
        <div>
          <h1>{title}</h1>
          <p className="muted">اضغط أي يوم لعرضه كما وصل للمدير.</p>
        </div>
      </header>
      {todayMissing && (
        <Link to={todayHref} className="cta glass">
          <span className="cta-ico"><ClipboardList size={22} /></span>
          <span><b>{todayLabel} لم يبدأ بعد</b><small>ابدأ التعبئة الآن</small></span>
          <ChevronLeft size={20} />
        </Link>
      )}
      {!items ? (
        <div className="loading-block" aria-busy="true" />
      ) : items.length === 0 ? (
        <div className="empty card"><h3>لا شيء بعد</h3><p>{emptyText}</p></div>
      ) : (
        <ul className="history-list">
          {items.map((it) => (
            <li key={it.id}>
              <Link to={it.href} className="history-item card">
                <span className="history-day">
                  <b>{dayName(it.date, today)}</b>
                  <small className="num">{describeDay(it.date).date}</small>
                </span>
                <span className="history-figures num">{it.figures}</span>
                <Pill tone={statusInfo[it.status].tone}>{statusInfo[it.status].label}</Pill>
                <ChevronLeft size={18} className="muted" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
