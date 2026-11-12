import { addDays, todayISO } from '../../lib/dates'
import { TrendChart } from '../reports/TrendChart'
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
      todayHref={`/entry/${today}`}
      emptyText="أول تقرير ترسله يظهر هنا."
      chart={reports && reports.some((r) => r.status !== 'draft') ? (
        <TrendChart
          title="الاستهلاك بآخر 30 يوم"
          unit="لتر"
          empty="ما في تقارير بآخر 30 يوم."
          points={Array.from({ length: 30 }, (_, i) => addDays(today, i - 29)).map((date) => {
            const r = reports.find((x) => x.reportDate === date && x.status !== 'draft')
            return { date, value: r ? reportTotals(r).consumption : null }
          })}
        />
      ) : undefined}
      todayMissing={!!reports && !reports.some((r) => r.reportDate === today)}
      items={reports?.map((r) => {
        const t = reportTotals(r)
        return {
          id: r.id,
          date: r.reportDate,
          status: r.status,
          href: isEditableStatus(r.status) ? `/entry/${r.reportDate}` : `/generation/${r.reportDate}`,
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
