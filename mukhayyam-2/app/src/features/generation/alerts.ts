import { average, formatAmount } from '../../lib/numbers'
import { loadKva, reportTotals, toBar, type AlertSettings, type Generator, type SiteReport } from './model'

// Alerts only read the figures the site staff typed; they never change them.

export type AlertLevel = 'warn' | 'danger'
export type AlertKind =
  | 'fuel_days'
  | 'consumption'
  | 'balance_mismatch'
  | 'temperature'
  | 'oil_pressure'
  | 'load'
  | 'imbalance'
  | 'oil_change'

export interface Alert {
  id: string
  kind: AlertKind
  level: AlertLevel
  title: string
  detail: string
}

export interface AlertContext {
  /** Reports sent before this one (any status but draft), newest first. */
  history: SiteReport[]
  generators: Map<number, Generator>
  fuelNames: Map<number, string>
  settings: AlertSettings
}

const MIN_DAYS_FOR_AVERAGE = 3
const round = (n: number) => Math.round(n)
const oneDecimal = (n: number) => Math.round(n * 10) / 10

function level(value: number, warn: number, danger: number, higherIsWorse = true): AlertLevel | null {
  if (higherIsWorse) return value >= danger ? 'danger' : value >= warn ? 'warn' : null
  return value < danger ? 'danger' : value < warn ? 'warn' : null
}

/** Today's diesel use against the average of the previous seven reports. */
export function consumptionStats(report: SiteReport, history: SiteReport[]) {
  const today = reportTotals(report).consumption
  const previous = history.slice(0, 7).map((r) => reportTotals(r).consumption).filter((v) => v > 0)
  const avg = previous.length >= MIN_DAYS_FOR_AVERAGE ? average(previous) : null
  const changePct = avg && today > 0 ? ((today - avg) / avg) * 100 : null
  const series = [...history.slice(0, 6).map((r) => reportTotals(r).consumption).reverse(), today]
  return { today, average: avg, changePct, series }
}

/** How many days the remaining diesel lasts at the recent daily rate. */
export function fuelOutlook(report: SiteReport, history: SiteReport[]) {
  const hasFigures = report.fuel.some((f) => f.closingBalance !== null)
  const remaining = reportTotals(report).remaining
  const recent = [report, ...history.slice(0, 6)].map((r) => reportTotals(r).consumption).filter((v) => v > 0)
  const dailyAverage = recent.length ? average(recent) : null
  const days = hasFigures && dailyAverage ? remaining / dailyAverage : null
  return { remaining, dailyAverage, days }
}

/** Running hours since the last recorded oil change, or null if none is on record. */
export function hoursSinceOilChange(generatorId: number, report: SiteReport, history: SiteReport[]): number | null {
  let hours = 0
  for (const r of [report, ...history]) {
    if (r.maintenance.some((m) => m.generatorId === generatorId && m.types.includes('oil_change'))) return hours
    const log = r.generators.find((g) => g.generatorId === generatorId)
    if (log?.didRun) hours += log.runHours ?? 0
  }
  return null
}

export function computeAlerts(report: SiteReport, ctx: AlertContext): Alert[] {
  const { history, generators, fuelNames, settings: s } = ctx
  const alerts: Alert[] = []
  const add = (kind: AlertKind, key: string, lvl: AlertLevel | null, title: string, detail: string) => {
    if (lvl) alerts.push({ id: `${kind}:${key}`, kind, level: lvl, title, detail })
  }

  const outlook = fuelOutlook(report, history)
  if (outlook.days !== null) {
    const days = oneDecimal(outlook.days)
    add('fuel_days', 'all', level(outlook.days, s.fuelDaysWarn, s.fuelDaysDanger, false),
      days < 1 ? 'الوقود لا يكفي يوماً كاملاً' : 'رصيد الوقود منخفض',
      `${formatAmount(outlook.remaining)} لتر تكفي نحو ${days} يوم بالمعدل الحالي`)
  }

  const use = consumptionStats(report, history)
  if (use.changePct !== null && use.average !== null) {
    add('consumption', 'all', level(use.changePct, s.consumptionWarnPct, s.consumptionDangerPct),
      `استهلاك السولار أعلى من المعتاد بـ ${round(use.changePct)}%`,
      `${formatAmount(use.today)} لتر مقابل متوسط ${formatAmount(round(use.average))} لتر في آخر ${Math.min(history.length, 7)} أيام`)
  }

  const previous = history[0]
  if (previous) {
    for (const line of report.fuel) {
      const before = previous.fuel.find((f) => f.fuelTypeId === line.fuelTypeId)?.closingBalance
      if (line.openingBalance === null || before === null || before === undefined) continue
      if (Math.abs(line.openingBalance - before) > 0.5) {
        add('balance_mismatch', String(line.fuelTypeId), 'danger',
          `${fuelNames.get(line.fuelTypeId) ?? 'الوقود'}: الرصيد الموجود لا يطابق متبقي التقرير السابق`,
          `اليوم ${formatAmount(line.openingBalance)} لتر، والمتبقي في التقرير السابق ${formatAmount(before)} لتر`)
      }
    }
  }

  for (const log of report.generators) {
    if (!log.didRun) continue
    const gen = generators.get(log.generatorId)
    const name = gen?.name ?? 'مولد'

    if (log.temperatureC !== null) {
      add('temperature', String(log.generatorId), level(log.temperatureC, s.tempWarnC, s.tempDangerC),
        `${name}: الحرارة مرتفعة`, `${formatAmount(log.temperatureC)}°، والحد ${s.tempWarnC}°`)
    }

    if (log.oilPressure !== null) {
      const bar = toBar(log.oilPressure, log.oilPressureUnit)
      add('oil_pressure', String(log.generatorId), level(bar, s.oilWarnBar, s.oilDangerBar, false),
        `${name}: ضغط الزيت منخفض`,
        `${formatAmount(log.oilPressure)} ${log.oilPressureUnit}، والحد الأدنى المقبول ${s.oilWarnBar} bar`)
    }

    const kva = loadKva(log.loads, log.loadUnit, s.phaseVoltage)
    if (kva !== null && gen?.capacityKva) {
      const loadPct = (kva / gen.capacityKva) * 100
      add('load', String(log.generatorId), level(loadPct, s.loadWarnPct, s.loadDangerPct),
        `${name}: الحمل ${round(loadPct)}% من قدرته`, `نحو ${formatAmount(round(kva))} kVA من ${formatAmount(gen.capacityKva)} kVA`)
    }

    if (log.loads.every((l): l is number => l !== null)) {
      const max = Math.max(...log.loads)
      const min = Math.min(...log.loads)
      if (max > 0) {
        const gap = ((max - min) / max) * 100
        add('imbalance', String(log.generatorId), level(gap, s.imbalanceWarnPct, s.imbalanceDangerPct),
          `${name}: عدم توازن بين الفازات`, `أعلى فاز ${formatAmount(max)} وأقلّه ${formatAmount(min)} (فرق ${round(gap)}%)`)
      }
    }

    const hours = hoursSinceOilChange(log.generatorId, report, history)
    if (hours !== null) {
      add('oil_change', String(log.generatorId), level(hours, s.oilChangeWarnHours, s.oilChangeDueHours),
        hours >= s.oilChangeDueHours ? `${name}: حان تغيير الزيت` : `${name}: اقترب موعد تغيير الزيت`,
        `${formatAmount(round(hours))} ساعة تشغيل منذ آخر تغيير، والموعد كل ${s.oilChangeDueHours} ساعة`)
    }
  }

  return alerts.sort((a, b) => (a.level === b.level ? 0 : a.level === 'danger' ? -1 : 1))
}
