import { ArrowLeft, CircleAlert, Clock, Moon, Plus, Settings2, StickyNote, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { GeneratorDialog } from './GeneratorDialog'
import { formatAmount } from '../../lib/numbers'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../data/db'
import { BandGrid } from '../sheets/BandGrid'
import { valuesDayAverage } from '../sheets/loads'
import { CalcField, Chip, NumberField, Segmented, TextField, TimeField } from '../../ui/form'
import {
  crossesMidnight,
  emptyRun,
  openingFromPrevious,
  MAINTENANCE_TYPES,
  MAX_RUNS,
  newId,
  type FuelType,
  type Generator,
  type LoadUnit,
  type PressureUnit,
  type SiteReport,
} from './model'

export type Update = (change: (draft: SiteReport) => void) => void

const ordinals = ['الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة']
const loadUnits = [
  { value: 'A' as LoadUnit, label: 'أمبير' },
  { value: 'kW' as LoadUnit, label: 'كيلوواط' },
]
const pressureUnits = [
  { value: 'bar' as PressureUnit, label: 'bar' },
  { value: 'psi' as PressureUnit, label: 'psi' },
]

function NoteToggle({ value, onChange, label = 'ملاحظة' }: { value: string; onChange(v: string): void; label?: string }) {
  const [open, setOpen] = useState(value.length > 0)
  if (!open) {
    return (
      <button type="button" className="link-btn" onClick={() => setOpen(true)}>
        <StickyNote size={16} /> إضافة {label}
      </button>
    )
  }
  return (
    <textarea
      className="textarea"
      rows={2}
      placeholder={`${label} (اختياري)`}
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      autoFocus={value.length === 0}
    />
  )
}

// ---------- Step 1: fuel ----------
export function FuelStep({ report, fuelTypes, previous, update }: {
  report: SiteReport
  fuelTypes: FuelType[]
  previous: SiteReport | null
  update: Update
}) {
  const nameOf = (id: number) => fuelTypes.find((f) => f.id === id)?.name ?? 'وقود'
  return (
    <>
      {report.fuel.length > 1 && (
        <nav className="fuel-jump" aria-label="انتقل بين الأصناف">
          <span className="muted">اكتب بأي ترتيب:</span>
          {report.fuel.map((l) => (
            <button
              key={l.id}
              type="button"
              className="fuel-jump-btn"
              data-done={(l.openingBalance !== null && l.closingBalance !== null) || undefined}
              onClick={() => document.getElementById(`fuel-${l.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            >
              {nameOf(l.fuelTypeId)}
            </button>
          ))}
        </nav>
      )}
      {report.fuel.map((line, i) => {
        const name = nameOf(line.fuelTypeId)
        const before = previous?.fuel.find((f) => f.fuelTypeId === line.fuelTypeId)?.closingBalance
        const set = (change: (l: typeof line) => void) => update((r) => change(r.fuel[i]!))
        return (
          <section key={line.id} id={`fuel-${line.id}`} className="fcard">
            <h3 className="fcard-title">
              <span className={`fuel-dot ${i === 0 ? '' : 'chrome'}`} aria-hidden="true" />
              {name}
              <span className="fcard-count num">
                {i + 1} من {report.fuel.length}
              </span>
            </h3>
            <div className="fgrid">
              {openingFromPrevious(line, previous) ? (
                <CalcField label="الرصيد الموجود" unit="لتر" value={line.openingBalance} hint={`متبقي التقرير السابق${before !== null && before !== undefined ? '' : ''}`} />
              ) : (
                <NumberField
                  label="الرصيد الموجود"
                  unit="لتر"
                  max={200000}
                  value={line.openingBalance}
                  onChange={(v) => set((l) => (l.openingBalance = v))}
                  hint="أول تقرير: اكتبه مرة واحدة، وبعدها يُؤخذ من متبقي اليوم السابق"
                />
              )}
              <NumberField label="الكمية الواردة" unit="لتر" max={200000} value={line.receivedQty} onChange={(v) => set((l) => (l.receivedQty = v))} />
              <CalcField label="المجموع" unit="لتر" value={line.totalQty} hint="الرصيد الموجود + الوارد" />
              <NumberField label="الرصيد المتبقي" unit="لتر" max={200000} value={line.closingBalance} onChange={(v) => set((l) => (l.closingBalance = v))} hint="اللي باقي بالخزان الآن" />
              <CalcField
                label="الاستهلاك"
                unit="لتر"
                value={line.consumption}
                hint={line.consumption !== null && line.consumption < 0 ? 'تنبيه: المتبقي أكبر من المجموع، راجع الأرقام' : 'يُحسب لحاله: المجموع − المتبقي'}
              />
              <TextField label="رقم الإرسالية" numeric value={line.shipmentNo} onChange={(v) => set((l) => (l.shipmentNo = v))} />
            </div>
            <NoteToggle value={line.notes} onChange={(v) => set((l) => (l.notes = v))} />
          </section>
        )
      })}
    </>
  )
}

// ---------- Step 2: running and loads ----------
export function RunsStep({ report, generators, update }: { report: SiteReport; generators: Generator[]; update: Update }) {
  // How often each generator ran in the reports on this phone: the usual ones come first.
  const usage = useLiveQuery(async () => {
    const counts = new Map<number, number>()
    for (const r of await db.siteReports.toArray()) for (const g of r.generators) if (g.didRun) counts.set(g.generatorId, (counts.get(g.generatorId) ?? 0) + 1)
    return counts
  }, [])
  const order = [...report.generators.keys()].sort((a, b) => {
    const ga = report.generators[a]!.generatorId
    const gb = report.generators[b]!.generatorId
    return (usage?.get(gb) ?? 0) - (usage?.get(ga) ?? 0) || ga - gb
  })
  const name = (id: number) => generators.find((g) => g.id === id)?.name ?? 'مولد'
  // The site adds or fixes a generator itself, without going through the settings.
  const [editing, setEditing] = useState<Generator | 'new' | null>(null)
  const [justAdded, setJustAdded] = useState<number | null>(null)
  useEffect(() => {
    if (justAdded === null) return
    const i = report.generators.findIndex((g) => g.generatorId === justAdded)
    if (i < 0) return
    setJustAdded(null)
    // Added because it ran today: open its boxes straight away.
    if (!report.generators[i]!.didRun) update((r) => (r.generators[i]!.didRun = true))
  }, [justAdded, report.generators, update])
  return (
    <>
      {editing && (
        <GeneratorDialog
          generator={editing === 'new' ? null : editing}
          others={generators}
          onClose={() => setEditing(null)}
          onSaved={(id) => editing === 'new' && setJustAdded(id)}
        />
      )}
      <section className="fcard gen-pick">
        <h3 className="fcard-title">أي مولد اشتغل اليوم؟</h3>
        <div className="chips">
          {order.map((i) => {
            const log = report.generators[i]!
            return (
              <Chip key={log.id} pressed={log.didRun} onClick={() => update((r) => (r.generators[i]!.didRun = !r.generators[i]!.didRun))}>
                {name(log.generatorId)}
              </Chip>
            )
          })}
          <button type="button" className="chip add-chip" onClick={() => setEditing('new')}>
            <Plus size={15} /> مولد جديد
          </button>
        </div>
        {!report.generators.some((g) => g.didRun) && <p className="field-hint">اضغط المولد اللي اشتغل لتظهر خاناته.</p>}
      </section>
      {order.map((i) => report.generators[i]!).map((log) => {
        const i = report.generators.indexOf(log)
        if (!log.didRun) return null
        const gen = generators.find((g) => g.id === log.generatorId)
        const set = (change: (l: typeof log) => void) => update((r) => change(r.generators[i]!))
        return (
          <section key={log.id} className="fcard gen-card" data-off={!log.didRun || undefined}>
            <header className="gen-head">
              <div>
                <h3 className="fcard-title">{gen?.name ?? 'مولد'}</h3>
                <small className="muted">
                  {gen?.brand}
                  {gen?.capacityKva ? <span className="num"> · {formatAmount(gen.capacityKva)} kVA</span> : null}
                </small>
              </div>
              <div className="gen-head-actions">
                {gen && (
                  <button type="button" className="icon-btn" aria-label={`إعدادات ${gen.name}`} title="إعدادات المولد" onClick={() => setEditing(gen)}>
                    <Settings2 size={17} />
                  </button>
                )}
                <Chip pressed={false} onClick={() => set((l) => (l.didRun = false))}>
                  <Moon size={15} /> لم يعمل اليوم
                </Chip>
              </div>
            </header>

            {log.didRun && (
              <>
                <div className="runs-edit">
                  {log.runs.map((run, j) => (
                    <div key={run.id} className="run-row">
                      <span className="run-label">
                        التشغيلة {ordinals[j]}
                        {log.runs.length > 1 && (
                          <button
                            type="button"
                            className="icon-btn sm"
                            aria-label={`حذف التشغيلة ${ordinals[j]}`}
                            onClick={() =>
                              set((l) => {
                                l.runs.splice(j, 1)
                                l.runs.forEach((r, k) => (r.runNo = k + 1))
                              })
                            }
                          >
                            <X size={16} />
                          </button>
                        )}
                      </span>
                      <div className="run-times">
                        <TimeField label={`بداية التشغيلة ${ordinals[j]}`} value={run.start} onChange={(v) => set((l) => (l.runs[j]!.start = v))} />
                        <ArrowLeft size={16} className="muted" aria-hidden="true" />
                        <TimeField label={`نهاية التشغيلة ${ordinals[j]}`} value={run.end} onChange={(v) => set((l) => (l.runs[j]!.end = v))} />
                      </div>
                      {crossesMidnight(run) && <span className="next-day">حتى اليوم التالي</span>}
                    </div>
                  ))}
                  {log.runs.length < MAX_RUNS && (
                    <button type="button" className="link-btn" onClick={() => set((l) => l.runs.push(emptyRun(l.runs.length + 1)))}>
                      <Plus size={16} /> تشغيلة {ordinals[log.runs.length]}
                    </button>
                  )}
                </div>

                <div className="run-total" aria-live="polite">
                  <span><Clock size={16} /> مجموع ساعات التشغيل <small>من أوقات التشغيلات</small></span>
                  <b className="num">{log.runHours === null ? '—' : `${formatAmount(log.runHours)} ساعة`}</b>
                </div>

                <div className="fgrid gauges">
                  <div className="group">
                    <div className="group-head"><span>الحرارة</span></div>
                    <NumberField bareLabel label="الحرارة" unit="°C" max={150} value={log.temperatureC} onChange={(v) => set((l) => (l.temperatureC = v))} />
                  </div>
                  <div className="group">
                    <div className="group-head">
                      <span>ضغط الزيت</span>
                      <Segmented label="وحدة ضغط الزيت" value={log.oilPressureUnit} options={pressureUnits} onChange={(v) => set((l) => (l.oilPressureUnit = v))} />
                    </div>
                    <NumberField
                      bareLabel
                      label="ضغط الزيت"
                      unit={log.oilPressureUnit}
                      max={log.oilPressureUnit === 'bar' ? 15 : 220}
                      value={log.oilPressure}
                      onChange={(v) => set((l) => (l.oilPressure = v))}
                    />
                  </div>
                </div>
                <NoteToggle value={log.notes} onChange={(v) => set((l) => (l.notes = v))} />
              </>
            )}
          </section>
        )
      })}
    </>
  )
}

// ---------- Step 4: loads, hour by hour (the paper's table) ----------
export function LoadsStep({ report, generators, update }: { report: SiteReport; generators: Generator[]; update: Update }) {
  const ran = report.generators.filter((g) => g.didRun)
  return (
    <>
      <div className="fcard loads-intro">
        <b>الأحمال حسب الساعة</b>
        <span>اكتب حمل كل مولد بكل ساعة، زي جدول الورق. Enter بينقلك للخانة اللي بعدها، والأسهم للتنقل، والفاضي بيصير شحطة (—).</span>
      </div>
      {ran.length === 0 && (
        <div className="fcard empty-step">
          <b>ما في مولد اشتغل اليوم</b>
          <span>ما في أحمال تتعبّى. كمّل للإرسال.</span>
        </div>
      )}
      {ran.map((log) => {
        const index = report.generators.indexOf(log)
        const gen = generators.find((g) => g.id === log.generatorId)
        const set = (change: (l: typeof log) => void) => update((r) => change(r.generators[index]!))
        const day = valuesDayAverage(log.bandLoads)
        return (
          <section key={log.id} className="fcard gloads">
            <header className="gen-head zloads-head">
              <div>
                <h3 className="fcard-title">{gen?.name ?? 'مولد'}</h3>
                <small className="muted">{gen?.brand}{gen?.capacityKva ? ` · ${formatAmount(gen.capacityKva)} kVA` : ''}</small>
              </div>
              <Segmented label="وحدة الأحمال" value={log.loadUnit} options={loadUnits} onChange={(v) => set((l) => (l.loadUnit = v))} />
            </header>
            <BandGrid
              name={gen?.name ?? 'مولد'}
              rows={1}
              max={log.loadUnit === 'A' ? 5000 : 2000}
              values={log.bandLoads.map((v) => [v])}
              onChange={(b, _r, v) => set((l) => void (l.bandLoads[b] = v))}
            />
            <div className="avg-line" aria-live="polite">
              <span>متوسط الساعات المكتوبة</span>
              <b className="num">{day === null ? '—' : `${formatAmount(day)} ${log.loadUnit === 'A' ? 'أمبير' : 'كيلوواط'}`}</b>
            </div>
          </section>
        )
      })}
    </>
  )
}

// ---------- Step 3: maintenance ----------
export function MaintenanceStep({ report, generators, update }: { report: SiteReport; generators: Generator[]; update: Update }) {
  const active = generators.filter((g) => g.isActive || report.maintenance.some((m) => m.generatorId === g.id))
  return (
    <>
      {report.maintenance.length === 0 && (
        <div className="fcard empty-step">
          <b>لا صيانات اليوم؟</b>
          <span>تخطَّ هذه الخطوة. وإن وُجدت صيانة، اضغط «إضافة صيانة».</span>
        </div>
      )}
      {report.maintenance.map((m, i) => {
        const set = (change: (e: typeof m) => void) => update((r) => change(r.maintenance[i]!))
        return (
          <section key={m.id} className="fcard">
            <header className="gen-head">
              <h3 className="fcard-title">صيانة {i + 1}</h3>
              <button type="button" className="icon-btn sm" aria-label={`حذف الصيانة ${i + 1}`} onClick={() => update((r) => void r.maintenance.splice(i, 1))}>
                <Trash2 size={16} />
              </button>
            </header>
            <div className="label">المولد</div>
            <div className="chips">
              {active.map((g) => (
                <Chip key={g.id} pressed={m.generatorId === g.id} onClick={() => set((e) => (e.generatorId = g.id))}>
                  {g.name}
                </Chip>
              ))}
            </div>
            <div className="label">نوع الصيانة</div>
            <div className="chips">
              {MAINTENANCE_TYPES.map((t) => (
                <Chip
                  key={t.value}
                  pressed={m.types.includes(t.value)}
                  onClick={() => set((e) => (e.types = e.types.includes(t.value) ? e.types.filter((x) => x !== t.value) : [...e.types, t.value]))}
                >
                  {t.label}
                </Chip>
              ))}
            </div>
            <div className="fgrid">
              <NumberField label="زيت جديد" unit="لتر" max={500} value={m.oilNewLiters} onChange={(v) => set((e) => (e.oilNewLiters = v))} />
              <NumberField label="زيت محروق" unit="لتر" max={500} value={m.oilUsedLiters} onChange={(v) => set((e) => (e.oilUsedLiters = v))} />
            </div>
            <NoteToggle label="وصف" value={m.description} onChange={(v) => set((e) => (e.description = v))} />
          </section>
        )
      })}
      <button
        type="button"
        className="btn block dashed"
        onClick={() =>
          update((r) =>
            r.maintenance.push({
              id: newId(),
              generatorId: active.length === 1 ? active[0]!.id : null,
              oilNewLiters: null,
              oilUsedLiters: null,
              types: [],
              description: '',
            }),
          )
        }
      >
        <Plus size={18} /> إضافة صيانة
      </button>
    </>
  )
}

// ---------- Step 4: notes and send ----------
export function NotesField({ report, update }: { report: SiteReport; update: Update }) {
  return (
    <section className="fcard">
      <h3 className="fcard-title">الملاحظات</h3>
      <textarea
        className="textarea"
        rows={4}
        placeholder="أي شيء يجب أن يعرفه المدير…"
        aria-label="الملاحظات العامة"
        value={report.generalNotes}
        onChange={(e) => update((r) => void (r.generalNotes = e.target.value))}
      />
    </section>
  )
}

export function MissingList({ items, onJump }: { items: Array<{ text: string; step: number }>; onJump(step: number): void }) {
  if (!items.length) return null
  return (
    <section className="fcard missing">
      <h3 className="fcard-title">
        <CircleAlert size={18} /> حقول فارغة ({items.length})
      </h3>
      <ul>
        {items.map((m) => (
          <li key={m.text}>
            <button type="button" className="link-btn" onClick={() => onJump(m.step)}>
              {m.text}
            </button>
          </li>
        ))}
      </ul>
      <p className="field-hint">يمكنك الإرسال مع النقص، والمدير يستطيع إعادته للتصحيح.</p>
    </section>
  )
}
