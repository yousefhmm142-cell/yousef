import { LayoutGrid } from 'lucide-react'
import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useEmployee } from '../../auth/AuthProvider'
import { useLiveSheets } from '../../data/sync'
import { addDays, describeDay, isISODate, type ISODate } from '../../lib/dates'
import { setViewDay, useToday, useViewDay } from '../../lib/viewDay'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { isManagerRole } from '../../types'
import { DateNav, NoSheet, StatusBar } from '../sheets/ui'
import { isEditableStatus } from '../sheets/workflow'
import { PrintSheet } from './PrintSheet'
import { approveSheet, returnSheet, useSheet } from './repo'
import { SheetView, useSheetContext } from './SheetView'

/** /distribution and /distribution/:date: the day's sheet as the manager sees it. */
export function SheetPage() {
  const params = useParams()
  const viewDay = useViewDay()
  const date = isISODate(params.date) ? params.date : viewDay
  // The day picked here stays picked on the other pages (distribution, reports).
  useEffect(() => {
    if (isISODate(params.date)) setViewDay(params.date)
  }, [params.date])
  return <SheetForDay date={date} />
}

function SheetForDay({ date }: { date: ISODate }) {
  const navigate = useNavigate()
  const employee = useEmployee()
  const sheet = useSheet(date)
  const today = useToday()
  // Still being filled (or not started yet today): follow it live.
  useLiveSheets(date >= addDays(today, -1) && (sheet === null || (sheet !== undefined && isEditableStatus(sheet.status))))
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
      ) : !sheet ? (
        <NoSheet date={date} drafting={false} noun="الكشف" source="مشرف التوزيع" listHref="/distribution" />
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
