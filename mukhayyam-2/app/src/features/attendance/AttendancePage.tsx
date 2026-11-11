import { CountUp } from '../../ui/fx/CountUp'
import { Skeleton } from '../../ui/fx/Skeleton'
import { ChevronLeft,ChevronRight,Clock3,MessageCircle,Printer,UserCheck,UserX,Users } from 'lucide-react'
import { SignFooter } from '../sheets/signers'
import { useEffect,useState } from 'react'
import { useSearchParams } from 'react-router'
import { addDays,describeDay,isoNoon,type ISODate } from '../../lib/dates'
import { clock12,formatWeekday } from '../../lib/format'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { sendSheetOnWhatsApp } from '../../lib/sheetPdf'
import type { Employee } from '../../types'
import { Segmented } from '../../ui/form'
import { Avatar,Button,Pill } from '../../ui/primitives'
import { useToast } from '../../ui/Toast'
import { stamp } from '../sheets/ui'
import {
refreshAttendance
} from './repo'
import {
leaveLabel,
presentStatuses,
statusLabel,weekDays,
weekdayOf,
weekTotals,
type DayResult,
type DayStatus,type Schedule
} from './rules'
import { statusTone,useAttendanceData,type Data } from './attendanceData'
import { DayDialog } from './DayDialog'
import { SheetAndPhones } from './SheetAndPhones'

type Tab = 'today' | 'week' | 'sheet'
const tabs = [
  { value: 'today', label: 'اليوم' },
  { value: 'week', label: 'الكشف الأسبوعي' },
  { value: 'sheet', label: 'ورقة الـQR والجوالات' },
] as const


export function AttendancePage() {
  useDocumentTitle('الحضور والانصراف')
  const [params, setParams] = useSearchParams()
  const tab: Tab = (['week', 'sheet'] as const).find((t) => t === params.get('tab')) ?? 'today'
  const data = useAttendanceData()
  const [open, setOpen] = useState<{ employee: Employee; date: ISODate } | null>(null)

  useEffect(() => {
    void refreshAttendance()
    const id = window.setInterval(() => document.visibilityState === 'visible' && void refreshAttendance(), 20_000)
    return () => window.clearInterval(id)
  }, [])

  return (
    <div className="report-page attendance">
      <header className="ph">
        <div>
          <h1>الحضور والانصراف</h1>
          <p className="muted">من تصوير ورقة الـQR في المكتب، بتوقيت الخادم.</p>
        </div>
        <Segmented<Tab> label="القسم" value={tab} options={tabs} onChange={(t) => setParams(t === 'today' ? {} : { tab: t }, { replace: true })} />
      </header>
      {!data.ready ? (
        <Skeleton kind="cards" />
      ) : tab === 'today' ? (
        <TodayBoard data={data} onOpen={(employee) => setOpen({ employee, date: data.today })} />
      ) : tab === 'week' ? (
        <WeekSheet data={data} onOpen={(employee, date) => setOpen({ employee, date })} />
      ) : (
        <SheetAndPhones people={data.people} />
      )}
      {open && <DayDialog employee={open.employee} date={open.date} data={data} onClose={() => setOpen(null)} />}
    </div>
  )
}


function TodayBoard({ data, onOpen }: { data: Data; onOpen(e: Employee): void }) {
  const rows = data.people.map((e) => ({ e, d: data.day(e, data.today) })).filter((r): r is { e: Employee; d: DayResult } => !!r.d)
  const count = (pred: (d: DayResult) => boolean) => rows.filter((r) => pred(r.d)).length
  const present = count((d) => presentStatuses.includes(d.status))
  const working = count((d) => d.status === 'working')
  // Someone on leave or with a permission did not come in either.
  const onLeave = count((d) => d.status === 'leave')
  const missing = count((d) => d.status === 'absent' || d.status === 'pending' || d.status === 'leave')
  const left = count((d) => !!d.outAt && d.status !== 'working')
  const order: DayStatus[] = ['absent', 'pending', 'late', 'working', 'no_out', 'present', 'leave', 'holiday', 'off', 'future']
  rows.sort((a, b) => order.indexOf(a.d.status) - order.indexOf(b.d.status) || a.e.fullName.localeCompare(b.e.fullName, 'ar'))
  const { weekday, date } = describeDay(data.today)

  return (
    <>
      <div className="kpis">
        <div className="kpi hero">
          <div className="kpi-label"><span className="kpi-ico"><UserCheck size={16} /></span>حضروا اليوم</div>
          <div className="kpi-value num"><CountUp value={present} /><small>من {rows.length}</small></div>
          <div className="kpi-sub">{weekday} · <span className="num">{date}</span></div>
        </div>
        <div className="kpi glass">
          <div className="kpi-label"><span className="kpi-ico"><Clock3 size={16} /></span>في الدوام الآن</div>
          <div className="kpi-value num"><CountUp value={working} /></div>
          <div className="kpi-sub">حضروا ولم ينصرفوا بعد</div>
        </div>
        <div className="kpi glass" data-tone={missing ? 'danger' : undefined}>
          <div className="kpi-label"><span className="kpi-ico"><UserX size={16} /></span>لم يحضروا</div>
          <div className="kpi-value num"><CountUp value={missing} /></div>
          <div className="kpi-sub">{onLeave ? `منهم ${onLeave} بإذن أو إجازة · ` : ''}يصير «غائب» بعد الساعة 10:00 ص</div>
        </div>
        <div className="kpi glass">
          <div className="kpi-label"><span className="kpi-ico"><Users size={16} /></span>انصرفوا</div>
          <div className="kpi-value num"><CountUp value={left} /></div>
          <div className="kpi-sub">سجّلوا الانصراف</div>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="empty card"><h3>لا أحد يسجّل حضوره بعد</h3><p>من الإعدادات: فعّل «يسجّل حضوره» للموظف وأعطه رمز الحضور.</p></div>
      ) : (
        <ul className="att-list">
          {rows.map(({ e, d }) => (
            <li key={e.id}>
              <button type="button" className="att-row card" onClick={() => onOpen(e)}>
                <Avatar name={e.fullName} size={38} />
                <span className="att-name">
                  <b>{e.fullName}</b>
                  <small>{[e.jobTitle, data.scheduleOf(e)?.name].filter(Boolean).join(' · ')}</small>
                </span>
                {d.inAt && <span className="att-times"><InOut inAt={d.inAt} outAt={d.outAt} /></span>}
                <span className="att-tags">
                  <Pill tone={statusTone[d.status]}>{d.status === 'leave' && d.leave ? leaveLabel[d.leave.type] : statusLabel[d.status]}</Pill>
                  {d.status === 'leave' && d.leave?.notes && <small className="wk-why">{d.leave.notes}</small>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

/** Arrival in dark green, leaving in mulberry, only a dash between them. */
function InOut({ inAt, outAt }: { inAt: string; outAt: string | null }) {
  return (
    <span className="inout num">
      <b className="t-in" title="حضور">{clock12(inAt)}</b>
      {outAt && (
        <>
          <span className="t-dash" aria-hidden="true">-</span>
          <b className="t-out" title="انصراف">{clock12(outAt)}</b>
        </>
      )}
    </span>
  )
}

function WeekSheet({ data, onOpen }: { data: Data; onOpen(e: Employee, date: ISODate): void }) {
  const [anchor, setAnchor] = useState(data.today)
  const [sharing, setSharing] = useState(false)
  const toast = useToast()
  const all = weekDays(anchor)
  // Friday is not shown at all; extra hours someone works on a Friday still count in the totals.
  const days = all.filter((d) => weekdayOf(d) !== 5)
  // Two separate sheets: the official staff, and the people on «بطالة» hours.
  const [group, setGroup] = useState<'staff' | 'idle'>('staff')
  const isIdle = (e: Employee) => (data.scheduleOf(e)?.name ?? '').includes('بطالة')
  const rows = data.people.filter((e) => (group === 'idle') === isIdle(e)).map((e) => {
    const week = all.map((d) => data.day(e, d)).filter((x): x is DayResult => !!x)
    return { e, results: week.filter((r) => weekdayOf(r.date) !== 5), totals: weekTotals(week) }
  })
  const label = `${describeDay(all[0]!).date} ← ${describeDay(all[5]!).date}`
  const sheetTitle = group === 'idle' ? 'كشف حضور وانصراف البطالة الأسبوعي · مخيم (2)' : 'كشف الحضور والانصراف الأسبوعي للموظفين · مخيم (2)'
  const thisWeek = all.includes(data.today)

  async function whatsapp() {
    const el = document.querySelector<HTMLElement>('.print-sheet')
    if (!el) return
    setSharing(true)
    try {
      const title = `${sheetTitle} · ${label}`
      const res = await sendSheetOnWhatsApp(el, `${group === 'idle' ? 'كشف البطالة' : 'كشف الحضور'} ${all[0]} - ${all[5]}.pdf`, title)
      if (res === 'saved') toast('نزّل ملف PDF وانفتح واتساب، أرفق الملف بالمحادثة.')
    } catch {
      toast('تعذّر تجهيز ملف PDF. حاول مرة أخرى.', 'danger')
    } finally {
      setSharing(false)
    }
  }

  return (
    <>
      <div className="week-bar card">
        <button type="button" className="icon-btn" aria-label="الأسبوع السابق" onClick={() => setAnchor(addDays(all[0]!, -7))}><ChevronRight size={18} /></button>
        <div className="week-label">
          <b>{thisWeek ? 'هذا الأسبوع' : 'الأسبوع'}</b>
          <span className="num">{label}</span>
        </div>
        <button type="button" className="icon-btn" aria-label="الأسبوع التالي" disabled={thisWeek} onClick={() => setAnchor(addDays(all[0]!, 7))}><ChevronLeft size={18} /></button>
        <Segmented<'staff' | 'idle'> label="الكشف" value={group} options={[{ value: 'staff', label: 'الموظفون' }, { value: 'idle', label: 'البطالة' }]} onChange={setGroup} />
        <Button variant="secondary" icon={<Printer size={17} />} onClick={() => window.print()} className="week-print">{group === 'idle' ? 'طباعة كشف البطالة' : 'طباعة كشف الموظفين'}</Button>
        <Button variant="secondary" busy={sharing} icon={<MessageCircle size={17} />} onClick={() => void whatsapp()}>إرسال واتساب (PDF)</Button>
      </div>

      <div className="card week-card">
        <div className="week-scroll">
          <table className="week">
            <thead>
              <tr>
                <th className="week-person">الموظف</th>
                {days.map((d) => (
                  <th key={d} data-today={d === data.today || undefined}>
                    {formatWeekday(isoNoon(d))}
                    <small className="num">{describeDay(d).date.replace(/ \d{4}$/, '')}</small>
                  </th>
                ))}
                <th>حضور</th>
                <th>غياب</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ e, results, totals }) => (
                <tr key={e.id}>
                  <th className="week-person">
                    <b>{e.fullName}</b>
                    <small>{[e.jobTitle, data.scheduleOf(e)?.name].filter(Boolean).join(' · ')}</small>
                  </th>
                  {results.map((d) => (
                    <td key={d.date} data-status={d.status}>
                      <button type="button" className="week-cell" onClick={() => onOpen(e, d.date)} disabled={d.status === 'future'}>
                        {d.inAt ? (
                          <>
                            <InOut inAt={d.inAt} outAt={d.outAt} />
                            {!d.outAt && <small className="wk-open">{d.status === 'working' ? 'في الدوام' : 'لم ينصرف'}</small>}
                            {d.punches.some((p) => p.method === 'manual') && <i className="tag">يدوي</i>}
                          </>
                        ) : (
                          <span className={`week-mark ${d.status}`}>{d.status === 'leave' && d.leave ? leaveLabel[d.leave.type] : statusLabel[d.status]}{d.status === 'leave' && d.leave?.notes && <small className="wk-why">{d.leave.notes}</small>}</span>
                        )}
                      </button>
                    </td>
                  ))}
                  <td className="num total">{totals.present}</td>
                  <td className="num total" data-bad={totals.absent > 0 || undefined}>{totals.absent}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <WeekPrint days={days} rows={rows} label={label} title={sheetTitle} scheduleOf={data.scheduleOf} />
    </>
  )
}

/** The weekly sheet on paper (landscape), shown only when printing. */
function WeekPrint({ days, rows, label, title, scheduleOf }: {
  title: string
  days: ISODate[]
  rows: Array<{ e: Employee; results: DayResult[]; totals: ReturnType<typeof weekTotals> }>
  label: string
  scheduleOf(e: Employee): Schedule | undefined
}) {
  return (
    <div className="print-sheet landscape" aria-hidden="true">
      <header className="ps-head">
        <img src="/logo.webp" alt="" className="ps-logo" />
        <div className="ps-title">
          <b>{title}</b>
          <span className="num">{label}</span>
        </div>
        <div className="ps-date">طُبع: <span className="num">{stamp(new Date().toISOString())}</span></div>
      </header>
      <table className="att-print">
        <colgroup>
          <col style={{ width: '3%' }} />
          <col style={{ width: '18%' }} />
          {days.map((d) => <col key={d} style={{ width: `${69 / days.length}%` }} />)}
          <col style={{ width: '5%' }} />
          <col style={{ width: '5%' }} />
        </colgroup>
        <thead>
          <tr>
            <th>م</th>
            <th>الموظف</th>
            {days.map((d) => <th key={d}>{formatWeekday(isoNoon(d))}<br /><span className="num">{describeDay(d).date.replace(/ \d{4}$/, '')}</span></th>)}
            <th>حضور</th>
            <th>غياب</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ e, results, totals }, n) => (
            <tr key={e.id}>
              <td className="num">{n + 1}</td>
              <td className="ap-name">{e.fullName}<br /><small>{[e.jobTitle, scheduleOf(e)?.name].filter(Boolean).join(' · ')}</small></td>
              {results.map((d) => (
                <td key={d.date} className="num">
                  {d.inAt ? <InOut inAt={d.inAt} outAt={d.outAt} /> : d.status === 'future' ? '' : d.status === 'leave' && d.leave ? <>{leaveLabel[d.leave.type]}{d.leave.notes && <small className="ap-why">{d.leave.notes}</small>}</> : statusLabel[d.status]}
                </td>
              ))}
              <td className="num">{totals.present}</td>
              <td className="num">{totals.absent}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <SignFooter />
    </div>
  )
}

