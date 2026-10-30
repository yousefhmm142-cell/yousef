import { formatAmount } from '../../lib/numbers'
import { loadsComplete, phaseImbalancePct } from '../sheets/loads'
import type { AlertLevel } from '../generation/alerts'
import type { AlertSettings } from '../generation/model'
import { RUN_NAMES, type DistributionSheet } from './model'

// Alerts read what the supervisor typed and never change it.

export interface ZoneAlert {
  id: string
  level: AlertLevel
  title: string
  detail: string
}

export function computeZoneAlerts(
  sheet: DistributionSheet,
  zoneNames: Map<number, string>,
  settings: Pick<AlertSettings, 'imbalanceWarnPct' | 'imbalanceDangerPct'>,
): ZoneAlert[] {
  const alerts: ZoneAlert[] = []
  for (const entry of sheet.zones) {
    const zone = zoneNames.get(entry.zoneId) ?? 'منطقة'
    if (!entry.supplied) {
      alerts.push({ id: `unsupplied:${entry.zoneId}`, level: 'warn', title: `${zone}: لم تُغذَّ في هذا اليوم`, detail: 'سجّلها المشرف بدون تشغيلات.' })
      continue
    }
    entry.runs.forEach((run, i) => {
      const gap = phaseImbalancePct(run.loads)
      if (gap === null || !loadsComplete(run.loads) || gap < settings.imbalanceWarnPct) return
      alerts.push({
        id: `imbalance:${entry.zoneId}:${run.runNo}`,
        level: gap >= settings.imbalanceDangerPct ? 'danger' : 'warn',
        title: `${zone}، التشغيلة ${RUN_NAMES[i]}: عدم توازن بين الفازات`,
        detail: `أعلى فاز ${formatAmount(Math.max(...run.loads))} وأقلّه ${formatAmount(Math.min(...run.loads))} (فرق ${Math.round(gap)}%)`,
      })
    })
  }
  return alerts.sort((a, b) => (a.level === b.level ? 0 : a.level === 'danger' ? -1 : 1))
}
