import { Activity, ArrowDown, ArrowUp, Minus } from 'lucide-react'
import { formatAmount } from '../../lib/numbers'
import { generatorHealth, type Trend } from './health'
import type { Generator, SiteReport } from './model'

/** How each generator does over the last weeks (burn per hour, temperature, oil pressure). */
export function HealthCard({ report, history, generators }: { report: SiteReport; history: SiteReport[]; generators: Generator[] }) {
  const rows = generatorHealth([report, ...history], generators)
  if (!rows.length) return null
  const worse = rows.filter((r) => r.burn?.trend === 'worse' || r.temp?.trend === 'worse' || r.oil?.trend === 'worse').length
  return (
    <section className="card health-card">
      <div className="card-h">
        <span className="ico-round"><Activity size={16} /></span>
        <h2>صحة المولدات</h2>
        <span className="meta">{worse ? `${worse} بدهم متابعة` : 'آخر أسبوع مقابل اللي قبله'}</span>
      </div>
      <ul className="hc-list">
        {rows.map((r) => (
          <li key={r.generatorId}>
            <b className="hc-name">{r.name}</b>
            <Metric label="الصرف" unit="لتر/ساعة" m={r.burn} upIsBad empty={`ما في أيام كفاية للحكم على الصرف (اشتغل لحاله ${r.burnDaysAlone} ${r.burnDaysAlone === 1 ? 'يوم' : 'أيام'}، بدها 4)`} sentence={r.burn ? (r.burn.trend === 'worse' ? 'صار يصرف أكثر' : r.burn.trend === 'better' ? 'صار يصرف أقل' : 'الصرف ثابت') + (r.burn.rated ? ` · المعدّل المكتوب ${formatAmount(r.burn.rated)}` : '') : ''} />
            <Metric label="الحرارة" unit="°م" m={r.temp} upIsBad empty="ما في قراءات حرارة كفاية" sentence={r.temp ? (r.temp.trend === 'worse' ? 'حرارته طالعة' : r.temp.trend === 'better' ? 'حرارته نازلة' : 'حرارته ثابتة') : ''} />
            <Metric label="ضغط الزيت" unit="bar" m={r.oil} empty="ما في قراءات ضغط كفاية" sentence={r.oil ? (r.oil.trend === 'worse' ? 'ضغط الزيت نازل' : r.oil.trend === 'better' ? 'ضغط الزيت طالع' : 'ضغط الزيت ثابت') : ''} />
          </li>
        ))}
      </ul>
      <p className="hc-note">الصرف من الأيام اللي اشتغل فيها المولد لحاله بس. المقارنة: آخر 7 أيام مقابل الـ7 اللي قبلهم.</p>
    </section>
  )
}

function Metric({ label, unit, m, empty, sentence }: { label: string; unit: string; m: { now: number; before: number; trend: Trend } | null; empty: string; sentence: string; upIsBad?: boolean }) {
  if (!m) return <div className="hc-m off"><small>{label}</small><span>{empty}</span></div>
  const up = m.now > m.before
  const Icon = m.trend === 'same' ? Minus : up ? ArrowUp : ArrowDown
  return (
    <div className="hc-m" data-trend={m.trend}>
      <small>{label}</small>
      <span className="num"><b>{formatAmount(m.now)}</b> <i>{unit}</i> <Icon size={14} aria-hidden="true" /> <i>كان {formatAmount(m.before)}</i></span>
      <span className="hc-s">{sentence}</span>
    </div>
  )
}
