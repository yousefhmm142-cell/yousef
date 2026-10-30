import { CalendarDays, Check, ChevronLeft, ChevronRight, Clock, Printer, Undo2, WifiOff, Zap } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useEmployee } from '../../auth/AuthProvider'
import { addDays, dayName, describeDay, isISODate, todayISO, type ISODate } from '../../lib/dates'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { useNow } from '../../lib/useNow'
import { isManagerRole } from '../../types'
import { Dialog } from '../../ui/Dialog'
import { Button, Pill } from '../../ui/primitives'
import { useToast } from '../../ui/Toast'
import { statusInfo } from './model'
import { PrintSheet } from './PrintSheet'
import { approveReport, returnReport, useLatestSentReport, useReport } from './repo'
import { ReportView, stamp, useReportContext } from './ReportView'

/** /generation and /generation/:date: the day's report as the manager sees it. */
export function ReportPage() {
  const params = useParams()
  const latest = useLatestSentReport()
  if (isISODate(params.date)) return <ReportForDay date={params.date} />
  if (latest === undefined) return <div className="loading-block" aria-busy="true" />
  return <ReportForDay date={latest?.reportDate ?? addDays(todayISO(), -1)} />
}

function ReportForDay({ date }: { date: ISODate }) {
  const navigate = useNavigate()
  const employee = useEmployee()
  const toast = useToast()
  const report = useReport(date)
  const ctx = useReportContext(report)
  const today = todayISO()
  const canAct = isManagerRole(employee.role)
  const [approving, setApproving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [returnOpen, setReturnOpen] = useState(false)
  const [reason, setReason] = useState('')
  const dateInput = useRef<HTMLInputElement>(null)
  const { weekday, date: longDate } = describeDay(date)
  useDocumentTitle(`تقرير التوليد · ${weekday}`)

  const go = (d: ISODate) => {
    if (d <= today) navigate(`/generation/${d}`)
  }

  // Arrow keys move between days on a laptop (right = earlier, as the page reads right to left).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, dialog')) return
      if (e.key === 'ArrowRight') go(addDays(date, -1))
      if (e.key === 'ArrowLeft') go(addDays(date, 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  useEffect(() => {
    if (!approving) return
    const id = window.setTimeout(() => setApproving(false), 4000)
    return () => window.clearTimeout(id)
  }, [approving])

  async function approve() {
    if (!report) return
    if (!approving) return setApproving(true)
    setBusy(true)
    try {
      await approveReport(report.id, employee)
      toast('اعتُمد التقرير')
    } catch {
      toast('تعذّر الاعتماد. حدّث الصفحة وحاول مرة أخرى.', 'danger')
    } finally {
      setBusy(false)
      setApproving(false)
    }
  }

  async function sendBack() {
    if (!report || !reason.trim()) return
    setBusy(true)
    try {
      await returnReport(report.id, reason)
      setReturnOpen(false)
      setReason('')
      toast('أُعيد التقرير للمشغّل للتصحيح')
    } catch {
      toast('تعذّرت الإعادة. حاول مرة أخرى.', 'danger')
    } finally {
      setBusy(false)
    }
  }

  const visible = report && report.status !== 'draft'
  const info = report ? statusInfo[report.status] : null

  return (
    <div className="report-page">
      <header className="ph">
        <div>
          <div className="eyebrow"><Zap size={14} /> التوليد · التقرير اليومي</div>
          <h1>تقرير موقع التوليد</h1>
        </div>
        <div className="datenav glass">
          <button type="button" aria-label="اليوم السابق" onClick={() => go(addDays(date, -1))}>
            <ChevronRight size={20} />
          </button>
          <div className="datenav-label">
            <b>{dayName(date, today) === weekday ? weekday : `${dayName(date, today)} · ${weekday}`}</b>
            <small className="num">{longDate}</small>
          </div>
          <button type="button" aria-label="اليوم التالي" disabled={date >= today} onClick={() => go(addDays(date, 1))}>
            <ChevronLeft size={20} />
          </button>
          <button type="button" aria-label="اختيار يوم من التقويم" onClick={() => dateInput.current?.showPicker?.()}>
            <CalendarDays size={18} />
          </button>
          <input
            ref={dateInput}
            type="date"
            className="sr-only"
            tabIndex={-1}
            max={today}
            value={date}
            onChange={(e) => isISODate(e.target.value) && go(e.target.value)}
          />
        </div>
      </header>

      {report === undefined || !ctx.ready ? (
        <div className="loading-block" aria-busy="true" />
      ) : !visible ? (
        <NoReport date={date} drafting={report?.status === 'draft'} />
      ) : (
        <>
          <div className="statusbar glass">
            <Pill tone={info!.tone}>{info!.label}</Pill>
            <p>
              وصل من موقع التوليد <span className="muted">· {stamp(report.submittedAt)}</span>
              {report.recordedOffline && <span className="muted"> · <WifiOff size={13} className="inline-ico" /> أُرسل بدون اتصال</span>}
              {report.status === 'returned' && <span className="muted"> · السبب: {report.returnedReason}</span>}
            </p>
            <div className="statusbar-actions">
              {canAct && report.status === 'submitted' && (
                <Button variant="ghost" icon={<Undo2 size={17} />} onClick={() => setReturnOpen(true)}>
                  إعادة للتصحيح
                </Button>
              )}
              <Button icon={<Printer size={17} />} onClick={() => window.print()}>
                طباعة كالورقة
              </Button>
              {canAct && report.status === 'submitted' && (
                <Button variant="primary" busy={busy} icon={<Check size={17} />} onClick={() => void approve()}>
                  {approving ? 'اضغط مرة ثانية للتأكيد' : 'اعتماد التقرير'}
                </Button>
              )}
            </div>
          </div>
          <ReportView report={report} ctx={ctx} />
          <PrintSheet report={report} generators={ctx.generators} fuelTypes={ctx.fuelTypes} names={ctx.names} />
        </>
      )}

      <Dialog
        open={returnOpen}
        onClose={() => setReturnOpen(false)}
        title="إعادة التقرير للتصحيح"
        footer={
          <>
            <Button variant="ghost" onClick={() => setReturnOpen(false)}>إلغاء</Button>
            <Button variant="primary" busy={busy} disabled={!reason.trim()} icon={<Undo2 size={17} />} onClick={() => void sendBack()}>
              إعادة للمشغّل
            </Button>
          </>
        }
      >
        <label className="field">
          <span className="label">ما الذي يحتاج تصحيحاً؟ يظهر هذا للمشغّل أعلى التقرير.</span>
          <textarea className="textarea" rows={3} value={reason} autoFocus onChange={(e) => setReason(e.target.value)} placeholder="مثال: الرصيد الموجود لا يطابق متبقي أمس" />
        </label>
      </Dialog>
    </div>
  )
}

function NoReport({ date, drafting }: { date: ISODate; drafting: boolean }) {
  const now = useNow(60_000)
  const today = todayISO()
  const gazaHour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Gaza' }).format(now))
  const late = date < addDays(today, -1) || (date === addDays(today, -1) && gazaHour >= 10)
  return (
    <div className="empty card">
      <span className="halo"><Clock size={30} /></span>
      <h3>{drafting ? 'التقرير قيد التعبئة في الموقع' : 'لم يصل تقرير هذا اليوم'}</h3>
      <p>
        {drafting
          ? 'بدأ المشغّل تعبئته ولم يرسله بعد. يظهر هنا كاملاً لحظة إرساله.'
          : date === today
            ? 'يصل عادة في نهاية اليوم بعد آخر تشغيلة.'
            : late
              ? 'تأخر هذا التقرير. تواصل مع موقع التوليد.'
              : 'يصل عادة صباح اليوم التالي.'}
      </p>
      {late && !drafting && <Pill tone="warn">متأخر</Pill>}
      <Link to="/generation" className="btn">آخر تقرير وصل</Link>
    </div>
  )
}
