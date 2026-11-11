import { CalendarClock } from 'lucide-react'
import { describeDay } from '../../lib/dates'
import { Pill, type Tone } from '../../ui/primitives'
import { everyText, leftText, maintenanceSchedule, type DueState } from './maintenance'
import type { AlertSettings, Generator, SiteReport } from './model'

const TONE: Record<DueState, Tone> = { ok: 'ok', soon: 'warn', due: 'danger', unknown: 'neutral' }
const WORD: Record<DueState, string> = { ok: 'تمام', soon: 'قرّبت', due: 'حان موعدها', unknown: 'ما في سجل' }

/**
 * The maintenance schedule of the generators as of this report: per generator, each kind of maintenance
 * in the plan, when it was last done and what is left. Items with no record yet are listed last.
 */
export function MaintenanceCard({ report, history, generators, settings }: { report: SiteReport; history: SiteReport[]; generators: Generator[]; settings: AlertSettings }) {
  const reports = [report, ...history]
  const gens = generators.filter((g) => g.isActive && reports.some((r) => r.generators.some((l) => l.generatorId === g.id && l.didRun)))
  if (!gens.length) return null
  const rows = gens.map((g) => ({ g, items: maintenanceSchedule(g.id, reports, settings, report.reportDate) }))
  const due = rows.reduce((n, r) => n + r.items.filter((i) => i.state === 'due').length, 0)
  const soon = rows.reduce((n, r) => n + r.items.filter((i) => i.state === 'soon').length, 0)
  const order: DueState[] = ['due', 'soon', 'ok', 'unknown']
  return (
    <section className="card maint-plan">
      <div className="card-h">
        <span className="ico-round"><CalendarClock size={16} /></span>
        <h2>جدول الصيانة</h2>
        <span className="meta">{due ? `${due} حان موعدها` : soon ? `${soon} قرّبت` : 'كله بموعده'}</span>
      </div>
      <div className="mp-grid">
        {rows.map(({ g, items }) => (
          <article key={g.id} className="mp-gen">
            <h3>{g.name}<small className="muted"> {g.brand}</small></h3>
            <ul>
              {items.filter((i) => i.state !== 'unknown').sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state)).map((i) => (
                <li key={i.kind} data-state={i.state}>
                  <div className="mp-top">
                    <b>{i.label}</b>
                    <Pill tone={TONE[i.state]}>{WORD[i.state]}</Pill>
                  </div>
                  {i.share !== null && (
                    <div className="mp-bar" role="img" aria-label={`${Math.round(Math.min(i.share, 1) * 100)}% من المدة`}>
                      <i style={{ width: `${Math.min(100, Math.round(i.share * 100))}%` }} />
                    </div>
                  )}
                  <small className="muted num">
                    {everyText(i.every)}
                    {i.lastDate ? ` · آخر مرة ${describeDay(i.lastDate).date}` : ''}
                    {` · ${leftText(i)}`}
                  </small>
                </li>
              ))}
            </ul>
            {items.some((i) => i.state === 'unknown') && (
              <p className="mp-unknown muted">
                ما في سجل لـ: {items.filter((i) => i.state === 'unknown').map((i) => i.label).join('، ')}. بتبلش تنحسب أول ما تنسجّل بالصيانات.
              </p>
            )}
          </article>
        ))}
      </div>
    </section>
  )
}
