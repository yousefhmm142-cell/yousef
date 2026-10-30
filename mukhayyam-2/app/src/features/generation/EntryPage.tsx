import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, ArrowRight, CircleAlert, Droplet, Send, WifiOff, Wrench, Zap } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { useEmployee } from '../../auth/AuthProvider'
import { serverNow } from '../../lib/clock'
import { dayName, describeDay, isISODate, todayISO, type ISODate } from '../../lib/dates'
import { formatAmount } from '../../lib/numbers'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { useOnline } from '../../lib/useOnline'
import { advanceOnEnter } from '../../ui/form'
import { Button } from '../../ui/primitives'
import { useToast } from '../../ui/Toast'
import { SaveBadge, SentHeader, Stepper, UnsentBanner } from '../sheets/ui'
import { useConfirmTap, useDraft } from '../sheets/useDraft'
import { FuelStep, MaintenanceStep, MissingList, NotesField, RunsStep } from './EntrySteps'
import { applyAutoFigures, isEditableStatus, missingItems, newReport, reconcileReport, reportTotals, type FuelType, type Generator, type SiteReport } from './model'
import { lastReportBefore, saveDraft, submitReport, useFuelTypes, useGenerators, useReport, useUnsentBefore } from './repo'
import { ReportView, useReportContext } from './ReportView'

const STEPS = [
  { key: 'fuel', label: 'المحروقات', icon: Droplet },
  { key: 'runs', label: 'التشغيل', icon: Zap },
  { key: 'maintenance', label: 'الصيانات', icon: Wrench },
  { key: 'send', label: 'الإرسال', icon: Send },
] as const

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
  const { doc: report, update: rawUpdate, flush, saveState, latest } = useDraft<SiteReport>(
    () =>
      applyAutoFigures(
        initial
          ? initial.status === 'draft' ? reconcileReport(initial, fuelTypes, generators) : structuredClone(initial)
          : newReport(date, fuelTypes, generators, employee.id, previous, serverNow().toISOString()),
        previous,
      ),
    saveDraft,
    !!initial,
  )
  // Every change also refreshes the worked-out figures (totals, remaining, running hours).
  const update: typeof rawUpdate = (change) =>
    rawUpdate((r) => {
      change(r)
      applyAutoFigures(r, previous)
    })
  const [armed, arm, disarm] = useConfirmTap()
  const [sending, setSending] = useState(false)
  const unsent = useUnsentBefore(date)

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

  async function send() {
    if (!armed) return arm()
    setSending(true)
    try {
      await flush()
      await submitReport(latest.current, employee, !online)
      toast(online ? 'أُغلق التقرير ووصل للمدير' : 'أُغلق التقرير، ويصل للمدير عند عودة الاتصال')
    } catch {
      toast('تعذّر الإرسال. حاول مرة أخرى.', 'danger')
      setSending(false)
      disarm()
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
          <p>أعاد المدير فتح اليوم<span>{report.returnedReason}</span></p>
        </div>
      )}
      {date === todayISO() && <UnsentBanner sheets={unsent ?? []} hrefFor={(d) => `/entry/${d}`} title="تقارير لم تُرسل بعد" />}

      <Stepper
        label="خطوات التقرير"
        current={stepIndex}
        onSelect={goTo}
        items={STEPS.map((s, i) => ({ ...s, done: i < 3 && !missing.some((m) => m.step === i) }))}
      />

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
            {!online && <OfflineSendNote />}
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
            {armed ? (missing.length ? `تأكيد الإرسال مع ${missing.length} حقول فارغة` : 'اضغط مرة ثانية للتأكيد') : 'إغلاق اليوم وإرسال'}
          </Button>
        )}
      </footer>
    </div>
  )
}

export function OfflineSendNote() {
  return (
    <div className="banner">
      <WifiOff size={18} />
      <p>لا يوجد اتصال الآن<span>اضغط «إغلاق اليوم» كالمعتاد؛ يُحفظ على جوالك ويصل للمدير وحده عند عودة الاتصال.</span></p>
    </div>
  )
}

/** After sending: what was sent, and whether the manager approved it. */
function SentReport({ report }: { report: SiteReport }) {
  const ctx = useReportContext(report)
  const unsent = useUnsentBefore(report.reportDate)
  return (
    <div className="entry">
      <SentHeader sheet={report} date={report.reportDate} noun="التقرير" />
      {report.reportDate === todayISO() && <UnsentBanner sheets={unsent ?? []} hrefFor={(d) => `/entry/${d}`} title="تقارير لم تُرسل بعد" />}
      {ctx.ready ? <ReportView report={report} ctx={ctx} /> : <div className="loading-block" aria-busy="true" />}
    </div>
  )
}
