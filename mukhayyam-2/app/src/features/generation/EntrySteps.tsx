import { ArrowLeft, CircleAlert, Moon, Plus, Settings2, StickyNote, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { GeneratorDialog } from './GeneratorDialog'
import { formatAmount } from '../../lib/numbers'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../data/db'
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
  return (
    <>
      {report.fuel.map((line, i) => {
        const name = fuelTypes.find((f) => f.id === line.fuelTypeId)?.name ?? 'وقود'
        const before = previous?.fuel.find((f) => f.fuelTypeId === line.fuelTypeId)?.closingBalance
        const set = (change: (l: typeof line) => void) => update((r) => change(r.fuel[i]!))
        return (
          <section key={line.id} className="fcard">
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
              <NumberField label="الاستهلاك" unit="لتر" max={50000} value={line.consumption} onChange={(v) => set((l) => (l.consumption = v))} />
              <CalcField label="الرصيد المتبقي" unit="لتر" value={line.closingBalance} hint="المجموع − الاستهلاك" />
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

                <div className="fgrid">
                  <CalcField label="ساعات التشغيل" unit="ساعة" value={log.runHours} hint="من أوقات التشغيلات" />
                </div>

                <div className="group">
                  <div className="group-head">
                    <span>الأحمال</span>
                    <Segmented label="وحدة الأحمال" value={log.loadUnit} options={loadUnits} onChange={(v) => set((l) => (l.loadUnit = v))} />
                  </div>
                  <div className="fgrid three">
                    {(['L1', 'L2', 'L3'] as const).map((phase, k) => (
                      <NumberField
                        key={phase}
                        label={phase}
                        unit={log.loadUnit}
                        max={log.loadUnit === 'A' ? 5000 : 2000}
                        value={log.loads[k] ?? null}
                        onChange={(v) => set((l) => (l.loads[k] = v))}
                      />
                    ))}
                  </div>
                </div>

                <div className="fgrid">
                  <NumberField label="الحرارة" unit="°C" max={150} value={log.temperatureC} onChange={(v) => set((l) => (l.temperatureC = v))} />
                  <div className="group tight">
                    <NumberField
                      label="ضغط الزيت"
                      unit={log.oilPressureUnit}
                      max={log.oilPressureUnit === 'bar' ? 15 : 220}
                      value={log.oilPressure}
                      onChange={(v) => set((l) => (l.oilPressure = v))}
                    />
                    <Segmented label="وحدة ضغط الزيت" value={log.oilPressureUnit} options={pressureUnits} onChange={(v) => set((l) => (l.oilPressureUnit = v))} />
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
