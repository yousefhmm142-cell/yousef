import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, ArrowRight, Check, CircleAlert, CircleCheck, Clock, Droplet, Send, WifiOff, Wrench, Zap } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { useEmployee } from '../../auth/AuthProvider'
import { db } from '../../data/db'
import { serverNow } from '../../lib/clock'
import { addDays, dayName, describeDay, isISODate, todayISO, type ISODate } from '../../lib/dates'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { useOnline } from '../../lib/useOnline'
import { formatAmount } from '../../lib/numbers'
import { advanceOnEnter } from '../../ui/form'
import { Button, Pill } from '../../ui/primitives'
import { useToast } from '../../ui/Toast'
import { FuelStep, MaintenanceStep, MissingList, NotesField, RunsStep } from './EntrySteps'
import { isEditableStatus, missingItems, newReport, reconcileReport, reportTotals, statusInfo, type FuelType, type Generator, type SiteReport } from './model'
import { lastReportBefore, saveDraft, submitReport, useFuelTypes, useGenerators, useReport } from './repo'
import { ReportView, stamp, useReportContext } from './ReportView'

const STEPS = [
  { key: 'fuel', label: 'المحروقات', icon: Droplet },
  { key: 'runs', label: 'التشغيل', icon: Zap },
  { key: 'maintenance', label: 'الصيانات', icon: Wrench },
  { key: 'send', label: 'الإرسال', icon: Send },
] as const

const SAVE_DELAY_MS = 350

/** The site operator's report for one day: today by default, or /entry/:date. */
export function EntryPage() {
  const params = useParams()
  const today = todayISO()
  const date: ISODate = isISODate(params.date) ? params.date : today
  const stored = useReport(date)
  const fuelTypes = useFuelTypes()
  const generators = useGenerators()
  const previous = useLiveQuery(() => lastReportBefore(date), [date])
  useDocumentTitle(date === today ? 'تقرير اليوم' : `تقرير ${dayName(date, today)}`)

  if (date > today) {
    return <div className="empty"><h3>لا يمكن تعبئة يوم لم يأتِ بعد</h3><Link to="/" className="btn">تقرير اليوم</Link></div>
  }
  if (stored === undefined || !fuelTypes || !generators || previous === undefined) {
    return <div className="loading-block" aria-busy="true" />
  }
  if (stored && !isEditableStatus(stored.status)) return <SentReport report={stored} />
  if (fuelTypes.length === 0 || generators.length === 0) {
    return (
      <div className="empty">
        <h3>لم تُعرَّف المولدات بعد</h3>
        <p>يضيفها مسؤول النظام من الإعدادات مرة واحدة، ثم تظهر هنا كل يوم.</p>
      </div>
    )
  }
  return <EntryForm key={date} date={date} initial={stored} fuelTypes={fuelTypes} generators={generators} previous={previous} />
}

function EntryForm({ date, initial, fuelTypes, generators, previous }: {
  date: ISODate
  initial: SiteReport | null
  fuelTypes: FuelType[]
  generators: Generator[]
  previous: SiteReport | null
}) {
  const employee = useEmployee()
  const online = useOnline()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const stepIndex = Math.max(0, STEPS.findIndex((s) => s.key === params.get('step')))

  const [report, setReport] = useState<SiteReport>(() =>
    initial
      ? initial.status === 'draft' ? reconcileReport(initial, fuelTypes, generators) : initial
      : newReport(date, fuelTypes, generators, employee.id, previous, serverNow().toISOString()),
  )
  const latest = useRef(report)
  const timer = useRef<number | undefined>(undefined)
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error' | 'idle'>(initial ? 'saved' : 'idle')
  const [confirming, setConfirming] = useState(false)
  const [sending, setSending] = useState(false)

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current)
    timer.current = undefined
    try {
      setSaveState('saving')
      await saveDraft(latest.current)
      setSaveState('saved')
    } catch {
      setSaveState('error')
    }
  }, [])

  const update = useCallback(
    (change: (draft: SiteReport) => void) => {
      const next = structuredClone(latest.current)
      change(next)
      latest.current = next
      setReport(next)
      setSaveState('saving')
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => void flush(), SAVE_DELAY_MS)
    },
    [flush],
  )

  // Never lose typing: save when the app goes to the background or this screen closes.
  useEffect(() => {
    const onHide = () => {
      if (timer.current !== undefined) void flush()
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onHide)
      onHide()
    }
  }, [flush])

  useEffect(() => {
    if (!confirming) return
    const id = window.setTimeout(() => setConfirming(false), 4000)
    return () => window.clearTimeout(id)
  }, [confirming])

  const goTo = (i: number) => {
    setParams(i === 0 ? {} : { step: STEPS[i]!.key })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const fuelName = (id: number) => fuelTypes.find((f) => f.id === id)?.name ?? 'وقود'
  const genName = (id: number) => generators.find((g) => g.id === id)?.name ?? 'مولد'
  const missingIn = (part: Partial<SiteReport>) => missingItems({ ...report, fuel: [], generators: [], maintenance: [], ...part }, fuelName, genName)
  const missing = [
    ...missingIn({ fuel: report.fuel }).map((text) => ({ text, step: 0 })),
    ...missingIn({ generators: report.generators }).map((text) => ({ text, step: 1 })),
    ...missingIn({ maintenance: report.maintenance }).map((text) => ({ text, step: 2 })),
  ]
  const stepDone = (i: number) => (i === 3 ? false : !missing.some((m) => m.step === i))

  async function send() {
    if (!confirming) return setConfirming(true)
    setSending(true)
    try {
      await flush()
      await submitReport(latest.current, employee, !online)
      toast(online ? 'أُرسل التقرير للمدير' : 'حُفظ الإرسال، ويصل للمدير عند عودة الاتصال')
    } catch {
      toast('تعذّر الإرسال. حاول مرة أخرى.', 'danger')
      setSending(false)
      setConfirming(false)
    }
  }

  const { weekday, date: longDate } = describeDay(date)
  const totals = reportTotals(report)
  const step = STEPS[stepIndex]!

  return (
    <div className="entry">
      <header className="entry-head">
        <div>
          <h1>{date === todayISO() ? 'تقرير اليوم' : `تقرير ${dayName(date)}`}</h1>
          <p className="muted">{weekday} · <span className="num">{longDate}</span></p>
        </div>
        <SaveBadge state={saveState} online={online} />
      </header>

      {report.status === 'returned' && (
        <div className="banner danger" role="alert">
          <CircleAlert size={18} />
          <p>أعاده المدير للتصحيح<span>{report.returnedReason}</span></p>
        </div>
      )}
      {date === todayISO() && <UnsentEarlier before={date} />}

      <nav className="stepper" aria-label="خطوات التقرير">
        {STEPS.map((s, i) => (
          <button
            key={s.key}
            type="button"
            className="step"
            aria-current={i === stepIndex ? 'step' : undefined}
            data-done={stepDone(i) || undefined}
            onClick={() => goTo(i)}
          >
            <span className="step-dot">{stepDone(i) && i !== stepIndex ? <Check size={14} strokeWidth={3} /> : <s.icon size={15} />}</span>
            <span className="step-label">{s.label}</span>
          </button>
        ))}
      </nav>

      <div className="entry-body" onKeyDown={advanceOnEnter}>
        {step.key === 'fuel' && <FuelStep report={report} fuelTypes={fuelTypes} previous={previous} update={update} />}
        {step.key === 'runs' && <RunsStep report={report} generators={generators} update={update} />}
        {step.key === 'maintenance' && <MaintenanceStep report={report} generators={generators} update={update} />}
        {step.key === 'send' && (
          <>
            <NotesField report={report} update={update} />
            <section className="card summary">
              <div className="summary-row"><Droplet size={17} /><span>المحروقات</span><b className="num">استهلاك {formatAmount(totals.consumption)} · متبقي {formatAmount(totals.remaining)} لتر</b></div>
              <div className="summary-row"><Zap size={17} /><span>التشغيل</span><b className="num">{totals.generatorsRan} مولدات · {formatAmount(totals.runHours)} ساعة</b></div>
              <div className="summary-row"><Wrench size={17} /><span>الصيانات</span><b className="num">{report.maintenance.length ? `${report.maintenance.length} عملية` : 'لا شيء'}</b></div>
            </section>
            <MissingList items={missing} onJump={goTo} />
            {!online && (
              <div className="banner">
                <WifiOff size={18} />
                <p>لا يوجد اتصال الآن<span>اضغط إرسال كالمعتاد؛ يُحفظ على جوالك ويصل للمدير وحده عند عودة الاتصال.</span></p>
              </div>
            )}
          </>
        )}
      </div>

      <footer className="entry-foot glass">
        {stepIndex > 0 && (
          <Button icon={<ArrowRight size={18} />} onClick={() => goTo(stepIndex - 1)} aria-label="الخطوة السابقة">
            <span className="hide-sm">السابق</span>
          </Button>
        )}
        {step.key !== 'send' ? (
          <Button variant="primary" size="lg" block onClick={() => goTo(stepIndex + 1)}>
            التالي: {STEPS[stepIndex + 1]!.label}
            <ArrowLeft size={18} />
          </Button>
        ) : (
          <Button variant="primary" size="lg" block busy={sending} icon={<Send size={18} />} onClick={() => void send()}>
            {confirming ? (missing.length ? `تأكيد الإرسال مع ${missing.length} حقول فارغة` : 'اضغط مرة ثانية للتأكيد') : 'إرسال للمدير'}
          </Button>
        )}
      </footer>
    </div>
  )
}

function SaveBadge({ state, online }: { state: 'saved' | 'saving' | 'error' | 'idle'; online: boolean }) {
  if (state === 'error') return <Pill tone="danger">تعذّر الحفظ</Pill>
  if (state === 'idle') return <span className="save-badge muted">يُحفظ أثناء الكتابة</span>
  return (
    <span className={`save-badge ${online ? '' : 'offline'}`} role="status">
      {state === 'saving' ? <span className="spinner sm" /> : online ? <CircleCheck size={16} /> : <WifiOff size={16} />}
      {state === 'saving' ? 'يُحفظ…' : 'محفوظ على الجهاز'}
    </span>
  )
}

/** Reminds the operator about an earlier day that was started or returned but not sent. */
function UnsentEarlier({ before }: { before: ISODate }) {
  const earlier = useLiveQuery(
    async () => (await db.siteReports.where('reportDate').between(addDays(before, -14), before).toArray()).filter((r) => isEditableStatus(r.status)),
    [before],
  )
  if (!earlier?.length) return null
  return (
    <div className="banner info">
      <Clock size={18} />
      <p>
        تقارير لم تُرسل بعد
        <span>
          {earlier.map((r, i) => (
            <span key={r.id}>
              {i > 0 && '، '}
              <Link to={`/entry/${r.reportDate}`}>تقرير {dayName(r.reportDate)} ({statusInfo[r.status].label})</Link>
            </span>
          ))}
        </span>
      </p>
    </div>
  )
}

/** After sending: what was sent, and whether the manager approved it. */
function SentReport({ report }: { report: SiteReport }) {
  const ctx = useReportContext(report)
  const approved = report.status === 'approved'
  const { weekday, date } = describeDay(report.reportDate)
  return (
    <div className="entry">
      <section className={`sent glass ${approved ? 'ok' : 'wait'}`}>
        <span className="sent-ring" aria-hidden="true">{approved ? <CircleCheck size={30} /> : <Send size={26} />}</span>
        <div>
          <h1>{approved ? 'اعتمد المدير التقرير' : 'أُرسل التقرير للمدير'}</h1>
          <p>
            {weekday} · <span className="num">{date}</span>
            {' · '}
            {approved ? stamp(report.approvedAt) : `أُرسل ${stamp(report.submittedAt)}`}
          </p>
        </div>
        <Pill tone={statusInfo[report.status].tone}>{statusInfo[report.status].label}</Pill>
      </section>
      {report.reportDate === todayISO() && <UnsentEarlier before={report.reportDate} />}
      {ctx.ready ? <ReportView report={report} ctx={ctx} /> : <div className="loading-block" aria-busy="true" />}
    </div>
  )
}
