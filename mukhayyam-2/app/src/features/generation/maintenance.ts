import { addDays, type ISODate } from '../../lib/dates'
import { defaultMaintenancePlan, maintenanceLabel, type AlertSettings, type MaintenanceType, type SiteReport } from './model'

// The maintenance schedule: for every generator and every kind of maintenance in the plan, when it was
// last done (from the maintenance lines of the reports), how much has passed since (running hours or
// days), and whether it is due. Oil change uses its own two settings (warn / due hours).

export type DueState = 'ok' | 'soon' | 'due' | 'unknown'

export interface DueItem {
  kind: MaintenanceType
  label: string
  /** The rule: every N hours or every N days. */
  every: { hours?: number; days?: number }
  lastDate: ISODate | null
  hoursSince: number | null
  daysSince: number | null
  state: DueState
  /** How much of the interval has passed (0..1+), for a bar. */
  share: number | null
}

const SOON = 0.9
const daysBetween = (a: ISODate, b: ISODate) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000)

/**
 * @param reports every report on record but drafts (any order); the newest one counts as today.
 */
export function maintenanceSchedule(generatorId: number, reports: SiteReport[], settings: AlertSettings, today: ISODate): DueItem[] {
  const sorted = [...reports].sort((a, b) => b.reportDate.localeCompare(a.reportDate))
  const plan = { oil_change: { hours: settings.oilChangeDueHours }, ...(settings.maintenancePlan ?? defaultMaintenancePlan) }
  const items: DueItem[] = []
  for (const [kind, every] of Object.entries(plan) as Array<[MaintenanceType, { hours?: number; days?: number }]>) {
    if (!every || (!every.hours && !every.days)) continue
    let hours = 0
    let lastDate: ISODate | null = null
    for (const r of sorted) {
      if (r.maintenance.some((m) => m.generatorId === generatorId && m.types.includes(kind))) {
        lastDate = r.reportDate
        break
      }
      const log = r.generators.find((g) => g.generatorId === generatorId)
      if (log?.didRun) hours += log.runHours ?? 0
    }
    const hoursSince = lastDate ? Math.round(hours) : null
    const daysSince = lastDate ? Math.max(0, daysBetween(lastDate, today)) : null
    const shares = [
      every.hours && hoursSince !== null ? hoursSince / every.hours : null,
      every.days && daysSince !== null ? daysSince / every.days : null,
    ].filter((x): x is number => x !== null)
    const share = shares.length ? Math.max(...shares) : null
    const warnShare = kind === 'oil_change' && every.hours ? settings.oilChangeWarnHours / every.hours : SOON
    const state: DueState = share === null ? 'unknown' : share >= 1 ? 'due' : share >= warnShare ? 'soon' : 'ok'
    items.push({ kind, label: maintenanceLabel(kind), every, lastDate, hoursSince, daysSince, state, share })
  }
  return items
}

/** «كل 250 ساعة» / «كل 30 يوم». */
export const everyText = (e: { hours?: number; days?: number }) =>
  [e.hours ? `كل ${e.hours} ساعة` : '', e.days ? `كل ${e.days} يوم` : ''].filter(Boolean).join(' أو ')

/** «باقي 40 ساعة» / «متأخرة 3 أيام». */
export function leftText(i: DueItem): string {
  if (i.state === 'unknown') return 'ما في سجل'
  const parts: string[] = []
  if (i.every.hours && i.hoursSince !== null) {
    const left = i.every.hours - i.hoursSince
    parts.push(left >= 0 ? `باقي ${left} ساعة` : `متأخرة ${-left} ساعة`)
  }
  if (i.every.days && i.daysSince !== null) {
    const left = i.every.days - i.daysSince
    parts.push(left >= 0 ? `باقي ${left} يوم` : `متأخرة ${-left} يوم`)
  }
  return parts.join(' · ')
}

/** The date by which a days-based item is due (for print). */
export const dueBy = (i: DueItem) => (i.lastDate && i.every.days ? addDays(i.lastDate, i.every.days) : null)
