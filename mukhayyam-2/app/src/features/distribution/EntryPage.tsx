import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, ArrowRight, Check, CircleAlert, Pencil, Moon, Plus, Send, X } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { useEmployee } from '../../auth/AuthProvider'
import { serverNow } from '../../lib/clock'
import { dayName, describeDay, isISODate, todayISO, type ISODate } from '../../lib/dates'
import { formatAmount } from '../../lib/numbers'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { useOnline } from '../../lib/useOnline'
import { advanceOnEnter, CalcField, Chip, Segmented, TimeField } from '../../ui/form'
import { Button } from '../../ui/primitives'
import { useToast } from '../../ui/Toast'
import { MissingList } from '../generation/EntrySteps'
import { OfflineSendNote } from '../generation/EntryPage'
import { BandGrid } from '../sheets/BandGrid'
import { bandAverage, bandsDayAverage, LOAD_UNIT_OPTIONS } from '../sheets/loads'
import { BackButton, DayJump, DoPreviousFirst, SaveBadge, SentHeader, UnsentBanner } from '../sheets/ui'
import { useDraft } from '../sheets/useDraft'
import { useConfirm } from '../../ui/Confirm'
import { isEditableStatus, statusInfo } from '../sheets/workflow'
import { isManagerRole } from '../../types'
import {
  applyAutoHours,
  crossesMidnight,
  emptyZoneRun,
  MAX_ZONE_RUNS,
  missingInZone,
  newSheet,
  reconcileSheet,
  RUN_NAMES,
  sheetTotals,
  type DistributionSheet,
  type Zone,
  type ZoneEntry,
} from './model'
import { lastSheetBefore, saveSheetDraft, submitSheet, useMissingSheetBefore, useSheet, useUnsentSheetsBefore, useZones } from './repo'
import { SheetView, useSheetContext } from './SheetView'

type Update = (change: (draft: DistributionSheet) => void) => void

/** The site's distribution sheet for one day: today at /sheet, or /sheet/:date. */
export function DistributionEntryPage() {
  const params = useParams()
  const today = todayISO()
  const date: ISODate = isISODate(params.date) ? params.date : today
  const employee = useEmployee()
  const stored = useSheet(date)
  const zones = useZones()
  const previous = useLiveQuery(() => lastSheetBefore(date), [date])
  const missingBefore = useMissingSheetBefore(date)
  useDocumentTitle(date === today ? 'كشف اليوم' : `كشف ${dayName(date, today)}`)

  if (date > today) {
    return <div className="empty"><h3>لا يمكن تعبئة يوم لم يأتِ بعد</h3><Link to="/sheet" className="btn">كشف اليوم</Link></div>
  }
  if (stored === undefined || !zones || previous === undefined || missingBefore === undefined) return <div className="loading-block" aria-busy="true" />
  // A sent sheet is closed for the site, but the manager can still correct it.
  if (stored && !isEditableStatus(stored.status) && !isManagerRole(employee.role)) return <SentSheet sheet={stored} />
  if (!isManagerRole(employee.role) && missingBefore && (!stored || stored.status === 'draft')) {
    return <DoPreviousFirst missing={missingBefore} noun="الكشف" hrefFor={(d) => `/sheet/${d}`} />
  }
  if (!zones.some((z) => z.isActive)) {
    return (
      <div className="empty">
        <h3>لم تُعرَّف المناطق بعد</h3>
        <p>يضيفها مسؤول النظام من الإعدادات مرة واحدة، ثم تظهر هنا كل يوم.</p>
      </div>
    )
  }
  return <SheetForm key={date} date={date} initial={stored} zones={zones} previous={previous} />
}

function SheetForm({ date, initial, zones, previous }: {
  date: ISODate
  initial: DistributionSheet | null
  zones: Zone[]
  previous: DistributionSheet | null
}) {
  const employee = useEmployee()
  const online = useOnline()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const editingSent = !!initial && !isEditableStatus(initial.status)
  const navigate = useNavigate()
  const { doc: sheet, update: rawUpdate, flush, saveState, latest } = useDraft<DistributionSheet>(
    () =>
      initial
        ? initial.status === 'draft' ? reconcileSheet(initial, zones) : initial
        : newSheet(date, zones, employee.id, previous, serverNow().toISOString()),
    (doc) => saveSheetDraft(doc, editingSent),
    !!initial,
  )
  // The hours of each zone are worked out from its run times after every change.
  const update = (change: (draft: DistributionSheet) => void) => rawUpdate((s) => { change(s); applyAutoHours(s) })
  const confirm = useConfirm()
  const [sending, setSending] = useState(false)
  const unsent = useUnsentSheetsBefore(date)

  const zoneName = (id: number) => zones.find((z) => z.id === id)?.name ?? 'منطقة'
  const steps = [...sheet.zones.map((z) => ({ key: `z${z.zoneId}`, label: zoneName(z.zoneId) })), { key: 'send', label: 'الإرسال' }]
  const stepIndex = Math.max(0, steps.findIndex((s) => s.key === params.get('step')))
  const sendIndex = steps.length - 1
  const missing = sheet.zones.flatMap((z, i) => missingInZone(z).map((m) => ({ text: `${zoneName(z.zoneId)}: ${m}`, step: i })))

  const goTo = (i: number) => {
    setParams(i === 0 ? {} : { step: steps[i]!.key })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function finishEdit() {
    await flush()
    toast('حُفظت التعديلات')
    navigate(`/distribution/${date}`)
  }

  async function send() {
    const yes = await confirm({
      title: 'إغلاق اليوم وإرسال الكشف؟',
      message: missing.length ? `في ${missing.length} حقول فارغة. بعد الإرسال يصل الكشف للمدير ولا تقدر تعدّله.` : 'بعد الإرسال يصل الكشف للمدير ولا تقدر تعدّله.',
      confirmLabel: 'إغلاق وإرسال',
    })
    if (!yes) return
    setSending(true)
    try {
      await flush()
      await submitSheet(latest.current, employee, !online)
      toast(online ? 'أُغلق الكشف ووصل للمدير' : 'أُغلق الكشف، ويصل للمدير عند عودة الاتصال')
    } catch {
      toast('تعذّر الإرسال. حاول مرة أخرى.', 'danger')
      setSending(false)
    }
  }

  const { weekday, date: longDate } = describeDay(date)
  const totals = sheetTotals(sheet)
  const entry = sheet.zones[stepIndex]

  return (
    <div className="entry wide">
      {editingSent && (
        <div className="banner" role="status">
          <Pencil size={18} />
          <p>تعدّل كشفاً أُرسل من الموقع<span>كل تغيير يُحفظ ويظهر في الكشف مباشرة. حالته ({statusInfo[sheet.status].label}) لا تتغير.</span></p>
        </div>
      )}
      {isManagerRole(employee.role) && <BackButton fallback={`/distribution/${date}`} />}
      <header className="entry-head">
        <div>
          <h1>{date === todayISO() ? 'كشف اليوم' : `كشف ${dayName(date)}`}</h1>
          <p className="muted">{weekday} · <span className="num">{longDate}</span></p>
        </div>
        <SaveBadge state={saveState} online={online} />
      </header>
      {isManagerRole(employee.role) && <DayJump date={date} hrefFor={(d) => `/sheet/${d}`} />}

      {sheet.status === 'returned' && (
        <div className="banner danger" role="alert">
          <CircleAlert size={18} />
          <p>أعاد المدير فتح اليوم<span>{sheet.returnedReason}</span></p>
        </div>
      )}
      {date === todayISO() && <UnsentBanner sheets={unsent ?? []} hrefFor={(d) => `/sheet/${d}`} title="كشوف لم تُرسل بعد" />}

      <div className="zone-layout">
        <nav className="zone-nav" aria-label="المناطق">
          {sheet.zones.map((z, i) => {
            const done = missingInZone(z).length === 0
            const started = !z.supplied || z.supplyHours !== null || z.runs.some((r) => r.start || r.end)
            return (
              <button
                key={z.id}
                type="button"
                className="zone-item"
                aria-current={i === stepIndex ? 'step' : undefined}
                data-done={done || undefined}
                onClick={() => goTo(i)}
              >
                <span className="zone-dot">{done && i !== stepIndex ? <Check size={14} strokeWidth={3} /> : <span className="num">{i + 1}</span>}</span>
                <span className="zone-text">
                  <b>{zoneName(z.zoneId)}</b>
                  <small className="num">
                    {!z.supplied ? 'بدون تغذية' : z.supplyHours !== null ? `${formatAmount(z.supplyHours)} ساعة · ${z.runs.length} تشغيلات` : started ? 'قيد التعبئة' : 'لم تُعبّأ'}
                  </small>
                </span>
              </button>
            )
          })}
          <button type="button" className="zone-item send" aria-current={stepIndex === sendIndex ? 'step' : undefined} onClick={() => goTo(sendIndex)}>
            <span className="zone-dot"><Send size={14} /></span>
            <span className="zone-text">
              <b>الإرسال</b>
              <small>{missing.length ? `${missing.length} خانات فارغة` : 'جاهز'}</small>
            </span>
          </button>
        </nav>

        <div className="zone-main">
        <div className="entry-body" onKeyDown={advanceOnEnter}>
          {entry ? (
            <ZoneStep key={entry.id} entry={entry} index={stepIndex} count={sheet.zones.length} name={zoneName(entry.zoneId)} update={update} />
          ) : (
            <>
              <section className="fcard">
                <h3 className="fcard-title">الملاحظات</h3>
                <textarea
                  className="textarea"
                  rows={3}
                  placeholder="أي شيء يجب أن يعرفه المدير…"
                  aria-label="الملاحظات العامة"
                  value={sheet.notes}
                  onChange={(e) => update((s) => void (s.notes = e.target.value))}
                />
              </section>
              <section className="card summary">
                {sheet.zones.map((z, i) => (
                  <button key={z.id} type="button" className="summary-row as-button" onClick={() => goTo(i)}>
                    <span>{zoneName(z.zoneId)}</span>
                    <b className="num">
                      {!z.supplied ? 'بدون تغذية' : `${formatAmount(z.supplyHours)} ساعة · ${z.runs.length} تشغيلات`}
                    </b>
                  </button>
                ))}
                <div className="summary-row total"><span>المجموع</span><b className="num">{formatAmount(totals.totalHours)} ساعة · {totals.runs} تشغيلات</b></div>
              </section>
              <MissingList items={missing} onJump={goTo} />
              {!online && <OfflineSendNote />}
            </>
          )}
        </div>
        </div>
      </div>

      <div className="foot-fade" aria-hidden="true" />
      <footer className="entry-foot glass">
        {stepIndex > 0 && (
          <Button icon={<ArrowRight size={18} />} onClick={() => goTo(stepIndex - 1)} aria-label="الخطوة السابقة">
            <span className="hide-sm">السابق</span>
          </Button>
        )}
        {stepIndex < sendIndex ? (
          <Button variant="primary" size="lg" block onClick={() => goTo(stepIndex + 1)}>
            التالي: {steps[stepIndex + 1]!.label}
            <ArrowLeft size={18} />
          </Button>
        ) : editingSent ? (
          <Button variant="primary" size="lg" block icon={<Check size={18} />} onClick={() => void finishEdit()}>
            حفظ التعديلات والعودة للكشف
          </Button>
        ) : (
          <Button variant="primary" size="lg" block busy={sending} icon={<Send size={18} />} onClick={() => void send()}>
            إغلاق اليوم وإرسال
          </Button>
        )}
      </footer>
    </div>
  )
}

function ZoneStep({ entry, index, count, name, update }: { entry: ZoneEntry; index: number; count: number; name: string; update: Update }) {
  const set = (change: (z: ZoneEntry) => void) => update((s) => change(s.zones[index]!))
  return (
    <>
      <section className="fcard" data-off={!entry.supplied || undefined}>
        <header className="gen-head">
          <div>
            <h3 className="fcard-title">{name}</h3>
            <small className="muted num">المنطقة {index + 1} من {count}</small>
          </div>
          <Chip pressed={!entry.supplied} onClick={() => set((z) => (z.supplied = !z.supplied))}>
            <Moon size={15} /> لم تُغذَّ اليوم
          </Chip>
        </header>
        {entry.supplied && (
          <div className="zone-top">
            <CalcField label="عدد الساعات" unit="ساعة" value={entry.supplyHours} hint="يُحسب لحاله من أوقات التشغيلات" />
          </div>
        )}
      </section>

      {entry.supplied &&
        entry.runs.map((run, j) => (
          <section key={run.id} className="fcard zrun-card">
            <span className="run-label">
              التشغيلة {RUN_NAMES[j]}
              {entry.runs.length > 1 && (
                <button
                  type="button"
                  className="icon-btn sm"
                  aria-label={`حذف التشغيلة ${RUN_NAMES[j]}`}
                  onClick={() =>
                    set((z) => {
                      z.runs.splice(j, 1)
                      z.runs.forEach((r, k) => (r.runNo = k + 1))
                    })
                  }
                >
                  <X size={16} />
                </button>
              )}
            </span>
            <div className="run-times">
              <TimeField label={`بداية التشغيلة ${RUN_NAMES[j]}`} value={run.start} onChange={(v) => set((z) => (z.runs[j]!.start = v))} />
              <ArrowLeft size={16} className="muted" aria-hidden="true" />
              <TimeField label={`نهاية التشغيلة ${RUN_NAMES[j]}`} value={run.end} onChange={(v) => set((z) => (z.runs[j]!.end = v))} />
            </div>
            {crossesMidnight(run) && <span className="next-day">حتى اليوم التالي</span>}
          </section>
        ))}

      {entry.supplied && entry.runs.length < MAX_ZONE_RUNS && (
        <button
          type="button"
          className="btn block dashed"
          onClick={() => set((z) => z.runs.push(emptyZoneRun(z.runs.length + 1, z.runs[z.runs.length - 1]?.loadUnit)))}
        >
          <Plus size={18} /> التشغيلة {RUN_NAMES[entry.runs.length]}
        </button>
      )}

      {entry.supplied && <ZoneLoads entry={entry} name={name} set={set} />}
    </>
  )
}

/** The paper's table for this zone: three readings in each hour band, with the mean of every hour and of the day. */
function ZoneLoads({ entry, name, set }: { entry: ZoneEntry; name: string; set: (change: (z: ZoneEntry) => void) => void }) {
  const unit = entry.runs[0]?.loadUnit ?? 'A'
  const day = bandsDayAverage(entry.bands)
  return (
    <section className="fcard zloads">
      <header className="gen-head zloads-head">
        <div>
          <h3 className="fcard-title">الأحمال حسب الساعة</h3>
          <small className="muted">Enter = اللي بعده · الأسهم للتنقل · الفاضي = شحطة</small>
        </div>
        <Segmented label="وحدة الأحمال" value={unit} options={LOAD_UNIT_OPTIONS} onChange={(v) => set((z) => z.runs.forEach((r) => (r.loadUnit = v)))} />
      </header>
      <BandGrid
        name={name}
        rows={3}
        unit={unit === 'A' ? 'أمبير' : 'كيلوواط'}
        max={unit === 'A' ? 2000 : 1000}
        values={entry.bands.map((b) => b)}
        average={entry.bands.map(bandAverage)}
        onChange={(b, r, v) => set((z) => void (z.bands[b]![r] = v))}
      />
      <div className="avg-line" aria-live="polite">
        <span>متوسط اليوم <small>(من الساعات اللي اكتملت قراءاتها الثلاثة)</small></span>
        <b className="num">{day === null ? '—' : `${formatAmount(day)} ${unit === 'A' ? 'أمبير' : 'كيلوواط'}`}</b>
      </div>
    </section>
  )
}

/** After sending: what was sent, and whether the manager approved it. */
function SentSheet({ sheet }: { sheet: DistributionSheet }) {
  const ctx = useSheetContext(sheet)
  const unsent = useUnsentSheetsBefore(sheet.sheetDate)
  return (
    <div className="entry wide">
      <SentHeader sheet={sheet} date={sheet.sheetDate} noun="الكشف" />
      {sheet.sheetDate === todayISO() && <UnsentBanner sheets={unsent ?? []} hrefFor={(d) => `/sheet/${d}`} title="كشوف لم تُرسل بعد" />}
      {ctx.ready ? <SheetView sheet={sheet} ctx={ctx} /> : <div className="loading-block" aria-busy="true" />}
    </div>
  )
}
