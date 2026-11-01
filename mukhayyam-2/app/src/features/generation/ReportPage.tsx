import { PencilLine, Zap } from 'lucide-react'
import { useEffect } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useEmployee } from '../../auth/AuthProvider'
import { useLiveSheets } from '../../data/sync'
import { addDays, describeDay, isISODate, type ISODate } from '../../lib/dates'
import { setViewDay, useToday, useViewDay } from '../../lib/viewDay'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { isManagerRole } from '../../types'
import { DateNav, NoSheet, StatusBar } from '../sheets/ui'
import { isEditableStatus } from '../sheets/workflow'
import { PrintSheet } from './PrintSheet'
import { approveReport, returnReport, useReport } from './repo'
import { ReportView, useReportContext } from './ReportView'

/** /generation and /generation/:date: the day's report as the manager sees it. */
export function ReportPage() {
  const params = useParams()
  const viewDay = useViewDay()
  const date = isISODate(params.date) ? params.date : viewDay
  // The day picked here stays picked on the other pages (distribution, reports).
  useEffect(() => {
    if (isISODate(params.date)) setViewDay(params.date)
  }, [params.date])
  return <ReportForDay date={date} />
}

function ReportForDay({ date }: { date: ISODate }) {
  const navigate = useNavigate()
  const employee = useEmployee()
  const report = useReport(date)
  const today = useToday()
  // Still being filled (or not started yet today): follow it live.
  useLiveSheets(date >= addDays(today, -1) && (report === null || (report !== undefined && isEditableStatus(report.status))))
  const ctx = useReportContext(report)
  // The manager fills the day's report too: open (or continue) it for the day being viewed.
  const canFill = report !== undefined && date <= today && (report === null || isEditableStatus(report.status))
  useDocumentTitle(`تقرير التوليد · ${describeDay(date).weekday}`)

  return (
    <div className="report-page">
      <header className="ph">
        <div>
          <div className="eyebrow"><Zap size={14} /> التوليد · التقرير اليومي</div>
          <h1>تقرير موقع التوليد</h1>
        </div>
        <div className="ph-actions">
          {canFill && (
            <Link to={`/entry/${date}`} className="btn primary fill-btn">
              <PencilLine size={17} /> {report ? 'متابعة تعبئة التقرير' : 'تعبئة التقرير'}
            </Link>
          )}
          <DateNav date={date} onChange={(d) => navigate(`/generation/${d}`)} />
        </div>
      </header>

      {report === undefined || !ctx.ready ? (
        <div className="loading-block" aria-busy="true" />
      ) : !report ? (
        <NoSheet date={date} drafting={false} noun="التقرير" source="موقع التوليد" listHref="/generation" />
      ) : (
        <>
          <StatusBar
            sheet={report}
            source="موقع التوليد"
            canAct={isManagerRole(employee.role)}
            onApprove={() => approveReport(report.id, employee)}
            onReturn={(reason) => returnReport(report.id, reason)}
            returnPlaceholder="مثال: الرصيد الموجود لا يطابق متبقي أمس"
          />
          <ReportView report={report} ctx={ctx} />
          <PrintSheet report={report} generators={ctx.generators} fuelTypes={ctx.fuelTypes} names={ctx.names} />
        </>
      )}
    </div>
  )
}
