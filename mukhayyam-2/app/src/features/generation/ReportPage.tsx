import { Zap } from 'lucide-react'
import { useNavigate, useParams } from 'react-router'
import { useEmployee } from '../../auth/AuthProvider'
import { addDays, describeDay, isISODate, todayISO, type ISODate } from '../../lib/dates'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { isManagerRole } from '../../types'
import { DateNav, NoSheet, StatusBar } from '../sheets/ui'
import { PrintSheet } from './PrintSheet'
import { approveReport, returnReport, useLatestSentReport, useReport } from './repo'
import { ReportView, useReportContext } from './ReportView'

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
  const report = useReport(date)
  const ctx = useReportContext(report)
  useDocumentTitle(`تقرير التوليد · ${describeDay(date).weekday}`)

  return (
    <div className="report-page">
      <header className="ph">
        <div>
          <div className="eyebrow"><Zap size={14} /> التوليد · التقرير اليومي</div>
          <h1>تقرير موقع التوليد</h1>
        </div>
        <DateNav date={date} onChange={(d) => navigate(`/generation/${d}`)} />
      </header>

      {report === undefined || !ctx.ready ? (
        <div className="loading-block" aria-busy="true" />
      ) : !report || report.status === 'draft' ? (
        <NoSheet date={date} drafting={report?.status === 'draft'} noun="التقرير" source="موقع التوليد" listHref="/generation" />
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
