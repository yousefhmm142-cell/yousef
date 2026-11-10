import { todayISO } from '../../lib/dates'
import { formatAmount } from '../../lib/numbers'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { SheetHistory } from '../sheets/ui'
import { isEditableStatus } from '../sheets/workflow'
import { sheetTotals } from './model'
import { useAllSheets } from './repo'

/** The site's earlier distribution sheets, newest first. */
export function DistributionHistoryPage() {
  useDocumentTitle('الكشوف السابقة')
  const sheets = useAllSheets()
  const today = todayISO()
  return (
    <SheetHistory
      title="الكشوف السابقة"
      todayLabel="كشف اليوم"
      todayHref="/sheet"
      emptyText="أول كشف ترسله يظهر هنا."
      todayMissing={!!sheets && !sheets.some((s) => s.sheetDate === today)}
      items={sheets?.map((s) => {
        const t = sheetTotals(s)
        return {
          id: s.id,
          date: s.sheetDate,
          status: s.status,
          href: isEditableStatus(s.status) ? (s.sheetDate === today ? '/sheet' : `/sheet/${s.sheetDate}`) : `/distribution/${s.sheetDate}`,
          figures: (
            <>
              <span>ساعات <b>{formatAmount(t.totalHours)}</b></span>
              <span>تشغيلات <b>{t.runs}</b></span>
            </>
          ),
        }
      })}
    />
  )
}
