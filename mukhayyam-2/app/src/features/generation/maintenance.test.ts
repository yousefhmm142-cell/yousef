import { describe, expect, it } from 'vitest'
import { maintenanceSchedule } from './maintenance'
import { defaultAlertSettings, type SiteReport } from './model'

const rep = (reportDate: string, runHours: number, types: string[] = []) =>
  ({
    reportDate,
    status: 'approved',
    generators: [{ generatorId: 1, didRun: runHours > 0, runHours }],
    maintenance: types.length ? [{ generatorId: 1, types }] : [],
  }) as unknown as SiteReport

describe('maintenance schedule', () => {
  it('counts hours and days since each kind was last done', () => {
    const reports = [rep('2026-11-01', 10, ['oil_change', 'oil_filter', 'battery']), rep('2026-11-02', 120), rep('2026-11-03', 120)]
    const s = maintenanceSchedule(1, reports, defaultAlertSettings, '2026-11-11')
    const by = (k: string) => s.find((i) => i.kind === k)!
    expect(by('oil_change').hoursSince).toBe(240)
    expect(by('oil_change').state).toBe('soon') // warn at 230, due at 250
    expect(by('oil_filter').state).toBe('soon') // 240 of 250
    expect(by('battery').daysSince).toBe(10)
    expect(by('battery').state).toBe('ok')
    expect(by('air_filter').state).toBe('unknown')
  })
  it('is due once the hours pass the interval', () => {
    const s = maintenanceSchedule(1, [rep('2026-11-01', 0, ['oil_change']), rep('2026-11-02', 260)], defaultAlertSettings, '2026-11-02')
    expect(s.find((i) => i.kind === 'oil_change')!.state).toBe('due')
  })
})
