import { describeDay, type ISODate } from '../../lib/dates'
import type { Employee } from '../../types'
import { stamp } from '../sheets/ui'
import type { Task, TaskType } from './model'

/**
 * The paper form "متابعة مهام الكهربائية اليومية": a row per electrician, a column per task type,
 * and in each box the number of tasks that electrician finished that day (taken from the system,
 * not typed). Blank rows are left at the end for anything written by hand.
 */
export function TaskPrintSheet({ day, tasks, employees, types }: {
  day: ISODate
  /** Tasks finished on this day. */
  tasks: Task[]
  employees: Employee[]
  types: TaskType[]
}) {
  const columns = types.filter((t) => t.isActive || tasks.some((x) => x.typeId === t.id)).sort((a, b) => a.sortOrder - b.sortOrder)
  const techs = employees
    .filter((e) => e.role === 'technician' && (e.isActive || tasks.some((t) => t.assigneeId === e.id)))
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ar'))
  const count = (emp: string, type: number) => tasks.filter((t) => t.assigneeId === emp && t.typeId === type).length
  const blanks = Math.max(1, 8 - techs.length)
  const { weekday, date } = describeDay(day)

  return (
    <div className="print-sheet landscape tasks-print" aria-hidden="true">
      <header className="ps-head">
        <img src="/logo.webp" alt="" className="ps-logo" />
        <div className="ps-title">
          <b>متابعة مهام الكهربائية اليومية</b>
          <span>مخيم (2)</span>
        </div>
        <div className="ps-date">طُبع: <span className="num">{stamp(new Date().toISOString())}</span></div>
      </header>

      <div className="tf-meta">
        <span>اليوم: <b>{weekday}</b></span>
        <span>التاريخ: <b className="num">{date}</b></span>
      </div>

      <table className="task-form">
        <colgroup>
          <col style={{ width: '4%' }} />
          <col style={{ width: '14%' }} />
          {columns.map((c) => <col key={c.id} />)}
          <col style={{ width: '7%' }} />
        </colgroup>
        <thead>
          <tr>
            <th rowSpan={2}>م</th>
            <th rowSpan={2}>اسم الكهربائي</th>
            <th colSpan={columns.length}>المهمة المنفذة</th>
            <th rowSpan={2}>المجموع</th>
          </tr>
          <tr>
            {columns.map((c) => <th key={c.id} className="tf-type">{c.name}</th>)}
          </tr>
        </thead>
        <tbody>
          {techs.map((e, i) => {
            const total = tasks.filter((t) => t.assigneeId === e.id).length
            return (
              <tr key={e.id}>
                <td className="num">{i + 1}</td>
                <td className="tf-name">{e.fullName}</td>
                {columns.map((c) => {
                  const n = count(e.id, c.id)
                  return <td key={c.id} className="num tf-count">{n || ''}</td>
                })}
                <td className="num tf-count">{total || ''}</td>
              </tr>
            )
          })}
          {Array.from({ length: blanks }, (_, i) => (
            <tr key={`b${i}`}>
              <td className="num">{techs.length + i + 1}</td>
              <td />
              {columns.map((c) => <td key={c.id} />)}
              <td />
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2}>المجموع</td>
            {columns.map((c) => {
              const n = tasks.filter((t) => t.typeId === c.id).length
              return <td key={c.id} className="num tf-count">{n || ''}</td>
            })}
            <td className="num tf-count">{tasks.length || ''}</td>
          </tr>
        </tfoot>
      </table>

      <footer className="tf-sign">
        <div><b>توقيع المشرف</b><span>&nbsp;</span></div>
      </footer>
    </div>
  )
}
