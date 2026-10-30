import { todayISO } from '../../lib/dates'
import { formatAmount } from '../../lib/numbers'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { SheetHistory } from '../sheets/ui'
import { isEditableStatus, reportTotals } from './model'
import { useAllReports } from './repo'

/** The site operator's earlier reports, newest first. */
export function HistoryPage() {
  useDocumentTitle('التقارير السابقة')
  const reports = useAllReports()
  const today = todayISO()
  return (
    <SheetHistory
      title="التقارير السابقة"
      todayLabel="تقرير اليوم"
      emptyText="أول تقرير ترسله يظهر هنا."
      todayMissing={!!reports && !reports.some((r) => r.reportDate === today)}
      items={reports?.map((r) => {
        const t = reportTotals(r)
        return {
          id: r.id,
          date: r.reportDate,
          status: r.status,
          href: isEditableStatus(r.status) ? (r.reportDate === today ? '/' : `/entry/${r.reportDate}`) : `/generation/${r.reportDate}`,
          figures: (
            <>
              <span>استهلاك <b>{formatAmount(t.consumption)}</b></span>
              <span>متبقي <b>{formatAmount(t.remaining)}</b></span>
            </>
          ),
        }
      })}
    />
  )
}
