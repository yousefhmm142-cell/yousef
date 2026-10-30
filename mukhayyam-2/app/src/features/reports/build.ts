import { addDays, type ISODate } from '../../lib/dates'
import { dayResult, gazaDate, weekTotals, type Leave, type Punch, type Schedule } from '../attendance/rules'
import type { DistributionSheet, Zone } from '../distribution/model'
import { expectedConsumption, type FuelType, type Generator, type SiteReport } from '../generation/model'
import type { StockItem, StockMove } from '../stock/model'
import type { Task, TaskType } from '../tasks/model'
import type { Employee } from '../../types'

// The weekly / monthly report: one plain structure (sections of rows) that the screen, the Excel
// file and the printout all show the same way. Only figures typed on site and recorded by the
// system are summed here; nothing is invented.

export type Cell = string | number | null
export interface Section {
  key: string
  title: string
  note?: string
  columns: string[]
  rows: Cell[][]
  total?: Cell[]
}

export interface ReportInput {
  from: ISODate
  to: ISODate
  today: ISODate
  nowMin: number
  reports: SiteReport[]
  sheets: DistributionSheet[]
  tasks: Task[]
  punches: Punch[]
  leaves: Leave[]
  holidays: Array<{ date: string; name: string }>
  employees: Employee[]
  schedules: Schedule[]
  generators: Generator[]
  fuelTypes: FuelType[]
  zones: Zone[]
  taskTypes: TaskType[]
  items: StockItem[]
  moves: StockMove[]
}

const sum = (xs: Array<number | null | undefined>) => xs.reduce<number>((a, x) => a + (x ?? 0), 0)
const r1 = (n: number) => Math.round(n * 10) / 10
const inRange = (d: ISODate, a: ReportInput) => d >= a.from && d <= a.to

export function daysOf(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}

export function buildReport(a: ReportInput): Section[] {
  const reports = a.reports.filter((r) => r.status !== 'draft' && inRange(r.reportDate, a)).sort((x, y) => x.reportDate.localeCompare(y.reportDate))
  const sheets = a.sheets.filter((s) => s.status !== 'draft' && inRange(s.sheetDate, a)).sort((x, y) => x.sheetDate.localeCompare(y.sheetDate))
  const genMap = new Map(a.generators.map((g) => [g.id, g]))
  const sections: Section[] = []

  // ---------- Fuel, day by day ----------
  const fuels = a.fuelTypes.filter((f) => reports.some((r) => r.fuel.some((l) => l.fuelTypeId === f.id)))
  const fuelRows = reports.map((r) => {
    const line = (id: number) => r.fuel.find((l) => l.fuelTypeId === id)
    const expected = expectedConsumption(r, genMap)
    return [
      r.reportDate,
      ...fuels.flatMap((f) => [line(f.id)?.receivedQty ?? null, line(f.id)?.consumption ?? null, line(f.id)?.closingBalance ?? null]),
      sum(r.fuel.map((l) => l.consumption)),
      expected,
    ] as Cell[]
  })
  sections.push({
    key: 'fuel',
    title: 'المحروقات',
    note: 'المتوقع = ساعات التشغيل × معدل لتر/ساعة لكل مولد.',
    columns: ['اليوم', ...fuels.flatMap((f) => [`${f.name}: وارد`, `${f.name}: استهلاك`, `${f.name}: متبقي`]), 'مجموع الاستهلاك', 'الاستهلاك المتوقع'],
    rows: fuelRows,
    total: reports.length
      ? [
          'المجموع',
          ...fuels.flatMap((f) => [
            sum(reports.map((r) => r.fuel.find((l) => l.fuelTypeId === f.id)?.receivedQty)),
            sum(reports.map((r) => r.fuel.find((l) => l.fuelTypeId === f.id)?.consumption)),
            reports[reports.length - 1]!.fuel.find((l) => l.fuelTypeId === f.id)?.closingBalance ?? null,
          ]),
          sum(fuelRows.map((row) => row[row.length - 2] as number)),
          sum(fuelRows.map((row) => row[row.length - 1] as number | null)),
        ]
      : undefined,
  })

  // ---------- Generators ----------
  const genRows = a.generators
    .filter((g) => reports.some((r) => r.generators.some((l) => l.generatorId === g.id && l.didRun)))
    .map((g) => {
      const logs = reports.flatMap((r) => r.generators.filter((l) => l.generatorId === g.id && l.didRun))
      const hours = r1(sum(logs.map((l) => l.runHours)))
      const maint = reports.flatMap((r) => r.maintenance.filter((m) => m.generatorId === g.id))
      return [
        g.name,
        g.brand,
        logs.length,
        hours,
        g.litersPerHour ? Math.round(hours * g.litersPerHour) : null,
        maint.length,
        maint.filter((m) => m.types.includes('oil_change')).length,
        r1(sum(maint.map((m) => m.oilNewLiters))),
      ] as Cell[]
    })
  sections.push({
    key: 'generators',
    title: 'المولدات',
    columns: ['المولد', 'الماركة', 'أيام التشغيل', 'ساعات التشغيل', 'الاستهلاك المتوقع', 'الصيانات', 'تغيير زيت', 'زيت جديد (لتر)'],
    rows: genRows,
    total: genRows.length ? ['المجموع', '', null, r1(sum(genRows.map((x) => x[3] as number))), sum(genRows.map((x) => x[4] as number | null)), sum(genRows.map((x) => x[5] as number)), sum(genRows.map((x) => x[6] as number)), r1(sum(genRows.map((x) => x[7] as number)))] : undefined,
  })

  // ---------- Distribution: zones ----------
  const zoneRows = a.zones
    .filter((z) => sheets.some((s) => s.zones.some((e) => e.zoneId === z.id)))
    .map((z) => {
      const entries = sheets.map((s) => s.zones.find((e) => e.zoneId === z.id)).filter((e) => !!e)
      const supplied = entries.filter((e) => e.supplied)
      const runs = supplied.flatMap((e) => e.runs.filter((r) => r.start || r.end))
      const amps = runs.filter((r) => r.loadUnit === 'A').flatMap((r) => r.loads).filter((l): l is number => l !== null)
      const hours = r1(sum(supplied.map((e) => e.supplyHours)))
      return [z.name, supplied.length, entries.length - supplied.length, hours, supplied.length ? r1(hours / supplied.length) : null, runs.length, amps.length ? Math.round(sum(amps) / amps.length) : null] as Cell[]
    })
  sections.push({
    key: 'distribution',
    title: 'التوزيع والأحمال',
    note: 'متوسط الحمل من القراءات بالأمبير فقط.',
    columns: ['المنطقة', 'أيام التغذية', 'أيام بلا تغذية', 'ساعات التغذية', 'متوسط الساعات باليوم', 'التشغيلات', 'متوسط الحمل (A)'],
    rows: zoneRows,
    total: zoneRows.length ? ['المجموع', null, sum(zoneRows.map((x) => x[2] as number)), r1(sum(zoneRows.map((x) => x[3] as number))), null, sum(zoneRows.map((x) => x[5] as number)), null] : undefined,
  })

  // ---------- Tasks: technician × type ----------
  sections.push(taskMatrix(a.tasks.filter((t) => t.status !== 'cancelled' && inRange(gazaDate(t.createdAt), a)), a.employees, a.taskTypes, 'tasks', 'المهام: كل فني حسب نوع المهمة'))

  // ---------- Attendance ----------
  const days = daysOf(a.from, a.to)
  const trackingFrom = a.punches.reduce<ISODate>((min, p) => (gazaDate(p.at) < min ? gazaDate(p.at) : min), a.today)
  const byDay = new Map<string, Punch[]>()
  for (const p of a.punches) {
    const k = `${p.employeeId}|${gazaDate(p.at)}`
    byDay.set(k, [...(byDay.get(k) ?? []), p])
  }
  const attRows = a.employees
    .filter((e) => e.isActive && e.tracksAttendance)
    .map((e) => {
      const s = a.schedules.find((x) => x.id === e.scheduleId) ?? a.schedules[0]
      if (!s) return null
      const results = days.map((date) =>
        dayResult({
          date,
          today: a.today,
          nowMin: a.nowMin,
          punches: byDay.get(`${e.id}|${date}`) ?? [],
          schedule: s,
          holiday: a.holidays.find((h) => h.date === date)?.name,
          leave: a.leaves.find((l) => l.employeeId === e.id && l.from <= date && l.to >= date),
          trackingFrom,
        }),
      )
      const t = weekTotals(results)
      return [e.fullName, s.name, t.present, t.absent, t.leave, t.lateDays, t.lateMin, t.overtimeMin, r1(t.workedMin / 60)] as Cell[]
    })
    .filter((x): x is Cell[] => !!x)
  sections.push({
    key: 'attendance',
    title: 'الحضور والانصراف',
    note: 'التأخير والإضافي بالدقائق.',
    columns: ['الموظف', 'الدوام', 'أيام الحضور', 'الغياب', 'الإجازات', 'أيام التأخير', 'دقائق التأخير', 'دقائق الإضافي', 'ساعات العمل'],
    rows: attRows,
  })

  // ---------- Warehouse ----------
  const stockRows = a.items
    .filter((i) => i.isActive || a.moves.some((m) => m.itemId === i.id))
    .map((i) => {
      const mine = a.moves.filter((m) => m.itemId === i.id)
      const signed = (m: StockMove) => (m.kind === 'in' ? m.qty : -m.qty)
      const before = sum(mine.filter((m) => gazaDate(m.at) < a.from).map(signed))
      const inside = mine.filter((m) => inRange(gazaDate(m.at), a))
      const qIn = sum(inside.filter((m) => m.kind === 'in').map((m) => m.qty))
      const qOut = sum(inside.filter((m) => m.kind === 'out').map((m) => m.qty))
      return [i.name, i.unit, before, qIn, qOut, before + qIn - qOut, i.minQty] as Cell[]
    })
  sections.push({
    key: 'stock',
    title: 'المخزن',
    columns: ['الصنف', 'الوحدة', 'رصيد البداية', 'الوارد', 'الصادر', 'رصيد النهاية', 'الحد الأدنى'],
    rows: stockRows,
  })

  return sections
}

/** Number of tasks per technician and type, with totals: the daily sheet and the report use it. */
export function taskMatrix(tasks: Task[], employees: Employee[], types: TaskType[], key: string, title: string): Section {
  const techs = employees.filter((e) => e.role === 'technician' && (e.isActive || tasks.some((t) => t.assigneeId === e.id)))
  const used = types.filter((ty) => tasks.some((t) => t.typeId === ty.id))
  const count = (emp: string, type: number) => tasks.filter((t) => t.assigneeId === emp && t.typeId === type).length
  const rows = techs.map((e) => [e.fullName, ...used.map((ty) => count(e.id, ty.id) || null), tasks.filter((t) => t.assigneeId === e.id).length] as Cell[])
  return {
    key,
    title,
    columns: ['الفني', ...used.map((t) => t.name), 'المجموع'],
    rows,
    total: ['المجموع', ...used.map((ty) => tasks.filter((t) => t.typeId === ty.id).length), tasks.length],
  }
}
