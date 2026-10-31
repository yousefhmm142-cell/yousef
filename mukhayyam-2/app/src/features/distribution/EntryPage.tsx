import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, ArrowRight, CircleAlert, Moon, Plus, Send, X } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { useEmployee } from '../../auth/AuthProvider'
import { serverNow } from '../../lib/clock'
import { dayName, describeDay, isISODate, todayISO, type ISODate } from '../../lib/dates'
import { formatAmount } from '../../lib/numbers'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { useOnline } from '../../lib/useOnline'
import { advanceOnEnter, Chip, NumberField, Segmented, TimeField } from '../../ui/form'
import { Button } from '../../ui/primitives'
import { useToast } from '../../ui/Toast'
import { MissingList } from '../generation/EntrySteps'
import { OfflineSendNote } from '../generation/EntryPage'
import { LOAD_UNIT_OPTIONS, PHASES } from '../sheets/loads'
import { SaveBadge, SentHeader, Stepper, UnsentBanner } from '../sheets/ui'
import { useConfirmTap, useDraft } from '../sheets/useDraft'
import { isEditableStatus } from '../sheets/workflow'
import {
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
import { lastSheetBefore, saveSheetDraft, submitSheet, useSheet, useUnsentSheetsBefore, useZones } from './repo'
import { SheetView, useSheetContext } from './SheetView'

type Update = (change: (draft: DistributionSheet) => void) => void

/** The site's distribution sheet for one day: today at /sheet, or /sheet/:date. */
export function DistributionEntryPage() {
  const params = useParams()
  const today = todayISO()
  const date: ISODate = isISODate(params.date) ? params.date : today
  const stored = useSheet(date)
  const zones = useZones()
  const previous = useLiveQuery(() => lastSheetBefore(date), [date])
  useDocumentTitle(date === today ? 'كشف اليوم' : `كشف ${dayName(date, today)}`)

  if (date > today) {
    return <div className="empty"><h3>لا يمكن تعبئة يوم لم يأتِ بعد</h3><Link to="/sheet" className="btn">كشف اليوم</Link></div>
  }
  if (stored === undefined || !zones || previous === undefined) return <div className="loading-block" aria-busy="true" />
  if (stored && !isEditableStatus(stored.status)) return <SentSheet sheet={stored} />
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
  const { doc: sheet, update, flush, saveState, latest } = useDraft<DistributionSheet>(
    () =>
      initial
        ? initial.status === 'draft' ? reconcileSheet(initial, zones) : initial
        : newSheet(date, zones, employee.id, previous, serverNow().toISOString()),
    saveSheetDraft,
    !!initial,
  )
  const [armed, arm, disarm] = useConfirmTap()
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

  async function send() {
    if (!armed) return arm()
    setSending(true)
    try {
      await flush()
      await submitSheet(latest.current, employee, !online)
      toast(online ? 'أُغلق الكشف ووصل للمدير' : 'أُغلق الكشف، ويصل للمدير عند عودة الاتصال')
    } catch {
      toast('تعذّر الإرسال. حاول مرة أخرى.', 'danger')
      setSending(false)
      disarm()
    }
  }

  const { weekday, date: longDate } = describeDay(date)
  const totals = sheetTotals(sheet)
  const entry = sheet.zones[stepIndex]

  return (
    <div className="entry">
      <header className="entry-head">
        <div>
          <h1>{date === todayISO() ? 'كشف اليوم' : `كشف ${dayName(date)}`}</h1>
          <p className="muted">{weekday} · <span className="num">{longDate}</span></p>
        </div>
        <SaveBadge state={saveState} online={online} />
      </header>

      {sheet.status === 'returned' && (
        <div className="banner danger" role="alert">
          <CircleAlert size={18} />
          <p>أعاد المدير فتح اليوم<span>{sheet.returnedReason}</span></p>
        </div>
      )}
      {date === todayISO() && <UnsentBanner sheets={unsent ?? []} hrefFor={(d) => `/sheet/${d}`} title="كشوف لم تُرسل بعد" />}

      <Stepper
        scroll
        label="المناطق"
        current={stepIndex}
        onSelect={goTo}
        items={steps.map((s, i) => ({ ...s, icon: i === sendIndex ? Send : undefined, done: i < sendIndex && missingInZone(sheet.zones[i]!).length === 0 }))}
      />

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
        ) : (
          <Button variant="primary" size="lg" block busy={sending} icon={<Send size={18} />} onClick={() => void send()}>
            {armed ? (missing.length ? `تأكيد الإرسال مع ${missing.length} حقول فارغة` : 'اضغط مرة ثانية للتأكيد') : 'إغلاق اليوم وإرسال'}
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
          <div className="fgrid">
            <NumberField label="عدد الساعات" unit="ساعة" max={24} value={entry.supplyHours} onChange={(v) => set((z) => (z.supplyHours = v))} />
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
            <div className="group">
              <div className="group-head">
                <span>الأحمال</span>
                <Segmented label={`وحدة أحمال التشغيلة ${RUN_NAMES[j]}`} value={run.loadUnit} options={LOAD_UNIT_OPTIONS} onChange={(v) => set((z) => (z.runs[j]!.loadUnit = v))} />
              </div>
              <div className="fgrid three">
                {PHASES.map((phase, k) => (
                  <NumberField
                    key={phase}
                    label={phase}
                    unit={run.loadUnit}
                    max={run.loadUnit === 'A' ? 2000 : 1000}
                    value={run.loads[k] ?? null}
                    onChange={(v) => set((z) => (z.runs[j]!.loads[k] = v))}
                  />
                ))}
              </div>
            </div>
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
    </>
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
