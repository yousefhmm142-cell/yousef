import { ArrowLeft, Clock, Droplet, Gauge, NotebookPen, TriangleAlert, Wrench, Zap } from 'lucide-react'
import { formatAmount } from '../../lib/numbers'
import { Pill, type Tone } from '../../ui/primitives'
import { AlertsCard, Signatures } from '../sheets/ui'
import { computeAlerts, consumptionStats, fuelOutlook } from './alerts'
import {
  maintenanceLabel,
  reportTotals,
  toBar,
  type AlertSettings,
  type FuelType,
  type Generator,
  type GeneratorLog,
  type SiteReport,
} from './model'
import { useAlertSettings, useEmployeeNames, useFuelTypes, useGenerators, useHistoryBefore } from './repo'
import { clock12 } from '../../lib/format'

const SQRT3 = Math.sqrt(3)

/** Everything a report screen needs besides the report itself. */
export function useReportContext(report: SiteReport | null | undefined) {
  const generators = useGenerators()
  const fuelTypes = useFuelTypes()
  const settings = useAlertSettings()
  const history = useHistoryBefore(report?.reportDate ?? '0000-00-00')
  const names = useEmployeeNames()
  const ready = !!generators && !!fuelTypes && !!history
  const alerts =
    report && ready
      ? computeAlerts(report, {
          history: history!,
          generators: new Map(generators!.map((g) => [g.id, g])),
          fuelNames: new Map(fuelTypes!.map((f) => [f.id, f.name])),
          settings,
        })
      : []
  return { ready, generators: generators ?? [], fuelTypes: fuelTypes ?? [], settings, history: history ?? [], names, alerts }
}


function readingTone(value: number, warn: number, danger: number, higherIsWorse: boolean): Tone {
  if (higherIsWorse) return value >= danger ? 'danger' : value >= warn ? 'warn' : 'ok'
  return value < danger ? 'danger' : value < warn ? 'warn' : 'ok'
}

/** Rated current or power per phase, so each load bar shows how full that phase is. */
function phaseCapacity(gen: Generator | undefined, log: GeneratorLog): number | null {
  if (!gen?.capacityKva) return null
  return log.loadUnit === 'A' ? (gen.capacityKva * 1000) / (SQRT3 * 400) : (gen.capacityKva * 0.8) / 3
}

export function ReportView({ report, ctx }: { report: SiteReport; ctx: ReturnType<typeof useReportContext> }) {
  const { generators, fuelTypes, settings, history, names, alerts } = ctx
  const totals = reportTotals(report)
  const use = consumptionStats(report, history)
  const outlook = fuelOutlook(report, history)
  const warnCount = alerts.filter((a) => a.level === 'warn').length
  const dangerCount = alerts.length - warnCount
  const sparkMax = Math.max(1, ...use.series)

  return (
    <div className="report">
      <div className="kpis">
        <div className="kpi hero">
          <div className="kpi-label"><span className="kpi-ico"><Droplet size={16} /></span>الرصيد المتبقي</div>
          <div className="kpi-value num">{formatAmount(totals.remaining)}<small>لتر</small></div>
          <div className="kpi-sub">
            {outlook.days !== null ? `يكفي نحو ${formatAmount(Math.floor(outlook.days * 10) / 10)} يوم بالمعدل الحالي` : 'لم يُعبّأ الرصيد المتبقي'}
          </div>
        </div>
        <div className="kpi glass">
          <div className="kpi-label"><span className="kpi-ico"><Gauge size={16} /></span>الاستهلاك</div>
          <div className="kpi-value num">{formatAmount(use.today)}<small>لتر</small></div>
          <div className="kpi-sub">
            {use.changePct === null ? (
              'لا يوجد متوسط للمقارنة بعد'
            ) : (
              <>
                <Pill tone={use.changePct >= settings.consumptionWarnPct ? 'warn' : 'ok'} dot={false}>
                  <span className="num ltr">{use.changePct >= 0 ? '+' : ''}{Math.round(use.changePct)}%</span>
                </Pill>
                عن المعتاد
              </>
            )}
          </div>
          <div className="spark" aria-hidden="true">
            {use.series.map((v, i) => (
              <i key={i} style={{ height: `${Math.max(6, (v / sparkMax) * 100)}%` }} data-today={i === use.series.length - 1 || undefined} />
            ))}
          </div>
        </div>
        <div className="kpi glass">
          <div className="kpi-label"><span className="kpi-ico"><Clock size={16} /></span>ساعات التشغيل</div>
          <div className="kpi-value num">{formatAmount(totals.runHours)}<small>ساعة</small></div>
          <div className="kpi-sub num">{totals.generatorsRan} من {report.generators.length} مولدات عملت</div>
        </div>
        <div className="kpi glass">
          <div className="kpi-label"><span className="kpi-ico"><TriangleAlert size={16} /></span>التنبيهات</div>
          <div className="kpi-value num">{alerts.length}</div>
          <div className="kpi-sub">
            {alerts.length === 0 ? 'كل القراءات ضمن الحدود' : [dangerCount && `${dangerCount} خطر`, warnCount && `${warnCount} تحذير`].filter(Boolean).join(' · ')}
          </div>
        </div>
      </div>

      {alerts.length > 0 && <AlertsCard alerts={alerts} />}
      <FuelTable report={report} fuelTypes={fuelTypes} />
      <GeneratorsTable report={report} generators={generators} settings={settings} />

      <div className="two">
        <section className="card">
          <div className="card-h"><span className="ico-round"><Wrench size={16} /></span><h2>الصيانات</h2></div>
          {report.maintenance.length === 0 ? (
            <p className="card-empty">لا صيانات في هذا اليوم.</p>
          ) : (
            <ul className="maint-list">
              {report.maintenance.map((m) => (
                <li key={m.id}>
                  <div><small>المولد</small><b>{generators.find((g) => g.id === m.generatorId)?.name ?? '—'}</b></div>
                  <div><small>زيت جديد</small><b className="num">{m.oilNewLiters === null ? '—' : `${formatAmount(m.oilNewLiters)} لتر`}</b></div>
                  <div><small>زيت محروق</small><b className="num">{m.oilUsedLiters === null ? '—' : `${formatAmount(m.oilUsedLiters)} لتر`}</b></div>
                  <div className="wide">
                    <small>نوع الصيانة</small>
                    <b>{m.types.map(maintenanceLabel).join('، ') || '—'}</b>
                    {m.description && <span className="muted">{m.description}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card">
          <div className="card-h"><span className="ico-round"><NotebookPen size={16} /></span><h2>الملاحظات</h2></div>
          <p className={report.generalNotes ? 'note' : 'card-empty'}>{report.generalNotes || 'لا ملاحظات.'}</p>
        </section>
      </div>

      <Signatures sheet={report} names={names} sender="مشغّل الموقع" />
    </div>
  )
}

function FuelTable({ report, fuelTypes }: { report: SiteReport; fuelTypes: FuelType[] }) {
  return (
    <section className="card">
      <div className="card-h"><span className="ico-round"><Droplet size={16} /></span><h2>المحروقات</h2><span className="meta">باللتر</span></div>
      <div className="tw">
        <table className="tbl">
          <thead>
            <tr><th>نوع الوقود</th><th>الرصيد الموجود</th><th>الكمية الواردة</th><th>المجموع</th><th>الرصيد المتبقي</th><th>الاستهلاك</th><th>رقم الإرسالية</th><th>ملاحظات</th></tr>
          </thead>
          <tbody>
            {report.fuel.map((f, i) => (
              <tr key={f.id}>
                <td><span className="fuel-name"><span className={`fuel-dot ${i === 0 ? '' : 'chrome'}`} />{fuelTypes.find((t) => t.id === f.fuelTypeId)?.name}</span></td>
                <td className="n">{formatAmount(f.openingBalance)}</td>
                <td className="n">{formatAmount(f.receivedQty)}</td>
                <td className="n">{formatAmount(f.totalQty)}</td>
                <td className="n em">{formatAmount(f.closingBalance)}</td>
                <td className="n em">{formatAmount(f.consumption)}</td>
                <td className="n">{f.shipmentNo || '—'}</td>
                <td className="muted">{f.notes || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function GeneratorsTable({ report, generators, settings }: { report: SiteReport; generators: Generator[]; settings: AlertSettings }) {
  return (
    <section className="card">
      <div className="card-h"><span className="ico-round"><Zap size={16} /></span><h2>التشغيل والأحمال</h2></div>
      <div className="tw">
        <table className="tbl">
          <thead>
            <tr><th>المولد</th><th>التشغيلات</th><th>ساعات التشغيل</th><th>الأحمال</th><th>الحرارة</th><th>ضغط الزيت</th></tr>
          </thead>
          <tbody>
            {report.generators.map((log) => {
              const gen = generators.find((g) => g.id === log.generatorId)
              const cap = phaseCapacity(gen, log)
              return (
                <tr key={log.id} data-off={!log.didRun || undefined}>
                  <td className="gen">
                    <b>{gen?.name ?? 'مولد'}</b>
                    <small>{gen?.brand}{gen?.capacityKva ? <span className="num"> · {formatAmount(gen.capacityKva)} kVA</span> : null}</small>
                  </td>
                  {!log.didRun ? (
                    <td colSpan={5} className="muted">لم يعمل في هذا اليوم</td>
                  ) : (
                    <>
                      <td>
                        <div className="runs">
                          {log.runs.filter((r) => r.start || r.end).map((r) => (
                            <span key={r.id} className="run num">{clock12(r.start) || '—'}<ArrowLeft size={13} aria-label="إلى" />{clock12(r.end) || '—'}</span>
                          ))}
                        </div>
                      </td>
                      <td className="n em">{formatAmount(log.runHours)}</td>
                      <td>
                        <div className="phases">
                          {log.loads.map((v, k) => (
                            <span key={k} className="phase">
                              <em>L{k + 1}</em>
                              <span className="track"><i style={{ width: `${v !== null && cap ? Math.min(100, (v / cap) * 100) : 0}%` }} /></span>
                              <span className="num">{formatAmount(v)}</span>
                            </span>
                          ))}
                          <small className="muted">{log.loadUnit === 'A' ? 'أمبير' : 'كيلوواط'}</small>
                        </div>
                      </td>
                      <td>
                        {log.temperatureC === null ? '—' : (
                          <span className={`reading ${readingTone(log.temperatureC, settings.tempWarnC, settings.tempDangerC, true)}`}>
                            <i /><span className="num">{formatAmount(log.temperatureC)}°</span>
                          </span>
                        )}
                      </td>
                      <td>
                        {log.oilPressure === null ? '—' : (
                          <span className={`reading ${readingTone(toBar(log.oilPressure, log.oilPressureUnit), settings.oilWarnBar, settings.oilDangerBar, false)}`}>
                            <i /><span className="num ltr">{formatAmount(log.oilPressure)} {log.oilPressureUnit}</span>
                          </span>
                        )}
                      </td>
                    </>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
