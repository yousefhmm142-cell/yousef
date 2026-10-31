import { ChevronLeft, ChevronRight, Clock3, Printer, QrCode, RefreshCw, Smartphone, Trash2, UserCheck, UserX, Users } from 'lucide-react'
import qrcode from 'qrcode-generator'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useEmployee } from '../../auth/AuthProvider'
import { useTeam } from '../../data/team'
import { addDays, describeDay, isoNoon, todayISO, type ISODate } from '../../lib/dates'
import { formatWeekday } from '../../lib/format'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { useNow } from '../../lib/useNow'
import type { Employee } from '../../types'
import { Dialog } from '../../ui/Dialog'
import { Segmented, TimeField } from '../../ui/form'
import { Avatar, Button, Logo, Pill, type Tone } from '../../ui/primitives'
import { useToast } from '../../ui/Toast'
import { useConfirmTap } from '../sheets/useDraft'
import { stamp } from '../sheets/ui'
import { SheetStateError } from '../sheets/workflow'
import { durationText } from '../tasks/model'
import {
  addLeave,
  addManualPunch,
  deleteLeave,
  deletePunch,
  updatePunchTime,
  refreshAttendance,
  renewPoint,
  revokeDevice,
  useDevices,
  useHolidays,
  useLeaves,
  usePoints,
  usePunches,
  useSchedules,
} from './repo'
import {
  dayResult,
  gazaDate,
  gazaTime,
  leaveLabel,
  presentStatuses,
  statusLabel,
  toMinutes,
  weekDays,
  weekdayOf,
  weekTotals,
  type DayResult,
  type DayStatus,
  type LeaveType,
  type PunchKind,
  type Schedule,
} from './rules'

type Tab = 'today' | 'week' | 'sheet'
const tabs = [
  { value: 'today', label: 'اليوم' },
  { value: 'week', label: 'الكشف الأسبوعي' },
  { value: 'sheet', label: 'ورقة الـQR والجوالات' },
] as const

const statusTone: Record<DayStatus, Tone> = {
  present: 'ok',
  late: 'ok',
  working: 'ok',
  no_out: 'warn',
  pending: 'neutral',
  absent: 'danger',
  off: 'neutral',
  holiday: 'neutral',
  leave: 'info',
  future: 'neutral',
}

const errText = (e: unknown) =>
  ({ offline: 'يحتاج إنترنت. اتصل وحاول مرة أخرى.', reason_needed: 'اكتب السبب.' } as Record<string, string>)[e instanceof SheetStateError ? e.message : ''] ??
  'تعذّر الحفظ. حاول مرة أخرى.'

/** Everything needed to work out any person's day. */
function useAttendanceData() {
  const team = useTeam()
  const schedules = useSchedules()
  const punches = usePunches()
  const leaves = useLeaves()
  const holidays = useHolidays()
  const now = useNow(60_000)
  const today = todayISO()
  const nowMin = toMinutes(gazaTime(now.toISOString()))
  const people = useMemo(() => (team ?? []).filter((e) => e.tracksAttendance), [team])
  const byDay = useMemo(() => {
    const m = new Map<string, typeof punches>()
    for (const p of punches ?? []) {
      const k = `${p.employeeId}|${gazaDate(p.at)}`
      m.set(k, [...(m.get(k) ?? []), p])
    }
    return m
  }, [punches])
  const ready = !!team && !!schedules && !!punches && !!leaves && !!holidays
  // Absences count from the first scan the system ever saw, not from before it was in use.
  const trackingFrom = useMemo(() => (punches ?? []).reduce<ISODate>((min, p) => (gazaDate(p.at) < min ? gazaDate(p.at) : min), today), [punches, today])
  const scheduleOf = (e: Employee): Schedule | undefined => schedules?.find((s) => s.id === e.scheduleId) ?? schedules?.[0]
  const day = (e: Employee, date: ISODate): DayResult | null => {
    const s = scheduleOf(e)
    if (!s) return null
    return dayResult({
      date,
      today,
      nowMin,
      punches: byDay.get(`${e.id}|${date}`) ?? [],
      schedule: s,
      holiday: holidays?.find((h) => h.date === date)?.name,
      leave: leaves?.find((l) => l.employeeId === e.id && l.from <= date && l.to >= date),
      trackingFrom,
    })
  }
  return { ready, people, day, scheduleOf, today, byDay }
}

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
        <div className="loading-block" aria-busy="true" />
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

type Data = ReturnType<typeof useAttendanceData>

function TodayBoard({ data, onOpen }: { data: Data; onOpen(e: Employee): void }) {
  const rows = data.people.map((e) => ({ e, d: data.day(e, data.today) })).filter((r): r is { e: Employee; d: DayResult } => !!r.d)
  const count = (pred: (d: DayResult) => boolean) => rows.filter((r) => pred(r.d)).length
  const present = count((d) => presentStatuses.includes(d.status))
  const working = count((d) => d.status === 'working')
  const missing = count((d) => d.status === 'absent' || d.status === 'pending')
  const left = count((d) => !!d.outAt && d.status !== 'working')
  const order: DayStatus[] = ['absent', 'pending', 'late', 'working', 'no_out', 'present', 'leave', 'holiday', 'off', 'future']
  rows.sort((a, b) => order.indexOf(a.d.status) - order.indexOf(b.d.status) || a.e.fullName.localeCompare(b.e.fullName, 'ar'))
  const { weekday, date } = describeDay(data.today)

  return (
    <>
      <div className="kpis">
        <div className="kpi hero">
          <div className="kpi-label"><span className="kpi-ico"><UserCheck size={16} /></span>حضروا اليوم</div>
          <div className="kpi-value num">{present}<small>من {rows.length}</small></div>
          <div className="kpi-sub">{weekday} · <span className="num">{date}</span></div>
        </div>
        <div className="kpi glass">
          <div className="kpi-label"><span className="kpi-ico"><Clock3 size={16} /></span>في الدوام الآن</div>
          <div className="kpi-value num">{working}</div>
          <div className="kpi-sub">حضروا ولم ينصرفوا بعد</div>
        </div>
        <div className="kpi glass" data-tone={missing ? 'danger' : undefined}>
          <div className="kpi-label"><span className="kpi-ico"><UserX size={16} /></span>لم يحضروا</div>
          <div className="kpi-value num">{missing}</div>
          <div className="kpi-sub">يصير «غائب» بعد الساعة 10:00</div>
        </div>
        <div className="kpi glass">
          <div className="kpi-label"><span className="kpi-ico"><Users size={16} /></span>انصرفوا</div>
          <div className="kpi-value num">{left}</div>
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
                  <Pill tone={statusTone[d.status]}>{statusLabel[d.status]}</Pill>
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
      <b className="t-in" title="حضور">{inAt}</b>
      {outAt && (
        <>
          <span className="t-dash" aria-hidden="true">-</span>
          <b className="t-out" title="انصراف">{outAt}</b>
        </>
      )}
    </span>
  )
}

function WeekSheet({ data, onOpen }: { data: Data; onOpen(e: Employee, date: ISODate): void }) {
  const [anchor, setAnchor] = useState(data.today)
  const all = weekDays(anchor)
  // Friday is not shown at all; extra hours someone works on a Friday still count in the totals.
  const days = all.filter((d) => weekdayOf(d) !== 5)
  const rows = data.people.map((e) => {
    const week = all.map((d) => data.day(e, d)).filter((x): x is DayResult => !!x)
    return { e, results: week.filter((r) => weekdayOf(r.date) !== 5), totals: weekTotals(week) }
  })
  const label = `${describeDay(all[0]!).date} ← ${describeDay(all[5]!).date}`
  const thisWeek = all.includes(data.today)

  return (
    <>
      <div className="week-bar card">
        <button type="button" className="icon-btn" aria-label="الأسبوع السابق" onClick={() => setAnchor(addDays(all[0]!, -7))}><ChevronRight size={18} /></button>
        <div className="week-label">
          <b>{thisWeek ? 'هذا الأسبوع' : 'الأسبوع'}</b>
          <span className="num">{label}</span>
        </div>
        <button type="button" className="icon-btn" aria-label="الأسبوع التالي" disabled={thisWeek} onClick={() => setAnchor(addDays(all[0]!, 7))}><ChevronLeft size={18} /></button>
        <Button variant="secondary" icon={<Printer size={17} />} onClick={() => window.print()} className="week-print">طباعة الكشف</Button>
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
                <th>إضافي</th>
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
                            {d.overtimeMin > 0 && <i className="tag ok num">+{durationText(d.overtimeMin)}</i>}
                            {d.punches.some((p) => p.method === 'manual') && <i className="tag">يدوي</i>}
                          </>
                        ) : (
                          <span className={`week-mark ${d.status}`}>{d.status === 'leave' && d.leave ? leaveLabel[d.leave.type] : statusLabel[d.status]}</span>
                        )}
                      </button>
                    </td>
                  ))}
                  <td className="num total">{totals.present}</td>
                  <td className="num total" data-bad={totals.absent > 0 || undefined}>{totals.absent}</td>
                  <td className="num total">{totals.overtimeMin ? durationText(totals.overtimeMin) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <WeekPrint days={days} rows={rows} label={label} scheduleOf={data.scheduleOf} />
    </>
  )
}

/** The weekly sheet on paper (landscape), shown only when printing. */
function WeekPrint({ days, rows, label, scheduleOf }: {
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
          <b>كشف الحضور والانصراف الأسبوعي · مخيم (2)</b>
          <span className="num">{label}</span>
        </div>
        <div className="ps-date">طُبع: <span className="num">{stamp(new Date().toISOString())}</span></div>
      </header>
      <table>
        <thead>
          <tr>
            <th style={{ width: '15%' }}>الموظف</th>
            {days.map((d) => <th key={d}>{formatWeekday(isoNoon(d))}<br /><span className="num">{describeDay(d).date.replace(/ \d{4}$/, '')}</span></th>)}
            <th>حضور</th>
            <th>غياب</th>
            <th>إضافي</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ e, results, totals }) => (
            <tr key={e.id}>
              <td>{e.fullName}<br /><small>{[e.jobTitle, scheduleOf(e)?.name].filter(Boolean).join(' · ')}</small></td>
              {results.map((d) => (
                <td key={d.date} className="num">
                  {d.inAt ? <InOut inAt={d.inAt} outAt={d.outAt} /> : d.status === 'future' ? '' : d.status === 'leave' && d.leave ? leaveLabel[d.leave.type] : statusLabel[d.status]}
                  {d.overtimeMin > 0 && <><br />+{durationText(d.overtimeMin)}</>}
                </td>
              ))}
              <td className="num">{totals.present}</td>
              <td className="num">{totals.absent}</td>
              <td className="num">{totals.overtimeMin ? durationText(totals.overtimeMin) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <footer className="ps-foot">
        <div><b>إعداد</b><span>نظام مخيم 2</span></div>
        <div><b>اعتماد المدير</b><span>&nbsp;</span></div>
      </footer>
    </div>
  )
}

/** One person's day: the scans, and the manager's corrections (forgotten scan, leave). */
function DayDialog({ employee, date, data, onClose }: { employee: Employee; date: ISODate; data: Data; onClose(): void }) {
  const me = useEmployee()
  const toast = useToast()
  const d = data.day(employee, date)
  const [kind, setKind] = useState<PunchKind>(d?.inAt && !d.outAt ? 'out' : 'in')
  const [time, setTime] = useState(d?.inAt && !d.outAt ? '17:00' : '08:00')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [armed, arm, disarm] = useConfirmTap()
  const { weekday, date: long } = describeDay(date)

  async function run(key: string, f: () => Promise<void>, done: string) {
    setBusy(key)
    try {
      await f()
      toast(done)
    } catch (e) {
      toast(errText(e), 'danger')
    } finally {
      setBusy(null)
      disarm()
    }
  }

  if (!d) return null
  return (
    <Dialog open onClose={onClose} title={`${employee.fullName} · ${weekday}`}>
      <div className="att-day">
        <div className="task-detail-head">
          <span className="muted num">{long}</span>
          <Pill tone={statusTone[d.status]}>{statusLabel[d.status] || 'لم يأتِ بعد'}</Pill>
          {d.earlyMin > 0 && <Pill tone="warn">خرج قبل الموعد بـ {durationText(d.earlyMin)}</Pill>}
          {d.overtimeMin > 0 && <Pill tone="ok">إضافي {durationText(d.overtimeMin)}</Pill>}
        </div>
        {d.punches.length ? (
          <ol className="task-steps att-punches">
            {d.punches.map((p) => (
              <li key={p.id}>
                <span>{p.kind === 'in' ? 'حضور' : 'انصراف'}{p.method === 'manual' && <small className="muted"> · يدوي: {p.reason}</small>}</span>
                <span className="att-punch-end">
                  <span className={`punch-time ${p.kind}`}>
                    <TimeField
                      label={`تعديل وقت ${p.kind === 'in' ? 'الحضور' : 'الانصراف'}`}
                      value={gazaTime(p.at)}
                      onChange={(v) => v && void run('edit', () => updatePunchTime(p, date, v, me.id), 'عُدّل الوقت')}
                    />
                  </span>
                  <button type="button" className="icon-btn sm" aria-label="حذف هذا التسجيل" disabled={!!busy}
                    onClick={() => (armed ? void run('del', () => deletePunch(p.id), 'حُذف التسجيل') : arm())}>
                    <Trash2 size={15} />
                  </button>
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted">لا تسجيلات في هذا اليوم.</p>
        )}
        {armed && <p className="field-hint">اضغط سلة الحذف مرة ثانية للتأكيد.</p>}

        <div className="att-manual">
          <b>سجّل حضور أو انصراف</b>
          <span className="field-hint">لمن نسي يصوّر، أو لتسجيل وقت عنه. لتعديل وقت مسجّل اضغط على الوقت فوق.</span>
          <div className="att-manual-row">
            <Segmented<PunchKind> label="النوع" value={kind} options={[{ value: 'in', label: 'حضور' }, { value: 'out', label: 'انصراف' }]} onChange={setKind} />
            <span className="punch-time"><TimeField label="وقت التسجيل" value={time} onChange={setTime} /></span>
          </div>
          <input className="input" placeholder="السبب (مطلوب)، مثلاً: الجوال كان طافي" aria-label="السبب" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button variant="secondary" busy={busy === 'manual'} disabled={!reason.trim() || !time}
            onClick={() => void run('manual', () => addManualPunch(employee.id, date, time, kind, reason, me.id), 'سُجّل يدوياً')}>
            تسجيل {kind === 'in' ? 'الحضور' : 'الانصراف'}
          </Button>
        </div>

        <div className="att-manual">
          <b>إجازة هذا اليوم</b>
          {d.leave ? (
            <div className="att-manual-row">
              <Pill tone="info">{leaveLabel[d.leave.type]}</Pill>
              <Button variant="ghost" busy={busy === 'unleave'} onClick={() => void run('unleave', () => deleteLeave(d.leave!.id), 'أُلغيت الإجازة')}>إلغاء الإجازة</Button>
            </div>
          ) : (
            <div className="chips">
              {(Object.keys(leaveLabel) as LeaveType[]).map((t) => (
                <button key={t} type="button" className="chip" disabled={!!busy} onClick={() => void run('leave', () => addLeave(employee.id, date, t, me.id), `سُجّلت ${leaveLabel[t]}`)}>
                  {leaveLabel[t]}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  )
}

/** The printed sheet (its QR) and the phones allowed to record attendance. */
function SheetAndPhones({ people }: { people: Employee[] }) {
  const toast = useToast()
  const points = usePoints()
  const devices = useDevices()
  const point = points?.find((p) => p.isActive)
  const url = point ? `${window.location.origin}/a/${point.code}` : ''
  const svg = useMemo(() => {
    if (!url) return ''
    const qr = qrcode(0, 'M')
    qr.addData(url)
    qr.make()
    return qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true })
  }, [url])
  const [armed, arm, disarm] = useConfirmTap()
  const [busy, setBusy] = useState(false)
  const name = (id: string) => people.find((e) => e.id === id)?.fullName ?? '—'
  const active = (devices ?? []).filter((d) => !d.revokedAt).sort((a, b) => name(a.employeeId).localeCompare(name(b.employeeId), 'ar'))

  async function renew() {
    if (!point) return
    if (!armed) return arm()
    setBusy(true)
    try {
      await renewPoint(point)
      toast('صارت للورقة رمز جديد. اطبعها وعلّقها بدل القديمة.')
    } catch (e) {
      toast(errText(e), 'danger')
    } finally {
      setBusy(false)
      disarm()
    }
  }

  return (
    <>
      <div className="att-sheet-grid">
        <section className="card att-qr">
          <div className="card-h"><span className="ico-round brand"><QrCode size={16} /></span><h2>ورقة الحضور</h2></div>
          {point ? (
            <>
              <div className="att-qr-img" dangerouslySetInnerHTML={{ __html: svg }} />
              <p className="muted">اطبعها وعلّقها عند باب المكتب. الموظف يصوّرها بكاميرا جواله: أول مرة يختار اسمه ويكتب رمزه، وبعدها كل تصويرة تسجّل لحالها.</p>
              <div className="task-actions">
                <Button variant="primary" icon={<Printer size={17} />} onClick={() => window.print()}>طباعة الورقة</Button>
                <Button variant="ghost" icon={<RefreshCw size={16} />} busy={busy} onClick={() => void renew()}>
                  {armed ? 'اضغط مرة ثانية: الورقة القديمة تتوقف' : 'ورقة جديدة بدل القديمة'}
                </Button>
              </div>
            </>
          ) : (
            <p className="card-empty">لا توجد نقطة حضور.</p>
          )}
        </section>
        <section className="card">
          <div className="card-h"><span className="ico-round brand"><Smartphone size={16} /></span><h2>الجوالات المسجّلة</h2></div>
          {active.length === 0 ? (
            <p className="card-empty">لم يسجّل أحد جواله بعد. يحصل هذا تلقائياً أول ما يصوّر الموظف الورقة.</p>
          ) : (
            <ul className="gen-list">
              {active.map((d) => (
                <li key={d.id}>
                  <Avatar name={name(d.employeeId)} size={34} />
                  <span className="gen-main">
                    <b>{name(d.employeeId)}</b>
                    <small>{d.label || 'جوال'} · آخر تسجيل: {d.lastUsedAt ? stamp(d.lastUsedAt) : 'لم يسجّل بعد'}</small>
                  </span>
                  <Button variant="ghost" onClick={() => void revokeDevice(d.id).then(() => toast('أُوقف الجوال'), (e) => toast(errText(e), 'danger'))}>إيقاف</Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {point && (
        <div className="print-sheet qr-print" aria-hidden="true">
          <Logo height={70} />
          <h1>الحضور والانصراف</h1>
          <p className="qr-print-sub">مكتب مخيم 2 · أبناء فارس أبو زايد</p>
          <div className="qr-print-img" dangerouslySetInnerHTML={{ __html: svg }} />
          <ol>
            <li>افتح كاميرا الجوال ووجّهها على الكود، واضغط الرابط الذي يظهر.</li>
            <li>أول مرة فقط: اختر اسمك واكتب رمز الحضور من المدير.</li>
            <li>بعدها: صوّر عند الوصول وعند المغادرة. الوقت من الخادم.</li>
          </ol>
        </div>
      )}
    </>
  )
}
