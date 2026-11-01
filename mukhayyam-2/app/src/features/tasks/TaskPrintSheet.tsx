import { describeDay, type ISODate } from '../../lib/dates'
import { formatTime } from '../../lib/format'
import { durationText, elapsedMinutes, priorityInfo, taskStatusInfo, type Task, type TaskType } from './model'
import type { Employee } from '../../types'
import { taskMatrix } from '../reports/build'
import { ReportTable } from '../reports/ReportsPage'
import { stamp } from '../sheets/ui'

const clock = (iso: string | null) => (iso ? formatTime(new Date(iso)) : '—')

/**
 * The day's field tasks on paper (landscape): one line per task with who, what, where, when it was
 * sent, started and finished, and how long it took; then the technician × task type totals, and
 * the signature line.
 */
export function TaskPrintSheet({ day, tasks, employees, types, zoneName }: {
  day: ISODate
  tasks: Task[]
  employees: Employee[]
  types: TaskType[]
  zoneName(id: number | null): string | null
}) {
  const now = new Date()
  const typeName = (id: number) => types.find((t) => t.id === id)?.name ?? 'مهمة'
  const person = (id: string) => employees.find((e) => e.id === id)?.fullName ?? '—'
  const sorted = [...tasks].sort((a, b) => a.number - b.number)
  const done = sorted.filter((t) => t.status === 'done')
  const avg = done.length ? Math.round(done.reduce((n, t) => n + elapsedMinutes(t, now), 0) / done.length) : null
  const matrix = taskMatrix(sorted, employees, types, 'print', 'المجموع حسب الفني ونوع المهمة')

  return (
    <div className="print-sheet landscape tasks-print" aria-hidden="true">
      <header className="ps-head">
        <img src="/logo.webp" alt="" className="ps-logo" />
        <div className="ps-title">
          <b>كشف المهام الميدانية · مخيم (2)</b>
          <span className="num">{describeDay(day).weekday} · {describeDay(day).date}</span>
        </div>
        <div className="ps-date">طُبع: <span className="num">{stamp(now.toISOString())}</span></div>
      </header>

      <p className="tp-summary">
        <span>عدد المهام: <b className="num">{sorted.length}</b></span>
        <span>أُنجزت: <b className="num">{done.length}</b></span>
        <span>مفتوحة: <b className="num">{sorted.filter((t) => t.status !== 'done' && t.status !== 'cancelled').length}</b></span>
        {avg !== null && <span>متوسط مدة الإنجاز: <b className="num">{durationText(avg)}</b></span>}
      </p>

      <table className="task-print">
        <colgroup>
          <col style={{ width: '4%' }} />
          <col style={{ width: '13%' }} />
          <col style={{ width: '13%' }} />
          <col style={{ width: '17%' }} />
          <col style={{ width: '9%' }} />
          <col style={{ width: '8%' }} />
          <col style={{ width: '8%' }} />
          <col style={{ width: '8%' }} />
          <col style={{ width: '7%' }} />
          <col style={{ width: '13%' }} />
        </colgroup>
        <thead>
          <tr>
            <th>#</th>
            <th>نوع المهمة</th>
            <th>الفني</th>
            <th>المشترك / المكان</th>
            <th>الحالة</th>
            <th>أُرسلت</th>
            <th>بدأ</th>
            <th>انتهى</th>
            <th>المدة</th>
            <th>ملاحظات</th>
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr><td colSpan={10}>لا مهام في هذا اليوم.</td></tr>
          ) : (
            sorted.map((t) => {
              const where = [t.subscriberName, zoneName(t.zoneId), t.location].filter(Boolean).join(' · ')
              const flags = [t.priority !== 'normal' ? priorityInfo[t.priority].label : '', t.cancelReason ? `ألغيت: ${t.cancelReason}` : '', t.completionNotes].filter(Boolean).join(' · ')
              return (
                <tr key={t.id}>
                  <td className="num">{t.number}</td>
                  <td className="tp-left"><b>{typeName(t.typeId)}</b>{t.details && <small>{t.details}</small>}</td>
                  <td>{person(t.assigneeId)}</td>
                  <td className="tp-left">{where || '—'}</td>
                  <td>{taskStatusInfo[t.status].label}</td>
                  <td className="num">{clock(t.sentAt)}</td>
                  <td className="num">{clock(t.startedAt)}</td>
                  <td className="num">{clock(t.completedAt)}</td>
                  <td className="num">{t.completedAt || t.status === 'in_progress' || t.sentAt ? durationText(elapsedMinutes(t, now)) : '—'}</td>
                  <td className="tp-left">{flags || ''}</td>
                </tr>
              )
            })
          )}
        </tbody>
      </table>

      {matrix.rows.length > 0 && sorted.length > 0 && (
        <div className="tp-matrix">
          <h2>{matrix.title}</h2>
          <ReportTable section={matrix} />
        </div>
      )}

      <footer className="ps-foot">
        <div><b>إعداد</b><span>نظام مخيم 2</span></div>
        <div><b>اعتماد المدير</b><span>&nbsp;</span></div>
      </footer>
    </div>
  )
}
