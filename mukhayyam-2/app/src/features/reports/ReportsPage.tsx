import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft, ChevronRight, FileSpreadsheet, Printer } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { db } from '../../data/db'
import { addDays, describeDay, todayISO, type ISODate } from '../../lib/dates'
import { formatAmount } from '../../lib/numbers'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { useNow } from '../../lib/useNow'
import { Segmented } from '../../ui/form'
import { Button } from '../../ui/primitives'
import { useToast } from '../../ui/Toast'
import { refreshAttendance } from '../attendance/repo'
import { gazaTime, toMinutes, weekStart } from '../attendance/rules'
import { stamp } from '../sheets/ui'
import { refreshStock } from '../stock/repo'
import { refreshTasks } from '../tasks/repo'
import { buildReport, type Cell, type Section } from './build'
import { downloadExcel } from './excel'

type Period = 'week' | 'month'
const periods = [
  { value: 'week', label: 'أسبوعي' },
  { value: 'month', label: 'شهري' },
] as const

const monthStart = (d: ISODate) => `${d.slice(0, 8)}01`
const monthEnd = (d: ISODate) => {
  const [y, m] = d.split('-').map(Number)
  return new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10)
}
const monthName = (d: ISODate) => new Intl.DateTimeFormat('ar-EG-u-nu-latn-ca-gregory', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`))

/** Weekly or monthly summary of everything, on screen, in Excel and on paper. */
export function ReportsPage() {
  useDocumentTitle('التقارير')
  const toast = useToast()
  const today = todayISO()
  const now = useNow(60_000)
  const [period, setPeriod] = useState<Period>('week')
  const [anchor, setAnchor] = useState(today)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void refreshTasks()
    void refreshAttendance()
    void refreshStock()
  }, [])

  const from = period === 'week' ? weekStart(anchor) : monthStart(anchor)
  const to = period === 'week' ? addDays(weekStart(anchor), 6) : monthEnd(anchor)
  const label = period === 'week' ? `الأسبوع ${describeDay(from).date} ← ${describeDay(to).date}` : `شهر ${monthName(from)}`
  const isCurrent = today >= from && today <= to

  const data = useLiveQuery(async () => {
    const [reports, sheets, tasks, punches, leaves, holidays, employees, schedules, generators, fuelTypes, zones, taskTypes, items, moves] = await Promise.all([
      db.siteReports.toArray(), db.distributionSheets.toArray(), db.tasks.toArray(), db.punches.toArray(), db.leaves.toArray(), db.holidays.toArray(),
      db.employees.toArray(), db.schedules.toArray(), db.generators.toArray(), db.fuelTypes.toArray(), db.zones.toArray(), db.taskTypes.toArray(),
      db.stockItems.toArray(), db.stockMoves.toArray(),
    ])
    return { reports, sheets, tasks, punches, leaves, holidays, employees, schedules, generators, fuelTypes, zones, taskTypes, items, moves }
  }, [])

  const sections = useMemo(
    () => (data ? buildReport({ ...data, from, to, today, nowMin: toMinutes(gazaTime(now.toISOString())) }) : null),
    [data, from, to, today, now],
  )

  async function excel() {
    if (!sections) return
    setBusy(true)
    try {
      await downloadExcel(sections, `نظام مخيم 2 · ${label}`, `mukhayyam2-report-${from}-${to}.xlsx`)
      toast('نُزّل ملف Excel')
    } catch {
      toast('تعذّر تجهيز الملف', 'danger')
    } finally {
      setBusy(false)
    }
  }

  const move = (dir: -1 | 1) => setAnchor(period === 'week' ? addDays(from, 7 * dir) : addDays(dir < 0 ? from : to, dir))

  return (
    <div className="report-page reports">
      <header className="ph">
        <div>
          <h1>التقارير</h1>
          <p className="muted">ملخص المحروقات والمولدات والتوزيع والمهام والحضور والمخزن لأي أسبوع أو شهر.</p>
        </div>
        <Segmented<Period> label="الفترة" value={period} options={periods} onChange={(p) => { setPeriod(p); setAnchor(today) }} />
      </header>

      <div className="week-bar card">
        <button type="button" className="icon-btn" aria-label="الفترة السابقة" onClick={() => move(-1)}><ChevronRight size={18} /></button>
        <div className="week-label">
          <b>{isCurrent ? (period === 'week' ? 'هذا الأسبوع' : 'هذا الشهر') : period === 'week' ? 'الأسبوع' : 'الشهر'}</b>
          <span className="num">{label}</span>
        </div>
        <button type="button" className="icon-btn" aria-label="الفترة التالية" disabled={isCurrent} onClick={() => move(1)}><ChevronLeft size={18} /></button>
        <div className="ph-actions">
          <Button variant="secondary" icon={<Printer size={17} />} onClick={() => window.print()}>طباعة / PDF</Button>
          <Button variant="primary" icon={<FileSpreadsheet size={17} />} busy={busy} disabled={!sections} onClick={() => void excel()}>Excel</Button>
        </div>
      </div>

      {!sections ? (
        <div className="loading-block" aria-busy="true" />
      ) : (
        sections.map((s) => <SectionCard key={s.key} section={s} />)
      )}

      {sections && (
        <div className="print-sheet landscape report-print" aria-hidden="true">
          <header className="ps-head">
            <img src="/logo.webp" alt="" className="ps-logo" />
            <div className="ps-title">
              <b>تقرير مخيم (2) · {period === 'week' ? 'أسبوعي' : 'شهري'}</b>
              <span className="num">{label}</span>
            </div>
            <div className="ps-date">طُبع: <span className="num">{stamp(new Date().toISOString())}</span></div>
          </header>
          {sections.map((s) => (
            <div key={s.key} className="rp-block">
              <h2>{s.title}</h2>
              <ReportTable section={s} />
            </div>
          ))}
          <footer className="ps-foot">
            <div><b>إعداد</b><span>نظام مخيم 2</span></div>
            <div><b>اعتماد المدير</b><span>&nbsp;</span></div>
          </footer>
        </div>
      )}
    </div>
  )
}

const show = (c: Cell) => (c === null || c === '' ? '—' : typeof c === 'number' ? formatAmount(c) : /^\d{4}-\d{2}-\d{2}$/.test(c) ? describeDay(c).date.replace(/ \d{4}$/, '') : c)

export function ReportTable({ section }: { section: Section }) {
  return (
    <table className="tbl">
      <thead>
        <tr>{section.columns.map((c, i) => <th key={i} className={i === 0 ? 'l' : undefined}>{c}</th>)}</tr>
      </thead>
      <tbody>
        {section.rows.map((r, i) => (
          <tr key={i}>{r.map((c, j) => <td key={j} className={j === 0 ? 'l' : 'num'}>{show(c)}</td>)}</tr>
        ))}
      </tbody>
      {section.total && (
        <tfoot>
          <tr>{section.total.map((c, j) => <td key={j} className={j === 0 ? 'l' : 'num'}>{show(c)}</td>)}</tr>
        </tfoot>
      )}
    </table>
  )
}

function SectionCard({ section }: { section: Section }) {
  return (
    <section className="card">
      <div className="card-h">
        <h2>{section.title}</h2>
        {section.note && <span className="meta">{section.note}</span>}
      </div>
      {section.rows.length === 0 ? (
        <p className="card-empty">لا بيانات في هذه الفترة.</p>
      ) : (
        <div className="table-wrap"><ReportTable section={section} /></div>
      )}
    </section>
  )
}
