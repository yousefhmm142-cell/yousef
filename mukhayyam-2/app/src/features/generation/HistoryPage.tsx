import { ChevronLeft, ClipboardList } from 'lucide-react'
import { Link } from 'react-router'
import { dayName, describeDay, todayISO } from '../../lib/dates'
import { formatAmount } from '../../lib/numbers'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { Pill } from '../../ui/primitives'
import { isEditableStatus, reportTotals, statusInfo } from './model'
import { useAllReports } from './repo'

/** The site operator's earlier reports, newest first. */
export function HistoryPage() {
  useDocumentTitle('التقارير السابقة')
  const reports = useAllReports()
  const today = todayISO()
  const todayReport = reports?.find((r) => r.reportDate === today)

  return (
    <div className="history">
      <header className="ph">
        <div>
          <h1>التقارير السابقة</h1>
          <p className="muted">اضغط أي يوم لعرضه كما وصل للمدير.</p>
        </div>
      </header>

      {!todayReport && (
        <Link to="/" className="cta glass">
          <span className="cta-ico"><ClipboardList size={22} /></span>
          <span><b>تقرير اليوم لم يبدأ بعد</b><small>ابدأ التعبئة الآن</small></span>
          <ChevronLeft size={20} />
        </Link>
      )}

      {!reports ? (
        <div className="loading-block" aria-busy="true" />
      ) : reports.length === 0 ? (
        <div className="empty card"><h3>لا تقارير بعد</h3><p>أول تقرير ترسله يظهر هنا.</p></div>
      ) : (
        <ul className="history-list">
          {reports.map((r) => {
            const t = reportTotals(r)
            const { date } = describeDay(r.reportDate)
            const info = statusInfo[r.status]
            const to = isEditableStatus(r.status) ? (r.reportDate === today ? '/' : `/entry/${r.reportDate}`) : `/generation/${r.reportDate}`
            return (
              <li key={r.id}>
                <Link to={to} className="history-item card">
                  <span className="history-day">
                    <b>{dayName(r.reportDate, today)}</b>
                    <small className="num">{date}</small>
                  </span>
                  <span className="history-figures num">
                    <span>استهلاك <b>{formatAmount(t.consumption)}</b></span>
                    <span>متبقي <b>{formatAmount(t.remaining)}</b></span>
                  </span>
                  <Pill tone={info.tone}>{info.label}</Pill>
                  <ChevronLeft size={18} className="muted" />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
