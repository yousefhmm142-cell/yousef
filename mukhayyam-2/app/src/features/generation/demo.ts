import { db } from '../../data/db'
import { addDays, todayISO } from '../../lib/dates'
import {
  defaultAlertSettings,
  newId,
  newReport,
  type FuelType,
  type Generator,
  type GeneratorLog,
  type SiteReport,
} from './model'

// Demo mode only: three weeks of believable reports so averages and alerts have something to work with.

const generators: Generator[] = [
  { id: 1, name: 'المولد 1', brand: 'Perkins', model: '2806A', capacityKva: 500, isActive: true, sortOrder: 1 },
  { id: 2, name: 'المولد 2', brand: 'Cummins', model: 'QSX15', capacityKva: 400, isActive: true, sortOrder: 2 },
  { id: 3, name: 'المولد 3', brand: 'Volvo Penta', model: 'TAD734', capacityKva: 250, isActive: true, sortOrder: 3 },
]

const fuelTypes: FuelType[] = [
  { id: 1, name: 'سولار صناعي', isActive: true, sortOrder: 1 },
  { id: 2, name: 'سولار إسرائيلي', isActive: true, sortOrder: 2 },
]

const shifts: Record<number, { runs: Array<[string, string]>; hours: number; amps: number }> = {
  1: { runs: [['06:00', '14:00'], ['20:00', '01:00']], hours: 13, amps: 400 },
  2: { runs: [['14:00', '20:00'], ['20:00', '01:00']], hours: 11, amps: 340 },
  3: { runs: [['01:00', '08:00']], hours: 7, amps: 178 },
}

const DAYS = 20

/** Small repeatable random numbers, so the demo looks the same every time. */
function random(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

function buildHistory(today: string, managerId: string, operatorId: string): SiteReport[] {
  const rand = random(29)
  const jitter = (base: number, spread: number) => Math.round(base * (1 + (rand() - 0.5) * spread))
  let industrial = 3200
  let israeli = 820
  const reports: SiteReport[] = []

  for (let back = DAYS; back >= 1; back--) {
    const date = addDays(today, -back)
    const yesterday = back === 1
    const total = yesterday ? 1240 : Math.round((960 + rand() * 90) / 10) * 10
    const industrialUse = yesterday ? 1000 : Math.round((total * 0.8) / 10) * 10
    const israeliUse = total - industrialUse
    const industrialIn = industrial - industrialUse < 1600 ? 2000 : 0
    const israeliIn = israeli - israeliUse < 250 ? 500 : 0

    const r = newReport(date, fuelTypes, generators, operatorId, null, `${date}T20:00:00Z`)
    const [ind, isr] = r.fuel as [SiteReport['fuel'][number], SiteReport['fuel'][number]]
    Object.assign(ind, {
      openingBalance: industrial,
      receivedQty: industrialIn || null,
      totalQty: industrial + industrialIn,
      closingBalance: industrial + industrialIn - industrialUse,
      consumption: industrialUse,
      shipmentNo: industrialIn ? String(14000 + (DAYS - back) * 37) : '',
      notes: industrialIn ? 'وصلت 10:15 ص' : '',
    })
    Object.assign(isr, {
      openingBalance: israeli,
      receivedQty: israeliIn || null,
      totalQty: israeli + israeliIn,
      closingBalance: israeli + israeliIn - israeliUse,
      consumption: israeliUse,
      shipmentNo: israeliIn ? String(8800 + (DAYS - back) * 11) : '',
    })
    industrial = ind.closingBalance!
    israeli = isr.closingBalance!

    r.generators = r.generators.map((g): GeneratorLog => {
      const plan = shifts[g.generatorId]!
      const odd = yesterday && g.generatorId === 2
      return {
        ...g,
        runs: plan.runs.map(([start, end], i) => ({ id: newId(), runNo: i + 1, start, end })),
        runHours: plan.hours,
        loads: odd ? [350, 310, 365] : [jitter(plan.amps, 0.08), jitter(plan.amps, 0.08), jitter(plan.amps, 0.08)],
        temperatureC: odd ? 92 : 82 + Math.round(rand() * 7),
        oilPressure: odd ? 1.8 : Math.round((3.6 + rand() * 0.7) * 10) / 10,
      }
    })

    if (back === 19) r.maintenance.push({ id: newId(), generatorId: 1, oilNewLiters: 40, oilUsedLiters: 37, types: ['oil_change', 'oil_filter'], description: '' })
    if (back === 12) r.maintenance.push({ id: newId(), generatorId: 2, oilNewLiters: null, oilUsedLiters: null, types: ['air_filter'], description: 'تنظيف وتبديل فلتر الهواء' })
    if (yesterday) {
      r.maintenance.push({ id: newId(), generatorId: 3, oilNewLiters: 18, oilUsedLiters: 16, types: ['oil_change', 'oil_filter'], description: '' })
      r.generalNotes = 'صوت غير طبيعي في المولد 2 عند رفع الحمل، يحتاج فحصاً من الفني. شحنة السولار الصناعي وصلت الساعة 10:15 صباحاً.'
    }

    r.status = yesterday ? 'submitted' : 'approved'
    r.submittedBy = operatorId
    r.submittedAt = `${date}T21:42:00Z`
    if (!yesterday) {
      r.approvedBy = managerId
      r.approvedAt = `${addDays(date, 1)}T07:15:00Z`
    }
    r.updatedAt = r.approvedAt ?? r.submittedAt
    reports.push(r)
  }
  return reports
}

/** Fills generators, fuel types, thresholds and past reports once. */
export async function ensureDemoGeneration(managerId: string, operatorId: string): Promise<void> {
  if ((await db.generators.count()) > 0) return
  const history = buildHistory(todayISO(), managerId, operatorId)
  await db.transaction('rw', [db.generators, db.fuelTypes, db.alertSettings, db.siteReports], async () => {
    await db.generators.bulkPut(generators)
    await db.fuelTypes.bulkPut(fuelTypes)
    await db.alertSettings.put(defaultAlertSettings)
    await db.siteReports.bulkPut(history)
  })
}
