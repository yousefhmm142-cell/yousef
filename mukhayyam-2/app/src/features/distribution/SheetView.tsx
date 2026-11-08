import { ArrowLeft, Clock, LayoutGrid, NotebookPen, Sun, TriangleAlert, Zap } from 'lucide-react'
import { formatAmount } from '../../lib/numbers'
import { useAlertSettings, useEmployeeNames } from '../generation/repo'
import { readingsAverage, phaseImbalancePct } from '../sheets/loads'
import { AlertsCard, Signatures } from '../sheets/ui'
import { computeZoneAlerts } from './alerts'
import { RUN_NAMES, runSegments, sheetTotals, type DistributionSheet, type ZoneRun } from './model'
import { useZones } from './repo'
import { clock12 } from '../../lib/format'

// The day on the bar runs from 7 in the morning to 2 after midnight, an hour per mark.
const START = 7 * 60
const END = 26 * 60
const SPAN = END - START
const TICKS = Array.from({ length: 20 }, (_, i) => 7 + i)
const tickLabel = (h: number) => { const x = h % 24; return `${x % 12 === 0 ? 12 : x % 12}${x < 12 ? 'ص' : 'م'}` }
/** A run's pieces on that window (after-midnight hours come at the end); outside it they are left off. */
function windowSegments(r: Pick<ZoneRun, 'start' | 'end'>): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (let [a, b] of runSegments(r)) {
    if (b <= START) { a += 1440; b += 1440 }
    const x = Math.max(a, START), y = Math.min(b, END)
    if (y > x) out.push([x - START, y - START])
  }
  // A run past midnight is one piece on this bar, not two.
  out.sort((p, q) => p[0] - q[0])
  return out.reduce<Array<[number, number]>>((m, seg) => { const last = m[m.length - 1]; if (last && seg[0] <= last[1]) last[1] = Math.max(last[1], seg[1]); else m.push([...seg]); return m }, [])
}

export function useSheetContext(sheet: DistributionSheet | null | undefined) {
  const zones = useZones()
  const settings = useAlertSettings()
  const names = useEmployeeNames()
  const zoneNames = new Map((zones ?? []).map((z) => [z.id, z.name]))
  const alerts = sheet && zones ? computeZoneAlerts(sheet, zoneNames, settings) : []
  return { ready: !!zones, zoneNames, names, alerts, settings }
}

type Ctx = ReturnType<typeof useSheetContext>

export function SheetView({ sheet, ctx }: { sheet: DistributionSheet; ctx: Ctx }) {
  const { zoneNames, names, alerts } = ctx
  const totals = sheetTotals(sheet)
  const withHours = sheet.zones.filter((z) => z.supplied && z.supplyHours !== null)
  const byHours = [...withHours].sort((a, b) => (b.supplyHours ?? 0) - (a.supplyHours ?? 0))
  const longest = byHours[0]
  const shortest = byHours[byHours.length - 1]
  const average = withHours.length ? totals.totalHours / withHours.length : null
  const warn = alerts.filter((a) => a.level === 'warn').length

  return (
    <div className="report">
      <div className="kpis">
        <div className="kpi hero">
          <div className="kpi-label"><span className="kpi-ico"><Zap size={16} /></span>مجموع ساعات التغذية</div>
          <div className="kpi-value num">{formatAmount(totals.totalHours)}<small>ساعة</small></div>
          <div className="kpi-sub">{average !== null ? `متوسط ${formatAmount(Math.round(average * 10) / 10)} ساعة لكل منطقة` : 'لم تُعبّأ الساعات'}</div>
        </div>
        <div className="kpi glass">
          <div className="kpi-label"><span className="kpi-ico"><Sun size={16} /></span>أطول تغذية</div>
          <div className="kpi-value kpi-text">{longest ? zoneNames.get(longest.zoneId) : '—'}</div>
          <div className="kpi-sub num">
            {longest ? `${formatAmount(longest.supplyHours)} ساعة` : ''}
            {shortest && shortest !== longest ? ` · وأقلها ${zoneNames.get(shortest.zoneId)} (${formatAmount(shortest.supplyHours)})` : ''}
          </div>
        </div>
        <div className="kpi glass">
          <div className="kpi-label"><span className="kpi-ico"><LayoutGrid size={16} /></span>التشغيلات</div>
          <div className="kpi-value num">{totals.runs}</div>
          <div className="kpi-sub num">في {totals.suppliedZones} من {sheet.zones.length} مناطق</div>
        </div>
        <div className="kpi glass">
          <div className="kpi-label"><span className="kpi-ico"><TriangleAlert size={16} /></span>التنبيهات</div>
          <div className="kpi-value num">{alerts.length}</div>
          <div className="kpi-sub">
            {alerts.length === 0 ? 'كل الأحمال متوازنة' : [alerts.length - warn && `${alerts.length - warn} خطر`, warn && `${warn} تحذير`].filter(Boolean).join(' · ')}
          </div>
        </div>
      </div>

      <AlertsCard alerts={alerts} />
      <Timeline sheet={sheet} zoneNames={zoneNames} imbalanceWarn={ctx.settings.imbalanceWarnPct} />
      <Matrix sheet={sheet} zoneNames={zoneNames} imbalanceWarn={ctx.settings.imbalanceWarnPct} />

      <section className="card">
        <div className="card-h"><span className="ico-round"><NotebookPen size={16} /></span><h2>الملاحظات</h2></div>
        <p className={sheet.notes ? 'note' : 'card-empty'}>{sheet.notes || 'لا ملاحظات.'}</p>
      </section>
      <Signatures sheet={sheet} names={names} sender="مشرف التوزيع" />
    </div>
  )
}

/** One bar per zone across the 24 hours: when each zone actually had power. */
function Timeline({ sheet, zoneNames, imbalanceWarn }: { sheet: DistributionSheet; zoneNames: Map<number, string>; imbalanceWarn: number }) {
  // The load chart: each run's block rises with its average load (scaled to the day's highest, per unit).
  // Heights from zero to the day's highest load (per unit): the difference you see is the real one.
  const top: Record<string, number> = {}
  for (const z of sheet.zones) for (const r of z.runs) {
    const v = readingsAverage(r.loads, r.extra)
    if (v !== null) top[r.loadUnit] = Math.max(top[r.loadUnit] ?? 0, v)
  }
  const height = (v: number, u: string) => Math.max(10, (v / (top[u] || v)) * 100)
  const peak = Object.entries(top).map(([u, v]) => `${formatAmount(v)}${u}`).join(' · ')
  return (
    <section className="card">
      <div className="card-h">
        <span className="ico-round"><Clock size={16} /></span>
        <h2>التغذية والأحمال خلال اليوم</h2>
        <span className="meta">من 7 الصبح لـ 2 بعد نص الليل · ارتفاع الشكل = متوسط الحمل من الصفر{peak && <> · الخط المتقطع = أعلى حمل اليوم <b className="num">{peak}</b></>} · <span className="tl-key-warn">⚠ فازات مش متوازنة</span></span>
      </div>
      <div className="tl" role="img" aria-label="أوقات تغذية المناطق وأحمالها خلال اليوم">
        <div className="tl-row tl-axis" aria-hidden="true">
          <span />
          <div className="tl-ticks">
            {TICKS.map((h, k) => (
              <i key={h} data-odd={k % 2 === 1 || undefined} data-third={k % 3 !== 0 || undefined} style={{ insetInlineStart: `${((h * 60 - START) / SPAN) * 100}%` }}>{tickLabel(h)}</i>
            ))}
          </div>
        </div>
        {sheet.zones.map((z) => (
          <div key={z.id} className="tl-row">
            <div className="tl-label">
              <b>{zoneNames.get(z.zoneId)}</b>
              <small className="num">{z.supplied ? `${formatAmount(z.supplyHours)} ساعة` : 'بدون تغذية'}</small>
            </div>
            <div className="tl-track" data-off={!z.supplied || undefined}>
              {z.supplied && peak && <i className="tl-ref" aria-hidden="true" />}
              {z.supplied &&
                z.runs.flatMap((r, i) => {
                  const avg = readingsAverage(r.loads, r.extra)
                  const h = avg !== null ? height(avg, r.loadUnit) : 0
                  const gap = phaseImbalancePct(r.loads)
                  const warn = gap !== null && gap >= imbalanceWarn
                  const phases = r.loads.map((l, j) => `L${j + 1} ${formatAmount(l)}`).join(' · ')
                  return windowSegments(r).map(([a, b], k) => (
                    <span
                      key={`${r.id}-${k}`}
                      className="tl-run"
                      style={{ insetInlineStart: `${(a / SPAN) * 100}%`, width: `${((b - a) / SPAN) * 100}%` }}
                      title={`التشغيلة ${RUN_NAMES[i]}: ${clock12(r.start)} ← ${clock12(r.end)}${avg !== null ? ` · متوسط الحمل ${formatAmount(avg)} ${r.loadUnit} · ${phases}` : ''}${warn ? ` · الفازات مش متوازنة (فرق ${Math.round(gap!)}%)` : ''}`}
                    >
                      {avg !== null && <span className="tl-load" data-warn={warn || undefined} style={{ height: `${h}%` }}>{k === 0 && <b className="num">{warn && '⚠ '}{formatAmount(avg)}<small>{r.loadUnit}</small></b>}</span>}
                      <span className="tl-seg" />
                    </span>
                  ))
                })}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function RunCell({ run, imbalanceWarn }: { run: ZoneRun | undefined; imbalanceWarn: number }) {
  if (!run || (!run.start && !run.end && run.loads.every((l) => l === null))) return <span className="muted">—</span>
  const gap = phaseImbalancePct(run.loads)
  return (
    <div className="zr">
      <span className="run num">{clock12(run.start) || '—'}<ArrowLeft size={13} aria-label="إلى" />{clock12(run.end) || '—'}</span>
      <span className={`zr-loads num ${gap !== null && gap >= imbalanceWarn ? 'warn' : ''}`}>
        <span className="zr-all">{[...run.loads, ...(run.extra ?? [])].filter((l, i) => i < 3 || l !== null).map((l) => formatAmount(l)).join(' · ')}</span>
        {readingsAverage(run.loads, run.extra) !== null && <span className="zr-avg">المتوسط {formatAmount(readingsAverage(run.loads, run.extra))} <small>{run.loadUnit}</small></span>}
      </span>
    </div>
  )
}

/** The paper's grid: each zone, its hours, and each run with its three phase loads. */
function Matrix({ sheet, zoneNames, imbalanceWarn }: { sheet: DistributionSheet; zoneNames: Map<number, string>; imbalanceWarn: number }) {
  const columns = Math.max(3, ...sheet.zones.map((z) => z.runs.length))
  return (
    <section className="card">
      <div className="card-h"><span className="ico-round"><LayoutGrid size={16} /></span><h2>التشغيلات والأحمال</h2><span className="meta">الأحمال: L1 · L2 · L3</span></div>
      <div className="tw">
        <table className="tbl matrix">
          <thead>
            <tr>
              <th>المنطقة</th>
              <th>عدد الساعات</th>
              {RUN_NAMES.slice(0, columns).map((n) => <th key={n}>التشغيلة {n}</th>)}
            </tr>
          </thead>
          <tbody>
            {sheet.zones.map((z) => (
              <tr key={z.id} data-off={!z.supplied || undefined}>
                <td><b>{zoneNames.get(z.zoneId)}</b></td>
                <td className="n em">{z.supplied ? formatAmount(z.supplyHours) : '0'}</td>
                {!z.supplied ? (
                  <td colSpan={columns} className="muted">لم تُغذَّ في هذا اليوم</td>
                ) : (
                  Array.from({ length: columns }, (_, i) => (
                    <td key={i}><RunCell run={z.runs[i]} imbalanceWarn={imbalanceWarn} /></td>
                  ))
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
