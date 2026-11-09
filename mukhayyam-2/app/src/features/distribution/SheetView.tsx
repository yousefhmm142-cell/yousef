import { ArrowLeft, Clock, LayoutGrid, NotebookPen, Sun, TriangleAlert, Zap } from 'lucide-react'
import { formatAmount } from '../../lib/numbers'
import { useAlertSettings, useEmployeeNames } from '../generation/repo'
import { BANDS, bandAverage, bandsDayAverage, hasBandReadings, phaseImbalancePct } from '../sheets/loads'
import { AlertsCard, Signatures } from '../sheets/ui'
import { computeZoneAlerts } from './alerts'
import { RUN_NAMES, runLoad, runSegments, sheetTotals, type DistributionSheet, type ZoneEntry, type ZoneRun } from './model'
import { useZones } from './repo'
import { clock12 } from '../../lib/format'

// The day on the bar runs from 7 in the morning to 2 after midnight, an hour per mark.
const START = 7 * 60
const END = 26 * 60
const SPAN = END - START
const TICKS = Array.from({ length: 20 }, (_, i) => 7 + i)
const tickLabel = (h: number) => { const x = h % 24; return `${x % 12 === 0 ? 12 : x % 12}${x < 12 ? 'ص' : 'م'}` }
/** A smooth line through the points (Catmull-Rom as curves), so the load reads as a wave, not steps. */
function smooth(pts: Array<[number, number]>): string {
  if (pts.length < 2) return ''
  let d = `M${pts[0]![0]},${pts[0]![1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!, p1 = pts[i]!, p2 = pts[i + 1]!, p3 = pts[i + 2] ?? p2
    // Kept between the two points, so the wave never bulges past the run's start or end.
    const lo = Math.min(p1[0], p2[0]), hi = Math.max(p1[0], p2[0]), ylo = Math.min(p1[1], p2[1]), yhi = Math.max(p1[1], p2[1])
    const cx = (v: number) => Math.min(hi, Math.max(lo, v)), cy = (v: number) => Math.min(yhi, Math.max(ylo, v))
    const c1x = cx(p1[0] + (p2[0] - p0[0]) / 6), c1y = cy(p1[1] + (p2[1] - p0[1]) / 6), c2x = cx(p2[0] - (p3[0] - p1[0]) / 6), c2y = cy(p2[1] - (p3[1] - p1[1]) / 6)
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`
  }
  return d
}
const BASE_Y = 50, TOP_Y = 4

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
      <HourlyLoads sheet={sheet} zoneNames={zoneNames} imbalanceWarn={ctx.settings.imbalanceWarnPct} />

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
  for (const z of sheet.zones) for (const r of z.runs) for (const v of runLoad(z, r).samples) top[r.loadUnit] = Math.max(top[r.loadUnit] ?? 0, v)
  const height = (v: number, u: string) => Math.max(10, (v / (top[u] || v)) * 100)
  const peak = Object.entries(top).map(([u, v]) => `${formatAmount(v)}${u}`).join(' · ')
  return (
    <section className="card">
      <div className="card-h">
        <span className="ico-round"><Clock size={16} /></span>
        <h2>التغذية والأحمال خلال اليوم</h2>
        <span className="meta">من 7 الصبح لـ 2 بعد نص الليل · ارتفاع الشكل = متوسط الحمل من الصفر{peak && <> · الخط المتقطع = أعلى حمل اليوم <b className="num">{peak}</b></>} · <span className="tl-key-ok">● حمل طبيعي</span> · <span className="tl-key-warn">● فازات مش متوازنة</span></span>
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
              {z.supplied && (
                <svg className="tl-wave" viewBox={`0 0 ${SPAN} 64`} preserveAspectRatio="none" aria-hidden="true">
                  <defs>
                    <linearGradient id={`g-ok-${z.id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--ok)" stopOpacity=".38" /><stop offset="1" stopColor="var(--ok)" stopOpacity=".04" /></linearGradient>
                    <linearGradient id={`g-warn-${z.id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#E0A800" stopOpacity=".45" /><stop offset="1" stopColor="#E0A800" stopOpacity=".05" /></linearGradient>
                  </defs>
                  {z.runs.flatMap((r) => {
                    const rl = runLoad(z, r)
                    const samples = rl.samples
                    if (!samples.length) return []
                    const gap = rl.gapPct
                    const warn = gap !== null && gap >= imbalanceWarn
                    const y = (v: number) => BASE_Y - (v / (top[r.loadUnit] || v)) * (BASE_Y - TOP_Y)
                    return windowSegments(r).map(([a, b], k) => {
                      // Right to left: the bar reads from 7 in the morning on the right.
                      const X = (t: number) => SPAN - t
                      const ramp = Math.min(25, (b - a) / 5)
                      const inner = samples.length === 1 ? [samples[0]!, samples[0]!] : samples
                      const pts: Array<[number, number]> = [[X(a), BASE_Y], ...inner.map((v, n): [number, number] => [X(a + ramp + ((b - a - 2 * ramp) * n) / (inner.length - 1)), y(v)]), [X(b), BASE_Y]]
                      const line = smooth(pts)
                      return (
                        <g key={`${r.id}-${k}`} className={warn ? 'w-warn' : 'w-ok'}>
                          <path d={`${line} Z`} fill={`url(#g-${warn ? 'warn' : 'ok'}-${z.id})`} />
                          <path d={line} fill="none" vectorEffect="non-scaling-stroke" />
                        </g>
                      )
                    })
                  })}
                </svg>
              )}
              {z.supplied &&
                z.runs.flatMap((r, i) => {
                  const rl = runLoad(z, r)
                  const avg = rl.avg
                  const h = avg !== null ? height(avg, r.loadUnit) : 0
                  const gap = rl.gapPct
                  const warn = gap !== null && gap >= imbalanceWarn
                  const phases = hasBandReadings(z.bands) ? '' : r.loads.map((l, j) => `L${j + 1} ${formatAmount(l)}`).join(' · ')
                  return windowSegments(r).map(([a, b], k) => (
                    <span
                      key={`${r.id}-${k}`}
                      className="tl-run"
                      style={{ insetInlineStart: `${(a / SPAN) * 100}%`, width: `${((b - a) / SPAN) * 100}%` }}
                      title={`التشغيلة ${RUN_NAMES[i]}: ${clock12(r.start)} ← ${clock12(r.end)}${avg !== null ? ` · متوسط الحمل ${formatAmount(avg)} ${r.loadUnit}${phases ? ` · ${phases}` : ''}` : ''}${warn ? ` · الفازات مش متوازنة (فرق ${Math.round(gap!)}%)` : ''}`}
                    >
                      {avg !== null && k === 0 && <b className="tl-val num" data-warn={warn || undefined} style={{ bottom: `${Math.max(16, 16 + (h / 100) * 46 - 20)}px` }}>{warn && '⚠ '}{formatAmount(avg)}<small>{r.loadUnit}</small></b>}
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

function RunCell({ entry, run, imbalanceWarn }: { entry: ZoneEntry; run: ZoneRun | undefined; imbalanceWarn: number }) {
  if (!run || (!run.start && !run.end && run.loads.every((l) => l === null))) return <span className="muted">—</span>
  const gap = phaseImbalancePct(run.loads)
  // With the hourly table the loads are read there; the run keeps its times only.
  const legacy = !hasBandReadings(entry.bands) && run.loads.some((l) => l !== null)
  return (
    <div className="zr">
      <span className="run num">{clock12(run.start) || '—'}<ArrowLeft size={13} aria-label="إلى" />{clock12(run.end) || '—'}</span>
      {legacy && <span className={`zr-loads num ${gap !== null && gap >= imbalanceWarn ? 'warn' : ''}`}>
        <span className="zr-all">{[...run.loads, ...(run.extra ?? [])].filter((l, i) => i < 3 || l !== null).map((l) => formatAmount(l)).join(' · ')}</span>
        {runLoad(entry, run).avg !== null && <span className="zr-avg">المتوسط {formatAmount(runLoad(entry, run).avg)} <small>{run.loadUnit}</small></span>}
      </span>}
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
                    <td key={i}><RunCell entry={z} run={z.runs[i]} imbalanceWarn={imbalanceWarn} /></td>
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

/** The paper's table by hour: every zone, the three readings of each hour and their mean, then the mean of the day. */
function HourlyLoads({ sheet, zoneNames, imbalanceWarn }: { sheet: DistributionSheet; zoneNames: Map<number, string>; imbalanceWarn: number }) {
  const rows = sheet.zones.filter((z) => z.supplied && hasBandReadings(z.bands))
  if (!rows.length) return null
  const all = bandsDayAverage(rows.flatMap((z) => z.bands.map((b) => b).filter((b) => bandAverage(b) !== null)))
  return (
    <section className="card">
      <div className="card-h">
        <span className="ico-round"><LayoutGrid size={16} /></span>
        <h2>الأحمال حسب الساعة</h2>
        <span className="meta">كل خانة: القراءات الثلاثة ثم المتوسط{all !== null && <> · متوسط كل المناطق <b className="num">{formatAmount(all)}</b></>}</span>
      </div>
      <div className="tw">
        <table className="tbl hourly">
          <thead>
            <tr>
              <th>المنطقة</th>
              {BANDS.map((b, i) => <th key={i}><b className="num">{b.label}</b><small className="num" dir="ltr">{b.range}</small></th>)}
              <th>متوسط اليوم</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((z) => {
              const unit = z.runs[0]?.loadUnit ?? 'A'
              return (
                <tr key={z.id}>
                  <td><b>{zoneNames.get(z.zoneId)}</b><small className="muted"> {unit === 'A' ? 'أمبير' : 'كيلوواط'}</small></td>
                  {z.bands.map((b, i) => {
                    const avg = bandAverage(b)
                    const gap = phaseImbalancePct(b)
                    return (
                      <td key={i} className="hr-cell">
                        {b.every((x) => x === null) ? <span className="muted">—</span> : (
                          <>
                            <span className="hr-reads num">{b.map((x) => (x === null ? '—' : formatAmount(x))).join(' · ')}</span>
                            {avg !== null && <b className={`hr-avg num${gap !== null && gap >= imbalanceWarn ? ' warn' : ''}`}>{gap !== null && gap >= imbalanceWarn && '⚠ '}{formatAmount(avg)}</b>}
                          </>
                        )}
                      </td>
                    )
                  })}
                  <td className="n em">{bandsDayAverage(z.bands) === null ? '—' : formatAmount(bandsDayAverage(z.bands))}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
