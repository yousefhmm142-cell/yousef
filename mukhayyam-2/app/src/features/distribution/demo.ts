import { db } from '../../data/db'
import { addDays, todayISO } from '../../lib/dates'
import type { Loads } from '../sheets/loads'
import { newId } from '../sheets/workflow'
import { newSheet, type DistributionSheet, type Zone } from './model'

// Demo mode only: the six zones from the paper form and three weeks of believable sheets.

const zones: Zone[] = [
  { id: 1, name: 'المخيم القديم', isActive: true, sortOrder: 1 },
  { id: 2, name: 'المخيم الجديد', isActive: true, sortOrder: 2 },
  { id: 3, name: 'الرازي', isActive: true, sortOrder: 3 },
  { id: 4, name: 'الأبراج', isActive: true, sortOrder: 4 },
  { id: 5, name: 'شوافع القديم', isActive: true, sortOrder: 5 },
  { id: 6, name: 'شوافع الجديد', isActive: true, sortOrder: 6 },
]

/** The usual daily rotation: [start, end] of each run, its hours, and the typical current per phase. */
const rotation: Record<number, { runs: Array<[string, string]>; hours: number; amps: number }> = {
  1: { runs: [['06:00', '09:00'], ['20:00', '23:00']], hours: 6, amps: 120 },
  2: { runs: [['09:00', '12:00'], ['23:00', '02:00']], hours: 6, amps: 105 },
  3: { runs: [['12:00', '15:00'], ['17:00', '20:00']], hours: 6, amps: 130 },
  4: { runs: [['15:00', '18:00'], ['20:00', '01:00']], hours: 8, amps: 150 },
  5: { runs: [['06:00', '10:00'], ['18:00', '21:00']], hours: 7, amps: 95 },
  6: { runs: [['10:00', '14:00'], ['21:00', '00:00']], hours: 7, amps: 110 },
}

const DAYS = 20

function random(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

function buildHistory(today: string, managerId: string, supervisorId: string): DistributionSheet[] {
  const rand = random(7)
  const amps = (base: number): Loads => [0, 1, 2].map(() => Math.round(base * (0.94 + rand() * 0.12))) as Loads
  const sheets: DistributionSheet[] = []
  for (let back = DAYS; back >= 1; back--) {
    const date = addDays(today, -back)
    const yesterday = back === 1
    const s = newSheet(date, zones, supervisorId, null, `${date}T20:00:00Z`)
    s.zones = s.zones.map((entry) => {
      const plan = rotation[entry.zoneId]!
      const runs = plan.runs.map(([start, end], i) => ({
        id: newId(),
        runNo: i + 1,
        start,
        end,
        loadUnit: 'A' as const,
        loads: yesterday && entry.zoneId === 3 && i === 1 ? ([140, 95, 132] as Loads) : amps(plan.amps),
      }))
      return { ...entry, supplyHours: plan.hours, runs }
    })
    if (back === 9) {
      const z6 = s.zones.find((z) => z.zoneId === 6)!
      Object.assign(z6, { supplied: false, supplyHours: 0, runs: [] })
      s.notes = 'شوافع الجديد بدون تغذية بسبب عطل في الكابل الرئيسي.'
    }
    if (yesterday) s.notes = 'تبديل كابل في الرازي بعد التشغيلة الثانية. الأحمال على الفاز الثاني أقل من المعتاد.'
    s.status = yesterday ? 'submitted' : 'approved'
    s.submittedBy = supervisorId
    s.submittedAt = `${date}T21:55:00Z`
    if (!yesterday) {
      s.approvedBy = managerId
      s.approvedAt = `${addDays(date, 1)}T07:20:00Z`
    }
    s.updatedAt = s.approvedAt ?? s.submittedAt
    sheets.push(s)
  }
  return sheets
}

/** Fills the zones and past sheets once. */
export async function ensureDemoDistribution(managerId: string, supervisorId: string): Promise<void> {
  if ((await db.zones.count()) > 0) return
  const history = buildHistory(todayISO(), managerId, supervisorId)
  await db.transaction('rw', db.zones, db.distributionSheets, async () => {
    await db.zones.bulkPut(zones)
    await db.distributionSheets.bulkPut(history)
  })
}
