import { useLiveQuery } from 'dexie-react-hooks'
import { SignFooter } from '../sheets/signers'
import { ChevronLeft, ChevronRight, Printer } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { db } from '../../data/db'
import { getSupabase } from '../../data/supabase'
import { addDays, describeDay, todayISO, type ISODate } from '../../lib/dates'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { useViewDay } from '../../lib/viewDay'
import { Segmented } from '../../ui/form'
import { Button } from '../../ui/primitives'
import { weekStart } from '../attendance/rules'
import { stamp } from '../sheets/ui'
import { buildSealWork, filterSealWork, sealWorkTotals, type SealWorkLine, type SealWorkRow } from './sealWork'

type Period = 'week' | 'month' | 'all' | 'range'
const periods = [
  { value: 'week', label: 'أسبوعي' },
  { value: 'month', label: 'شهري' },
  { value: 'all', label: 'إجمالي' },
  { value: 'range', label: 'تاريخ محدد' },
] as const

const monthStart = (d: ISODate) => `${d.slice(0, 8)}01`
const monthEnd = (d: ISODate) => {
  const [y, m] = d.split('-').map(Number)
  return new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10)
}
const monthName = (d: ISODate) => new Intl.DateTimeFormat('ar-EG-u-nu-latn-ca-gregory', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`))

/** What the technicians did with the seals: one line each, by day, to read on screen or print. */
export function SealWorkPage() {
  useDocumentTitle('كشف أعمال الأختام')
  const today = todayISO()
  const viewDay = useViewDay()
  const [period, setPeriod] = useState<Period>('week')
  const [anchor, setAnchor] = useState(viewDay)
  const [rangeFrom, setRangeFrom] = useState(weekStart(viewDay))
  const [rangeTo, setRangeTo] = useState(addDays(weekStart(viewDay), 6))
  const [technician, setTechnician] = useState('')
  const [subscriber, setSubscriber] = useState('')
  const [rows, setRows] = useState<SealWorkRow[] | null>(null)
  const [failed, setFailed] = useState(false)
  const names = useLiveQuery(async () => new Map((await db.employees.toArray()).map((e) => [e.id, e.fullName] as [string, string])), [])

  const from = period === 'week' ? weekStart(anchor) : period === 'month' ? monthStart(anchor) : period === 'range' ? rangeFrom || null : null
  const to = period === 'week' ? addDays(weekStart(anchor), 6) : period === 'month' ? monthEnd(anchor) : period === 'range' ? rangeTo || null : null
  const invalidRange = !!from && !!to && from > to
  const label = period === 'all' ? 'كل الفترة (إجمالي)' : period === 'range' ? `${from ? describeDay(from).date : 'من البداية'} ← ${to ? describeDay(to).date : 'حتى اليوم'}` : period === 'week' ? `الأسبوع ${describeDay(from!).date} ← ${describeDay(to!).date}` : `شهر ${monthName(from!)}`
  const isCurrent = !!to && today >= from! && today <= to

  useEffect(() => {
    let live = true
    setRows(null)
    setFailed(false)
    const sb = getSupabase()
    if (!sb || invalidRange) {
      setRows([])
      return
    }
    void sb.rpc('seal_work_statement', { p_from: from, p_to: to }).then((res) => {
      if (!live) return
      if (res.error) setFailed(true)
      else setRows((res.data ?? []) as SealWorkRow[])
    })
    return () => { live = false }
  }, [from, to, invalidRange])

  const allLines = useMemo(() => (rows && names ? buildSealWork(rows, names) : null), [rows, names])
  const technicians = useMemo(() => {
    const list = new Map((allLines ?? []).map((l) => [l.techId, l.tech]))
    if (technician) list.set(technician, names?.get(technician) ?? '—')
    return [...list].sort((a, b) => a[1].localeCompare(b[1], 'ar'))
  }, [allLines, names, technician])
  const lines = useMemo(() => allLines && filterSealWork(allLines, { from, to, technician, subscriber }), [allLines, from, to, technician, subscriber])
  const totals = useMemo(() => (lines ? sealWorkTotals(lines) : []), [lines])
  const sealCount = lines?.reduce((n, l) => n + l.seals.length, 0) ?? 0
  const move = (dir: -1 | 1) => setAnchor(period === 'week' ? addDays(from!, 7 * dir) : addDays(dir < 0 ? from! : to!, dir))

  return (
    <div className="report-page seal-work">
      <header className="ph">
        <div>
          <h1>كشف أعمال الأختام</h1>
          <p className="muted">اختار الفترة والفني، أو ابحث باسم المشترك. الكشف والطباعة حسب اللي اخترته.</p>
        </div>
        <Segmented<Period> label="الفترة" value={period} options={periods} onChange={setPeriod} />
      </header>

      <div className="week-bar card">
        {(period === 'week' || period === 'month') && <button type="button" className="icon-btn" aria-label="الفترة السابقة" onClick={() => move(-1)}><ChevronRight size={18} /></button>}
        <div className="week-label">
          <b>{period === 'range' ? 'الفترة المختارة' : period === 'all' ? 'الإجمالي' : isCurrent ? (period === 'week' ? 'هذا الأسبوع' : 'هذا الشهر') : period === 'week' ? 'الأسبوع' : 'الشهر'}</b>
          <span className="num">{label}</span>
        </div>
        {(period === 'week' || period === 'month') && <button type="button" className="icon-btn" aria-label="الفترة التالية" disabled={isCurrent} onClick={() => move(1)}><ChevronLeft size={18} /></button>}
        <div className="ph-actions">
          <Button variant="primary" icon={<Printer size={17} />} disabled={!lines || lines.length === 0} onClick={() => window.print()}>طباعة الكشف</Button>
        </div>
      </div>

      <section className="card sw-filters" aria-label="فرز كشف أعمال الأختام">
        {period === 'range' && <>
          <label className="field"><span className="label">من تاريخ</span><input className="input" type="date" value={rangeFrom} max={rangeTo || undefined} onChange={(e) => setRangeFrom(e.target.value)} /></label>
          <label className="field"><span className="label">إلى تاريخ</span><input className="input" type="date" value={rangeTo} min={rangeFrom || undefined} onChange={(e) => setRangeTo(e.target.value)} /></label>
        </>}
        <label className="field"><span className="label">الفني</span><select className="select" aria-label="الفني" value={technician} onChange={(e) => setTechnician(e.target.value)}>
          <option value="">كل الفنيين</option>
          {technicians.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select></label>
        <label className="field"><span className="label">اسم المشترك</span><input className="input" type="search" placeholder="اكتب الاسم أو جزء منه" value={subscriber} onChange={(e) => setSubscriber(e.target.value)} /></label>
      </section>

      {invalidRange ? (
        <p className="card card-empty" role="alert">تاريخ البداية لازم يكون قبل تاريخ النهاية أو بنفس اليوم.</p>
      ) : failed ? (
        <p className="card card-empty">تعذّر تحميل الكشف. تأكد من الإنترنت وحاول مرة أخرى.</p>
      ) : !lines ? (
        <div className="loading-block" aria-busy="true" />
      ) : lines.length === 0 ? (
        <p className="card card-empty">{technician || subscriber.trim() ? 'لا نتائج حسب الفرز اللي اخترته.' : 'لا أختام مستخدمة في هذه الفترة.'}</p>
      ) : (
        <div className="card table-wrap">
          <SealWorkTable lines={lines} totals={totals} period={period} />
        </div>
      )}

      {lines && lines.length > 0 && (
        <div className="print-sheet landscape seal-work-print" aria-hidden="true">
          <header className="ps-head">
            <img src="/logo.webp" alt="" className="ps-logo" />
            <div className="ps-title">
              <b>كشف أعمال الفنيين بالأختام</b>
              <span className="num">{label}</span>
            </div>
            <div className="ps-date">طُبع: <span className="num">{stamp(new Date().toISOString())}</span></div>
          </header>
          <div className="tf-meta">
            {technician && <span>الفني: <b>{names?.get(technician) ?? '—'}</b></span>}
            {subscriber.trim() && <span>بحث المشترك: <b>{subscriber.trim()}</b></span>}
            <span>عدد الأسطر: <b className="num">{lines.length}</b></span>
            <span>عدد الأختام: <b className="num">{sealCount}</b></span>
          </div>
          <SealWorkTable lines={lines} totals={totals} period={period} />
          <SignFooter />
        </div>
      )}
    </div>
  )
}

/** The same table on screen and on paper: a band for each day, a line for each job, totals at the end. */
function SealWorkTable({ lines, totals, period }: { lines: SealWorkLine[]; totals: { tech: string; seals: number; jobs: number }[]; period: Period }) {
  const days: { date: ISODate; lines: SealWorkLine[] }[] = []
  for (const l of lines) {
    const last = days[days.length - 1]
    if (last && last.date === l.date) last.lines.push(l)
    else days.push({ date: l.date, lines: [l] })
  }
  let n = 0
  let weekOf: ISODate | null = null
  return (
    <>
      <table className="sw-table">
        <colgroup>
          <col style={{ width: '4%' }} />
          <col style={{ width: '14%' }} />
          <col style={{ width: '22%' }} />
          <col style={{ width: '9%' }} />
          <col style={{ width: '21%' }} />
          <col style={{ width: '16%' }} />
          <col style={{ width: '14%' }} />
        </colgroup>
        <thead>
          <tr>
            <th>م</th>
            <th>الفني</th>
            <th>أرقام الأختام</th>
            <th>الطبلون</th>
            <th>العمل</th>
            <th>المشترك</th>
            <th>عدد الأختام</th>
          </tr>
        </thead>
        {days.map((d) => {
          const wk = weekStart(d.date)
          const newWeek = period === 'all' && wk !== weekOf
          weekOf = wk
          const { weekday, date } = describeDay(d.date)
          return (
            <tbody key={d.date}>
              {newWeek && (
                <tr className="sw-week"><th colSpan={7}>أسبوع <span className="num">{describeDay(wk).date} ← {describeDay(addDays(wk, 6)).date}</span></th></tr>
              )}
              <tr className="sw-day">
                <th colSpan={6}>{weekday} · <span className="num">{date}</span></th>
                <th className="num">{d.lines.reduce((s, l) => s + l.seals.length, 0)} ختم</th>
              </tr>
              {d.lines.map((l, i) => (
                <tr key={i}>
                  <td className="num">{++n}</td>
                  <td className="sw-tech">{l.tech}</td>
                  <td className="num sw-seals">{l.seals.join(' · ')}</td>
                  <td className="num">{l.board || '—'}</td>
                  <td>{l.work || '—'}</td>
                  <td>{l.subscriber || '—'}</td>
                  <td className="num">{l.seals.length}</td>
                </tr>
              ))}
            </tbody>
          )
        })}
      </table>
      <table className="sw-table sw-totals">
        <thead>
          <tr><th>الفني</th><th>عدد الأسطر</th><th>مجموع الأختام</th></tr>
        </thead>
        <tbody>
          {totals.map((t) => (
            <tr key={t.tech}><td className="sw-tech">{t.tech}</td><td className="num">{t.jobs}</td><td className="num">{t.seals}</td></tr>
          ))}
          <tr className="sw-grand"><td>المجموع</td><td className="num">{totals.reduce((s, t) => s + t.jobs, 0)}</td><td className="num">{totals.reduce((s, t) => s + t.seals, 0)}</td></tr>
        </tbody>
      </table>
    </>
  )
}
