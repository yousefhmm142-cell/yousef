import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, Droplet, Gauge, Info, Plus, Printer, Timer, TrendingUp } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { db } from '../../data/db'
import { addDays, dayName, todayISO, type ISODate } from '../../lib/dates'
import { formatLongDate, formatNumber, formatTime, formatWeekday, greeting } from '../../lib/format'
import { useNow } from '../../lib/useNow'
import { usePresent } from '../../data/presence'
import { CountUp } from '../../ui/fx/CountUp'
import { gazaDate } from '../attendance/rules'
import { isOpen, isOverdue } from '../tasks/model'
import { useAttention } from './activity'
import { fuelOutlook } from '../generation/alerts'
import { fuelForecast } from '../generation/forecast'
import { loadKva, logLoads, reportTotals, toBar, type SiteReport } from '../generation/model'
import { useAlertSettings, useAllReports, useGenerators } from '../generation/repo'

// The new home charts (2026-11 redesign): drawn by hand from the reports already on the device, so they
// work offline and add no chart library. Right-to-left: the oldest day is on the right.

const fmt = (n: number) => formatNumber(Math.round(n))
const short = (d: ISODate) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`

/** Sent reports (no drafts), newest first. */
function useSentReports(): SiteReport[] | undefined {
  const all = useAllReports()
  return useMemo(() => all?.filter((r) => r.status !== 'draft'), [all])
}

function useWidth(): [(el: HTMLDivElement | null) => void, number] {
  // a callback ref: the box appears only once the data is in, so watch it whenever it mounts
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    if (!el) return
    setW(el.clientWidth)
    const ro = new ResizeObserver(() => setW((old) => (Math.abs(old - el.clientWidth) > 1 ? el.clientWidth : old)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return [setEl, w]
}

/** True once, a moment after mounting: lets bars and rings grow in (the CSS skips it for reduced motion). */
function useShown() {
  const [on, setOn] = useState(false)
  useEffect(() => {
    const t = requestAnimationFrame(() => setOn(true))
    return () => cancelAnimationFrame(t)
  }, [])
  return on
}

type Metric = 'fuel' | 'hours'
const RANGES = [7, 30, 90] as const

/** Diesel used (or running hours) day by day, against the period before. */
export function UsageChart() {
  const reports = useSentReports()
  const [metric, setMetric] = useState<Metric>('fuel')
  const [range, setRange] = useState<(typeof RANGES)[number]>(30)
  const [ref, width] = useWidth()
  const [hover, setHover] = useState<number | null>(null)

  const data = useMemo(() => {
    if (!reports) return null
    const byDate = new Map(reports.map((r) => [r.reportDate, reportTotals(r)]))
    const today = todayISO()
    const pick = (d: ISODate) => {
      const t = byDate.get(d)
      return t ? (metric === 'fuel' ? t.consumption : t.runHours) : null
    }
    const days = Array.from({ length: range }, (_, i) => addDays(today, i - range + 1))
    const cur = days.map((d) => ({ date: d, v: pick(d) }))
    const prev = days.map((d) => pick(addDays(d, -range)))
    const sumOf = (xs: Array<number | null>) => xs.reduce<number>((a, b) => a + (b ?? 0), 0)
    const totals = days.reduce(
      (a, d) => {
        const t = byDate.get(d)
        if (!t) return a
        return { used: a.used + t.consumption, received: a.received + t.received, hours: a.hours + t.runHours }
      },
      { used: 0, received: 0, hours: 0 },
    )
    const now = sumOf(cur.map((c) => c.v))
    const before = sumOf(prev)
    return { cur, prev, now, before, totals, any: cur.some((c) => c.v !== null) }
  }, [reports, metric, range])

  if (!data) return <article className="hc-card hc-usage" aria-busy="true" />
  const unit = metric === 'fuel' ? 'لتر' : 'س'
  const change = data.before > 0 && data.now > 0 ? ((data.now - data.before) / data.before) * 100 : null
  const H = 250
  const pad = { t: 10, b: 24 }
  const n = data.cur.length
  const vals = [...data.cur.map((c) => c.v), ...data.prev].filter((v): v is number => v !== null && v > 0)
  const top = vals.length ? Math.max(...vals) * 1.04 : 1
  const bottom = vals.length ? Math.min(...vals) * 0.9 : 0
  const span = Math.max(1, top - bottom)
  const x = (i: number) => (width ? width - (i * width) / Math.max(1, n - 1) : 0)
  const y = (v: number) => pad.t + (H - pad.b - pad.t) * (1 - (v - bottom) / span)
  // a smooth line through the days that have a report (a day without one is skipped, not dropped to zero)
  const curve = (series: Array<number | null>) => {
    const p = series.map((v, i) => (v === null || v <= 0 ? null : ([x(i), y(v)] as const))).filter((q): q is readonly [number, number] => !!q)
    return {
      d: p.map(([px, py], i) => {
        if (!i) return `M${px.toFixed(1)},${py.toFixed(1)}`
        const [x0, y0] = p[i - 1]!
        const m = ((x0 + px) / 2).toFixed(1)
        return `C${m},${y0.toFixed(1)} ${m},${py.toFixed(1)} ${px.toFixed(1)},${py.toFixed(1)}`
      }).join(''),
      first: p[0],
      last: p[p.length - 1],
    }
  }
  const now = curve(data.cur.map((c) => c.v))
  const prev = curve(data.prev)
  const area = now.first && now.last && now.first !== now.last ? `${now.d}L${now.last[0]},${H - pad.b}L${now.first[0]},${H - pad.b}Z` : ''
  const step = Math.ceil(n / 6)
  const h = hover !== null ? data.cur[hover] : null
  const hp = hover !== null ? data.prev[hover] : null
  const diff = h?.v && hp ? Math.round(((h.v - hp) / hp) * 100) : null

  function onMove(e: React.PointerEvent) {
    if (!width) return
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setHover(Math.max(0, Math.min(n - 1, Math.round(((width - (e.clientX - box.left)) / width) * (n - 1)))))
  }

  return (
    <article className="hc-card hc-usage">
      <div className="hc-h">
        <div className="hc-titles">
          <h2>{metric === 'fuel' ? 'استهلاك السولار' : 'ساعات التشغيل'}</h2>
          <small className="num">
            آخر {range} يوم <b>{fmt(data.now)} {unit}</b>
            {change !== null && (
              <span className={`hc-pill ${change > 0 ? 'warn' : 'ok'}`}>{change > 0 ? '↗' : '↘'} {Math.abs(Math.round(change))}% {change > 0 ? 'أكثر' : 'أقل'} من اللي قبلها</span>
            )}
          </small>
        </div>
        <span className="grow" />
        <div className="hc-seg" role="group" aria-label="شو نعرض">
          <button type="button" className={metric === 'fuel' ? 'on' : ''} onClick={() => setMetric('fuel')}>السولار</button>
          <button type="button" className={metric === 'hours' ? 'on' : ''} onClick={() => setMetric('hours')}>ساعات التشغيل</button>
        </div>
        <div className="hc-seg" role="group" aria-label="المدة">
          {RANGES.map((r) => (
            <button key={r} type="button" className={range === r ? 'on' : ''} onClick={() => setRange(r)}>{r === 90 ? '3 شهور' : `${r} ${r === 7 ? 'أيام' : 'يوم'}`}</button>
          ))}
        </div>
      </div>
      <div className="hc-legend-line"><span><i />هالفترة</span><span><i className="d" />الفترة اللي قبلها</span></div>
      <div className="hc-area" ref={ref} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {!data.any ? (
          <p className="hc-empty">ما وصلت تقارير توليد بهالمدة.</p>
        ) : width > 0 && (
          <svg key={`${metric}-${range}`} className="hc-draw" width={width} height={H} role="img" aria-label={`${metric === 'fuel' ? 'استهلاك السولار' : 'ساعات التشغيل'} آخر ${range} يوم: ${fmt(data.now)} ${unit}`}>
            <defs>
              <linearGradient id="hcFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#E5485B" stopOpacity=".42" />
                <stop offset="1" stopColor="#E5485B" stopOpacity="0" />
              </linearGradient>
            </defs>
            {[0, 1, 2, 3].map((g) => {
              const gy = pad.t + ((H - pad.b - pad.t) * g) / 3
              return (
                <g key={g}>
                  <line className="hc-grid" x1={0} x2={width} y1={gy} y2={gy} />
                  <text className="hc-ax num" x={width - 2} y={gy - 4} textAnchor="start">{fmt(top - (span * g) / 3)}</text>
                </g>
              )
            })}
            {Array.from({ length: n }, (_, i) => i).filter((i) => i % step === 0).map((i) => (
              <text key={i} className="hc-ax num" x={Math.min(Math.max(x(i), 18), width - 18)} y={H - 4} textAnchor="middle">{short(data.cur[i]!.date)}</text>
            ))}
            {area && <path className="hc-fill" d={area} fill="url(#hcFill)" />}
            <path className="hc-prev" d={prev.d} />
            <path className="hc-line" d={now.d} />
            {hover !== null && (
              <>
                <line className="hc-cursor" x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} />
                {h?.v ? <circle className="hc-dot" cx={x(hover)} cy={y(h.v)} r={6} /> : null}
              </>
            )}
          </svg>
        )}
        {h && (
          <div className="hc-tip num" style={{ left: Math.min(Math.max(x(hover!), 90), width - 90) }}>
            <b>{dayName(h.date)} {short(h.date)}</b>
            <span className="r"><span>هالفترة</span><span>{h.v ? `${fmt(h.v)} ${unit}` : 'ما في تقرير'}</span></span>
            <span className="r"><span>اللي قبلها</span><span>{hp ? `${fmt(hp)} ${unit}` : '—'}</span></span>
            {diff !== null && <span className="r"><span>الفرق</span><span style={{ color: diff > 0 ? '#ff9a8a' : '#6ee7b7' }}>{diff > 0 ? '+' : ''}{diff}%</span></span>}
          </div>
        )}
      </div>
      <div className="hc-minis">
        <div><small>الاستهلاك</small><b className="num">{fmt(data.totals.used)} لتر</b></div>
        <div><small>الوارد</small><b className="num">{fmt(data.totals.received)} لتر</b></div>
        <div><small>ساعات التشغيل</small><b className="num">{fmt(data.totals.hours)} س</b></div>
        <div><small>لتر لكل ساعة</small><b className="num">{data.totals.hours ? (data.totals.used / data.totals.hours).toFixed(1) : '—'}</b></div>
      </div>
    </article>
  )
}

/** How loaded the generators were in the newest sent report, as a needle. */
export function LoadGauge() {
  const reports = useSentReports()
  const generators = useGenerators()
  const settings = useAlertSettings()
  const shown = useShown()
  const latest = reports?.[0]
  const figures = useMemo(() => {
    if (!latest || !generators) return null
    const gens = new Map(generators.map((g) => [g.id, g]))
    let kva = 0
    let cap = 0
    let peak: { v: number; unit: string } | null = null
    let temp: number | null = null
    let oil: number | null = null
    const ran: string[] = []
    for (const log of latest.generators.filter((g) => g.didRun)) {
      const g = gens.get(log.generatorId)
      if (g) ran.push(g.name)
      const l = logLoads(log)
      if (l) {
        const k = loadKva(l.loads, log.loadUnit, settings.phaseVoltage)
        if (k !== null && g?.capacityKva) { kva += k; cap += g.capacityKva }
        const top = Math.max(...l.loads.map((v) => v ?? 0))
        if (!peak || top > peak.v) peak = { v: top, unit: log.loadUnit }
      }
      if (log.temperatureC !== null) temp = Math.max(temp ?? -Infinity, log.temperatureC)
      if (log.oilPressure !== null) {
        const bar = toBar(log.oilPressure, log.oilPressureUnit)
        oil = oil === null ? bar : Math.min(oil, bar)
      }
    }
    return { pct: cap ? Math.round((kva / cap) * 100) : null, peak, temp, oil, ran }
  }, [latest, generators, settings.phaseVoltage])

  const pct = figures?.pct ?? null
  const tone = pct === null ? 'muted' : pct >= 90 ? 'danger' : pct >= 75 ? 'warn' : 'ok'
  const p = Math.min(100, Math.max(0, pct ?? 0))
  // right to left like the design: 0% on the right, the needle turns left
  const cx = 140
  const cy = 140
  const R = 104
  const len = Math.PI * R
  const half = `M${cx + R},${cy}A${R},${R} 0 0 0 ${cx - R},${cy}`
  const da = Math.PI * 0.9

  return (
    <article className="hc-card hc-gauge">
      <div className="hc-h">
        <div className="hc-titles">
          <h2>حمل المولدات</h2>
          <small>{latest ? `من تقرير ${dayName(latest.reportDate)} ${short(latest.reportDate)}` : 'ما وصل تقرير بعد'}</small>
        </div>
        <span className="grow" />
        {pct !== null && <span className={`hc-pill ${tone}`}>{tone === 'ok' ? 'ضمن الحدود' : tone === 'warn' ? 'قريب من الحد' : 'فوق الحد'}</span>}
      </div>
      <div className="hc-gauge-svg">
        <svg viewBox="0 0 280 160" role="img" aria-label={pct === null ? 'ما في قراءات حمل' : `الحمل ${pct}% من قدرة المولدات الشغالة`}>
          <defs>
            <linearGradient id="hcGauge" x1="1" y1="0" x2="0" y2="0">
              <stop offset="0" stopColor="#8E1B2B" />
              <stop offset=".6" stopColor="#E5485B" />
              <stop offset="1" stopColor="#FFB8C3" />
            </linearGradient>
          </defs>
          {Array.from({ length: 31 }, (_, i) => {
            const a = (Math.PI * i) / 30
            const big = i % 5 === 0
            const r1 = R + 16
            const r2 = R + (big ? 28 : 22)
            return <line key={i} className={`hc-tick${big ? ' big' : ''}`} x1={cx + r1 * Math.cos(a)} y1={cy - r1 * Math.sin(a)} x2={cx + r2 * Math.cos(a)} y2={cy - r2 * Math.sin(a)} />
          })}
          <path className="hc-g-track" d={half} />
          {pct !== null && <path className="hc-g-val" d={half} strokeDasharray={len} strokeDashoffset={shown ? len * (1 - p / 100) : len} />}
          <circle cx={cx + R * Math.cos(da)} cy={cy - R * Math.sin(da)} r={5} className="hc-g-limit"><title>حد الخطر 90%</title></circle>
          {pct !== null && (
            <g className="hc-needle" style={{ transform: `rotate(${shown ? (-180 * p) / 100 : 0}deg)` }}>
              <path d={`M${cx},${cy - 5}L${cx + R - 24},${cy}L${cx},${cy + 5}Z`} />
            </g>
          )}
          <circle cx={cx} cy={cy} r={10} className="hc-g-hub" />
          <circle cx={cx} cy={cy} r={4} className="hc-g-hub2" />
        </svg>
      </div>
      <div className="hc-g-center">
        <b className="num">{pct === null ? '—' : `${pct}%`}</b>
        <small>{figures?.ran.length ? `${figures.ran.join(' و')} ${figures.ran.length > 1 ? 'اشتغلوا' : 'اشتغل'}` : pct === null ? 'ما في قراءات حمل أو قدرة مولد' : ''}</small>
      </div>
      <div className="hc-trio">
        <div><b className="num">{figures?.peak ? `${fmt(figures.peak.v)} ${figures.peak.unit === 'A' ? 'A' : 'kW'}` : '—'}</b><small>أعلى حمل</small></div>
        <div><b className="num">{figures?.temp != null ? `${fmt(figures.temp)}°` : '—'}</b><small>أعلى حرارة</small></div>
        <div><b className="num">{figures?.oil != null ? figures.oil.toFixed(1) : '—'}</b><small>ضغط الزيت (بار)</small></div>
      </div>
    </article>
  )
}

/** The last 14 days of diesel, the highest day marked and the average dashed. */
export function DailyBars() {
  const reports = useSentReports()
  const [ref, width] = useWidth()
  const shown = useShown()
  const [hover, setHover] = useState<number | null>(null)
  const days = useMemo(() => {
    if (!reports) return null
    const byDate = new Map(reports.map((r) => [r.reportDate, reportTotals(r).consumption]))
    const today = todayISO()
    return Array.from({ length: 14 }, (_, i) => {
      const date = addDays(today, i - 13)
      return { date, v: byDate.get(date) ?? null }
    })
  }, [reports])
  if (!days) return <article className="hc-card" aria-busy="true" />
  const vals = days.map((d) => d.v ?? 0)
  const withData = days.filter((d) => d.v)
  const max = Math.max(1, ...vals)
  const avg = withData.length ? withData.reduce((a, d) => a + d.v!, 0) / withData.length : 0
  const top = withData.length ? days.reduce((a, d, i) => ((d.v ?? 0) > (days[a]!.v ?? 0) ? i : a), 0) : -1
  const H = 220
  const base = H - 26
  const n = days.length
  const slot = width / n
  const bw = Math.min(30, slot * 0.56)
  const xc = (i: number) => width - slot * (i + 0.5)
  const y = (v: number) => base - (v / (max * 1.1)) * (base - 14)

  return (
    <article className="hc-card">
      <div className="hc-h">
        <div className="hc-titles"><h2>السولار باليوم</h2><small>آخر 14 يوم · الخط المتقطّع المعدّل</small></div>
        <span className="grow" />
        {top >= 0 && <span className="hc-pill brand num">أعلى يوم {fmt(days[top]!.v!)} لتر</span>}
      </div>
      <div className="hc-bars" ref={ref} onPointerLeave={() => setHover(null)}>
        {!withData.length ? (
          <p className="hc-empty">ما وصلت تقارير بآخر أسبوعين.</p>
        ) : width > 0 && (
          <svg width={width} height={H} role="img" aria-label={`السولار آخر 14 يوم، المعدل ${fmt(avg)} لتر`}>
            <defs>
              <linearGradient id="hcBar" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="var(--brand-hi)" />
                <stop offset="1" stopColor="var(--brand)" stopOpacity=".55" />
              </linearGradient>
            </defs>
            {days.map((d, i) => (
              <g key={d.date} onPointerEnter={() => setHover(i)}>
                <rect x={xc(i) - slot / 2} y={0} width={slot} height={base} fill="transparent" />
                {d.v ? (
                  <rect className={`hc-bar${i === top ? ' top' : ''}`} x={xc(i) - bw / 2} y={y(d.v)} width={bw} height={base - y(d.v)} rx={Math.min(8, bw / 2)} fill={i === top ? 'url(#hcBar)' : undefined} style={{ transform: shown ? 'scaleY(1)' : 'scaleY(0)', transitionDelay: `${i * 30}ms` }} />
                ) : (
                  <rect className="hc-bar-none" x={xc(i) - bw / 2} y={base - 4} width={bw} height={4} rx={2} />
                )}
                {(i % 2 === 0 || n <= 7) && <text className="hc-ax num" x={xc(i)} y={H - 6} textAnchor="middle">{short(d.date)}</text>}
              </g>
            ))}
            {avg > 0 && (
              <>
                <line className="hc-avg" x1={0} x2={width} y1={y(avg)} y2={y(avg)} />
                <text className="hc-avg-t num" x={width - 2} y={y(avg) - 6} textAnchor="start">المعدّل {fmt(avg)}</text>
              </>
            )}
          </svg>
        )}
        {hover !== null && days[hover] && (
          <div className="hc-tip num" style={{ left: Math.min(Math.max(xc(hover), 80), width - 80) }}>
            <b>{dayName(days[hover]!.date)} {short(days[hover]!.date)}</b>
            <span>{days[hover]!.v ? `${fmt(days[hover]!.v!)} لتر` : 'ما في تقرير'}</span>
          </div>
        )}
      </div>
    </article>
  )
}

/** This month's generation reports and distribution sheets: approved, waiting, not in. */
export function MonthRing() {
  const shown = useShown()
  const data = useLiveQuery(async () => {
    const today = todayISO()
    const first = `${today.slice(0, 8)}01`
    const [reports, sheets] = await Promise.all([
      db.siteReports.where('reportDate').between(first, today, true, true).toArray(),
      db.distributionSheets.where('sheetDate').between(first, today, true, true).toArray(),
    ])
    const days = Number(today.slice(8, 10))
    const all = [...reports, ...sheets]
    const approved = all.filter((x) => x.status === 'approved').length
    const waiting = all.filter((x) => x.status === 'submitted').length
    return { expected: days * 2, approved, waiting, missing: Math.max(0, days * 2 - approved - waiting) }
  }, [])
  if (!data) return <article className="hc-card" aria-busy="true" />
  const pct = data.expected ? Math.round((data.approved / data.expected) * 100) : 0
  const C = 2 * Math.PI * 80
  return (
    <article className="hc-card">
      <div className="hc-h"><div className="hc-titles"><h2>تقارير الشهر</h2><small>التوليد والتوزيع</small></div></div>
      <div className="hc-ring">
        <svg viewBox="0 0 200 200" aria-hidden="true">
          <defs>
            <linearGradient id="hcRing" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="var(--brand-hi)" />
              <stop offset="1" stopColor="var(--brand)" />
            </linearGradient>
          </defs>
          <circle className="hc-ring-bg" cx="100" cy="100" r="80" />
          <circle className="hc-ring-fg" cx="100" cy="100" r="80" strokeDasharray={C} strokeDashoffset={shown ? C * (1 - pct / 100) : C} />
        </svg>
        <div className="hc-ring-c"><b className="num">{pct}%</b><small className="num">{data.approved} من {data.expected} معتمدة</small></div>
      </div>
      <div className="hc-legend">
        <div><i className="brand" /><span>معتمدة</span><b className="num">{data.approved}</b></div>
        <Link to="/generation"><i className="warn" /><span>بانتظار اعتمادك</span><b className="num">{data.waiting}</b></Link>
        <div><i className="none" /><span>ما وصلت أو لسا بتتعبّى</span><b className="num">{data.missing}</b></div>
      </div>
    </article>
  )
}

/** The diesel in hand: how long it lasts, by when to order, the last delivery. */
export function FuelCard() {
  const reports = useSentReports()
  const shown = useShown()
  const f = useMemo(() => {
    const latest = reports?.[0]
    if (!latest) return null
    const history = reports!.slice(1)
    const outlook = fuelOutlook(latest, history)
    const forecast = fuelForecast(latest, history)
    const lastIn = reports!.find((r) => reportTotals(r).received > 0)
    const month = todayISO().slice(0, 7)
    const monthIn = reports!.filter((r) => r.reportDate.startsWith(month)).reduce((a, r) => a + reportTotals(r).received, 0)
    return { latest, outlook, forecast, lastIn, monthIn }
  }, [reports])
  if (!reports) return null
  if (!f || f.outlook.days === null) return null
  const days = f.outlook.days
  const tone = days < 3 ? 'danger' : days < 7 ? 'warn' : 'ok'
  const fill = Math.max(4, Math.min(100, (days / 30) * 100))
  const today = todayISO()
  const span = f.forecast ? Math.max(1, (Date.parse(f.forecast.runOutDate) - Date.parse(today)) / 86_400_000) : null
  const orderAt = f.forecast && span ? Math.max(0, Math.min(100, ((Date.parse(f.forecast.orderBy) - Date.parse(today)) / 86_400_000 / span) * 100)) : null
  return (
    <article className="hc-card hc-fuel">
      <div className="hc-tank" aria-hidden="true" data-tone={tone}><i style={{ height: shown ? `${fill}%` : 0 }} /></div>
      <div className="hc-lead">
        <small>السولار · الرصيد المتبقي {f.latest.reportDate !== today && <>({dayName(f.latest.reportDate)})</>}</small>
        <b className="num">{fmt(f.outlook.remaining)}<em>لتر</em></b>
        <span className={`hc-pill ${tone}`}>يكفي نحو {Math.floor(days)} {Math.floor(days) === 1 ? 'يوم' : 'يوم'}</span>
      </div>
      <div className="hc-tl">
        {f.forecast ? (
          <>
            <div className="hc-tl-h num"><span>اليوم <b>{short(today)}</b></span><span>بيخلص تقريباً <b>{dayName(f.forecast.runOutDate)} {short(f.forecast.runOutDate)}</b></span></div>
            <div className="hc-tl-track">
              <div className="hc-tl-fill" style={{ width: shown ? '100%' : 0 }} />
              {orderAt !== null && <div className="hc-tl-mark" style={{ right: `${orderAt}%` }}><span className="num">اطلب قبل {dayName(f.forecast.orderBy)} {short(f.forecast.orderBy)}</span></div>}
            </div>
            {f.forecast.rough && <small className="hc-note">تقدير تقريبي: الأيام المسجّلة قليلة.</small>}
          </>
        ) : (
          <p className="hc-note">ما في استهلاك كفاية لنحسب متى بيخلص.</p>
        )}
      </div>
      <div className="hc-facts">
        <div><span>آخر وارد</span><b className="num">{f.lastIn ? `${fmt(reportTotals(f.lastIn).received)} لتر · ${dayName(f.lastIn.reportDate)} ${short(f.lastIn.reportDate)}` : '—'}</b></div>
        <div><span>المعدّل اليومي</span><b className="num">{f.outlook.dailyAverage ? `${fmt(f.outlook.dailyAverage)} لتر` : '—'}</b></div>
        <div><span>الوارد هالشهر</span><b className="num">{fmt(f.monthIn)} لتر</b></div>
      </div>
    </article>
  )
}

/** A few plain facts worth noticing from the last 30 days. */
export function Insights() {
  const reports = useSentReports()
  const data = useLiveQuery(async () => {
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
    const [all, types] = await Promise.all([db.tasks.toArray(), db.taskTypes.toArray()])
    const tasks = all.filter((t) => t.createdAt > since && t.status !== 'cancelled')
    const byType = new Map<number, number>()
    for (const t of tasks) byType.set(t.typeId, (byType.get(t.typeId) ?? 0) + 1)
    const [topType, topN] = [...byType].sort((a, b) => b[1] - a[1])[0] ?? [null, 0]
    const done = tasks.filter((t) => t.completedAt && t.startedAt)
    const mins = done.map((t) => (Date.parse(t.completedAt!) - Date.parse(t.startedAt!)) / 60_000).filter((m) => m > 0 && m < 24 * 60)
    return {
      total: tasks.length,
      topType: topType === null ? null : (types.find((x) => x.id === topType)?.name ?? null),
      topShare: tasks.length ? Math.round((topN / tasks.length) * 100) : 0,
      avgMinutes: mins.length ? Math.round(mins.reduce((a, b) => a + b, 0) / mins.length) : null,
    }
  }, [])
  const top = useMemo(() => {
    const since = addDays(todayISO(), -30)
    const recent = reports?.filter((r) => r.reportDate >= since) ?? []
    let best: { date: ISODate; v: number } | null = null
    let used = 0
    let hours = 0
    for (const r of recent) {
      const t = reportTotals(r)
      used += t.consumption
      hours += t.runHours
      if (!best || t.consumption > best.v) best = { date: r.reportDate, v: t.consumption }
    }
    return { best: best && best.v > 0 ? best : null, perHour: hours ? used / hours : null }
  }, [reports])
  if (!data) return null
  const items = [
    top.best && { icon: Droplet, tone: 'brand', label: 'أعلى يوم سولار', value: `${fmt(top.best.v)} لتر`, side: `${dayName(top.best.date)} ${short(top.best.date)}` },
    top.perHour && { icon: Gauge, tone: 'amber', label: 'لتر لكل ساعة تشغيل', value: top.perHour.toFixed(1), side: 'آخر 30 يوم' },
    data.topType && { icon: TrendingUp, tone: 'blue', label: 'أكثر نوع مهمة', value: data.topType, side: `${data.topShare}% من ${data.total}` },
    data.avgMinutes !== null && { icon: Timer, tone: 'green', label: 'معدّل وقت إنجاز المهمة', value: `${data.avgMinutes} دقيقة`, side: 'من البدء للإنهاء' },
  ].filter(Boolean) as Array<{ icon: typeof Droplet; tone: string; label: string; value: string; side: string }>
  if (!items.length) return null
  return (
    <section className="hc-card hc-ins" aria-label="شو لافت">
      <div className="hc-h"><div className="hc-titles"><h2>شو لافت</h2><small>من آخر 30 يوم</small></div><span className="grow" /><Link to="/reports" className="hc-more">التقارير <ArrowLeft size={14} aria-hidden="true" /></Link></div>
      <div className="hc-ins-grid">
        {items.map((it) => (
          <div key={it.label} className="hc-ins-i">
            <span className={`hc-ico ${it.tone}`}><it.icon size={17} aria-hidden="true" /></span>
            <span className="hc-ins-t"><small>{it.label}</small><b className="num">{it.value}</b></span>
            <span className="hc-ins-v num">{it.side}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

/** The four boxes under the charts (like the design): what waits, open tasks, attendance, who is online. */
export function KpiBoxes() {
  const present = usePresent()
  const now = useNow(60_000)
  const shown = useShown()
  const data = useLiveQuery(async () => {
    const today = todayISO()
    const yesterday = addDays(today, -1)
    const [people, punches, tasks, reports, sheets] = await Promise.all([
      db.employees.toArray(),
      db.punches.where('at').above(new Date(Date.now() - 60 * 3_600_000).toISOString()).toArray(),
      db.tasks.toArray(),
      db.siteReports.where('status').equals('submitted').toArray(),
      db.distributionSheets.where('status').equals('submitted').toArray(),
    ])
    const tracked = people.filter((e) => e.isActive && e.tracksAttendance)
    const cameIn = (day: ISODate) => new Set(punches.filter((p) => p.kind === 'in' && gazaDate(p.at) === day).map((p) => p.employeeId))
    const inToday = cameIn(today)
    const inYesterday = cameIn(yesterday)
    const done = Array.from({ length: 7 }, (_, i) => {
      const day = addDays(today, i - 6)
      return tasks.filter((t) => t.status === 'done' && t.completedAt && gazaDate(t.completedAt) === day).length
    })
    const waitingDays = [...reports.map((r) => r.reportDate), ...sheets.map((s) => s.sheetDate)].sort()
    return {
      total: tracked.length,
      here: tracked.filter((e) => inToday.has(e.id)).length,
      hereYesterday: tracked.filter((e) => inYesterday.has(e.id)).length,
      open: tasks.filter(isOpen),
      done,
      approvals: reports.length + sheets.length,
      reportsWaiting: reports.length,
      oldestWaiting: waitingDays[0] ?? null,
    }
  }, [])
  if (!data) return <section className="hc-kbs" aria-busy="true" />
  const late = data.open.filter((t) => isOverdue(t, now)).length
  const pct = data.total ? Math.round((data.here / data.total) * 100) : 0
  const vsYesterday = data.here - data.hereYesterday
  const more = (to: string, label: string) => (
    <Link className="hc-kb-more" to={to}>{label}<ArrowLeft size={14} aria-hidden="true" /></Link>
  )
  return (
    <section className={`hc-kbs${shown ? ' go' : ''}`} aria-label="أرقام اليوم">
      <article className="hc-kb dark">
        <div className="hc-kb-lab">بانتظار اعتمادك <Info size={13} aria-hidden="true" /></div>
        <div className="hc-kb-v num"><CountUp value={data.approvals} /></div>
        <div className="hc-kb-d">{data.approvals ? <span className="hc-pill warn">من {dayName(data.oldestWaiting!)}</span> : <span className="hc-pill ok">ما في اشي ينتظر</span>}</div>
        <svg className="hc-kb-pic" viewBox="0 0 96 64" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => {
            const lit = i < Math.min(4, data.approvals)
            const h = lit ? 52 : 30
            return <rect key={i} className={`hc-kb-bar${lit ? ' lit' : ''}`} x={96 - 4 * 16 - 3 * 8 + i * 24} y={60 - h} width={16} height={h} rx={8} style={{ transitionDelay: `${i * 90}ms` }} />
          })}
        </svg>
        {more(data.reportsWaiting ? '/generation' : '/distribution', data.approvals ? 'افتحها' : 'التوليد')}
      </article>
      <article className="hc-kb">
        <div className="hc-kb-lab">مهام مفتوحة <Info size={13} aria-hidden="true" /></div>
        <div className="hc-kb-v num"><CountUp value={data.open.length} /></div>
        <div className="hc-kb-d">{late ? <span className="hc-pill danger">{late} متأخرة</span> : <span className="hc-pill ok">ما في تأخير</span>}<span className="num">خلص {data.done[6]}</span></div>
        <KbLine values={data.done} />
        {more('/tasks', 'شوف المهام')}
      </article>
      <article className="hc-kb">
        <div className="hc-kb-lab">حضور اليوم <Info size={13} aria-hidden="true" /></div>
        <div className="hc-kb-v num"><CountUp value={data.here} /><small>من {data.total}</small></div>
        <div className="hc-kb-d">{vsYesterday === 0 ? <span className="hc-pill">زي أمس</span> : <span className={`hc-pill ${vsYesterday > 0 ? 'ok' : 'warn'}`}>{vsYesterday > 0 ? '↑' : '↓'} {Math.abs(vsYesterday)} عن أمس</span>}</div>
        <svg className="hc-kb-pic" viewBox="0 0 96 64" aria-hidden="true">
          <circle cx="48" cy="32" r="24" className="hc-kb-ring-bg" />
          <circle cx="48" cy="32" r="24" className="hc-kb-ring" strokeDasharray={2 * Math.PI * 24} strokeDashoffset={2 * Math.PI * 24 * (1 - (shown ? pct : 0) / 100)} transform="rotate(-90 48 32)" />
          <text x="48" y="37" textAnchor="middle" className="hc-kb-ring-t num">{pct}%</text>
        </svg>
        {more('/attendance', 'شوف الحضور')}
      </article>
      <article className="hc-kb">
        <div className="hc-kb-lab">متصلون الآن <Info size={13} aria-hidden="true" /></div>
        <div className="hc-kb-v num"><CountUp value={present.length} /></div>
        <div className="hc-kb-d"><span className="hc-pill ok">على الموقع هلأ</span></div>
        <svg className="hc-kb-pic" viewBox="0 0 96 64" aria-hidden="true">
          {Array.from({ length: 5 }, (_, i) => <circle key={i} className={`hc-kb-dot${i < Math.min(5, present.length) ? ' lit' : ''}`} cx={88 - i * 19} cy={32} r={7} style={{ transitionDelay: `${i * 70}ms` }} />)}
        </svg>
        <a className="hc-kb-more" href="#presence">مين متصل<ArrowLeft size={14} aria-hidden="true" /></a>
      </article>
    </section>
  )
}

function KbLine({ values }: { values: number[] }) {
  const mx = Math.max(...values)
  const mn = Math.min(...values)
  // oldest on the right, today on the left
  const X = (i: number) => 96 - (i * 96) / (values.length - 1)
  const Y = (v: number) => 54 - ((v - mn) / (mx - mn || 1)) * 44
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('')
  const lx = X(values.length - 1)
  const ly = Y(values[values.length - 1]!)
  return (
    <svg className="hc-kb-pic" viewBox="0 0 96 64" aria-hidden="true">
      <path d={`${d}L${lx},64L96,64Z`} className="hc-kb-area" />
      <path d={d} className="hc-kb-line" />
      <circle cx={lx} cy={ly} r={4} className="hc-kb-line-dot" />
    </svg>
  )
}

/** The top of the home page, like the design: a live line, the greeting, and the two everyday buttons. */
export function HomeHeader({ name }: { name: string }) {
  const now = useNow()
  const attention = useAttention(now) ?? []
  const counts = useLiveQuery(async () => {
    const today = todayISO()
    const [tasks, reports, sheets] = await Promise.all([
      db.tasks.where('status').equals('done').toArray(),
      db.siteReports.where('status').equals('submitted').count(),
      db.distributionSheets.where('status').equals('submitted').count(),
    ])
    return { doneToday: tasks.filter((t) => t.completedAt && gazaDate(t.completedAt) === today).length, waiting: reports + sheets }
  }, [])
  return (
    <header className="hc-head">
      <div className="hc-head-t">
        <span className="hc-live num">مباشر · {counts?.doneToday ?? 0} مهمة خلصت اليوم · {counts?.waiting ?? 0} بانتظار اعتمادك</span>
        <h1>{greeting(now)}، {name}</h1>
        <p className="num">
          {formatWeekday(now)} {formatLongDate(now)} · {formatTime(now)}
          {attention.length > 0 && <> · <a href="#today-attention">{attention.length === 1 ? 'شغلة وحدة بدها انتباهك' : `${attention.length} أشياء بدها انتباهك`}</a></>}
        </p>
      </div>
      <span className="grow" />
      <div className="hc-head-b">
        <Link className="hc-btn desk-only" to="/tasks?print=1"><Printer size={17} aria-hidden="true" />طباعة كشف اليوم</Link>
        <Link className="hc-btn primary" to="/tasks?new=1"><Plus size={17} aria-hidden="true" />مهمة جديدة</Link>
      </div>
    </header>
  )
}
