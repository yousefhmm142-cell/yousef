import { LayoutGrid } from 'lucide-react'
import { useNavigate, useParams } from 'react-router'
import { useEmployee } from '../../auth/AuthProvider'
import { addDays, describeDay, isISODate, todayISO, type ISODate } from '../../lib/dates'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { isManagerRole } from '../../types'
import { DateNav, NoSheet, StatusBar } from '../sheets/ui'
import { PrintSheet } from './PrintSheet'
import { approveSheet, returnSheet, useLatestSentSheet, useSheet } from './repo'
import { SheetView, useSheetContext } from './SheetView'

/** /distribution and /distribution/:date: the day's sheet as the manager sees it. */
export function SheetPage() {
  const params = useParams()
  const latest = useLatestSentSheet()
  if (isISODate(params.date)) return <SheetForDay date={params.date} />
  if (latest === undefined) return <div className="loading-block" aria-busy="true" />
  return <SheetForDay date={latest?.sheetDate ?? addDays(todayISO(), -1)} />
}

function SheetForDay({ date }: { date: ISODate }) {
  const navigate = useNavigate()
  const employee = useEmployee()
  const sheet = useSheet(date)
  const ctx = useSheetContext(sheet)
  useDocumentTitle(`كشف التوزيع · ${describeDay(date).weekday}`)

  return (
    <div className="report-page">
      <header className="ph">
        <div>
          <div className="eyebrow"><LayoutGrid size={14} /> التوزيع · الكشف اليومي</div>
          <h1>كشف التوزيع والأحمال</h1>
        </div>
        <DateNav date={date} onChange={(d) => navigate(`/distribution/${d}`)} />
      </header>

      {sheet === undefined || !ctx.ready ? (
        <div className="loading-block" aria-busy="true" />
      ) : !sheet || sheet.status === 'draft' ? (
        <NoSheet date={date} drafting={sheet?.status === 'draft'} noun="الكشف" source="مشرف التوزيع" listHref="/distribution" />
      ) : (
        <>
          <StatusBar
            sheet={sheet}
            source="مشرف التوزيع"
            canAct={isManagerRole(employee.role)}
            onApprove={() => approveSheet(sheet.id, employee)}
            onReturn={(reason) => returnSheet(sheet.id, reason)}
            returnPlaceholder="مثال: أحمال التشغيلة الثانية في الرازي غير منطقية"
          />
          <SheetView sheet={sheet} ctx={ctx} />
          <PrintSheet sheet={sheet} zoneNames={ctx.zoneNames} names={ctx.names} />
        </>
      )}
    </div>
  )
}
