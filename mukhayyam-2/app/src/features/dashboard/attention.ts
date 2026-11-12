import { addDays, dayName, type ISODate } from '../../lib/dates'
import { formatAmount } from '../../lib/numbers'
import type { DistributionSheet } from '../distribution/model'
import { fuelOutlook } from '../generation/alerts'
import { fuelForecast } from '../generation/forecast'
import { maintenanceSchedule } from '../generation/maintenance'
import type { AlertSettings, Generator, SiteReport } from '../generation/model'
import type { Seal } from '../seals/model'
import { isOpen, isOverdue, type Task } from '../tasks/model'

// «بدها انتباهك» on the manager's home page: everything that waits for him, worked out from what the
// device holds (plus a few figures fetched now and then). Pure, so it is tested without a browser.

export type AttentionTone = 'danger' | 'warn' | 'info'

export interface AttentionLine {
  text: string
  /** Where this one line leads (a day's report, a task…), if anywhere. */
  to?: string
}

export interface Attention {
  key: string
  tone: AttentionTone
  title: string
  detail: string
  /** The page that deals with it. */
  to: string
  /** The page's button text in the dialog. */
  toLabel: string
  /** What the dialog lists. */
  lines: AttentionLine[]
}

export interface AttentionInput {
  now: Date
  today: ISODate
  /** The hour now in Gaza (0–23). */
  gazaHour: number
  reports: SiteReport[]
  sheets: DistributionSheet[]
  tasks: Task[]
  generators: Generator[]
  settings: AlertSettings
  names: Map<string, string>
  /** null: this person does not handle seals (nothing is said about them). */
  seals: Seal[] | null
  /** The open readings week and how many of its areas have nobody; null when unknown. */
  readings: { title: string; unassigned: string[] } | null
  /** The SMS balance, when it was checked (managers only). */
  smsBalance: number | null
  /** Writes the server refused (kept on this device). */
  rejected: Array<{ label: string; code: string }>
  typeName(id: number): string
}

const ORDER: Record<AttentionTone, number> = { danger: 0, warn: 1, info: 2 }
const STALE_SEAL_DAYS = 14
const SMS_LOW = 50
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000)

export function buildAttention(a: AttentionInput): Attention[] {
  const out: Attention[] = []
  const sent = a.reports.filter((r) => r.status !== 'draft').sort((x, y) => y.reportDate.localeCompare(x.reportDate))

  // Waiting for approval.
  const waitingReports = a.reports.filter((r) => r.status === 'submitted').sort((x, y) => x.reportDate.localeCompare(y.reportDate))
  if (waitingReports.length)
    out.push({
      key: 'reports', tone: 'warn', to: '/generation', toLabel: 'صفحة التوليد',
      title: `${waitingReports.length} ${waitingReports.length === 1 ? 'تقرير توليد' : 'تقارير توليد'} بانتظار اعتمادك`,
      detail: waitingReports.map((r) => dayName(r.reportDate)).join('، '),
      lines: waitingReports.map((r) => ({ text: `تقرير ${dayName(r.reportDate)}`, to: `/generation/${r.reportDate}` })),
    })
  const waitingSheets = a.sheets.filter((s) => s.status === 'submitted').sort((x, y) => x.sheetDate.localeCompare(y.sheetDate))
  if (waitingSheets.length)
    out.push({
      key: 'sheets', tone: 'warn', to: '/distribution', toLabel: 'صفحة التوزيع',
      title: `${waitingSheets.length} ${waitingSheets.length === 1 ? 'كشف توزيع' : 'كشوف توزيع'} بانتظار اعتمادك`,
      detail: waitingSheets.map((s) => dayName(s.sheetDate)).join('، '),
      lines: waitingSheets.map((s) => ({ text: `كشف ${dayName(s.sheetDate)}`, to: `/distribution/${s.sheetDate}` })),
    })

  // Yesterday's papers, once the late time has passed.
  const yday = addDays(a.today, -1)
  if (a.gazaHour >= 10) {
    const rep = a.reports.find((r) => r.reportDate === yday)
    if (!rep || rep.status === 'draft' || rep.status === 'returned')
      out.push({
        key: 'late-report', tone: 'danger', to: `/generation/${yday}`, toLabel: 'تقرير أمس',
        title: 'تقرير التوليد لأمس ما وصل', detail: rep ? 'لسا قيد التعبئة' : 'ما انبدأ',
        lines: [{ text: rep ? 'المشغّل بلّش يعبّيه وما بعته.' : 'ما في تقرير لأمس أبداً. تواصل مع موقع التوليد.' }],
      })
    const sh = a.sheets.find((s) => s.sheetDate === yday)
    if (!sh || sh.status === 'draft' || sh.status === 'returned')
      out.push({
        key: 'late-sheet', tone: 'danger', to: `/distribution/${yday}`, toLabel: 'كشف أمس',
        title: 'كشف التوزيع لأمس ما وصل', detail: sh ? 'لسا قيد التعبئة' : 'ما انبدأ',
        lines: [{ text: sh ? 'المشرف بلّش يعبّيه وما بعته.' : 'ما في كشف لأمس أبداً. تواصل مع مشرف التوزيع.' }],
      })
  }

  // Late tasks.
  const open = a.tasks.filter(isOpen)
  const late = open.filter((t) => isOverdue(t, a.now)).sort((x, y) => x.number - y.number)
  if (late.length)
    out.push({
      key: 'late', tone: 'danger', to: '/tasks?view=late', toLabel: 'صفحة المهام',
      title: `${late.length} ${late.length === 1 ? 'مهمة تجاوزت' : 'مهام تجاوزت'} وقتها`, detail: `من ${open.length} مفتوحة`,
      lines: late.slice(0, 12).map((t) => ({ text: `#${t.number} · ${a.typeName(t.typeId)}${t.assigneeId ? ` · ${a.names.get(t.assigneeId) ?? ''}` : ''}${t.subscriberName ? ` · ${t.subscriberName}` : ''}` })),
    })

  // Diesel.
  const last = sent[0]
  if (last) {
    const o = fuelOutlook(last, sent.slice(1))
    if (o.days !== null && o.days < a.settings.fuelDaysWarn)
      out.push({
        key: 'fuel', tone: o.days < a.settings.fuelDaysDanger ? 'danger' : 'warn', to: `/generation/${last.reportDate}`, toLabel: 'آخر تقرير',
        title: 'السولار قرب يخلص', detail: `بيكفي نحو ${formatAmount(Math.floor(o.days * 10) / 10)} يوم`,
        lines: [
          { text: `الباقي ${formatAmount(Math.round(o.remaining))} لتر (تقرير ${dayName(last.reportDate)})` },
          ...(o.dailyAverage ? [{ text: `المعدل اليومي ${formatAmount(Math.round(o.dailyAverage))} لتر` }] : []),
          ...(() => {
            const f = fuelForecast(last, sent.slice(1))
            return f ? [{ text: `بيخلص تقريباً ${dayName(f.runOutDate, a.today)} ${Number(f.runOutDate.slice(8))}/${Number(f.runOutDate.slice(5, 7))} · اطلب قبل ${dayName(f.orderBy, a.today)} ${Number(f.orderBy.slice(8))}/${Number(f.orderBy.slice(5, 7))}${f.rough ? ' (تقدير تقريبي)' : ''}` }] : []
          })(),
        ],
      })
  }

  // Maintenance due.
  if (last) {
    const due: AttentionLine[] = []
    for (const g of a.generators.filter((x) => x.isActive))
      for (const i of maintenanceSchedule(g.id, sent, a.settings, last.reportDate))
        if (i.state === 'due') due.push({ text: `${g.name}: ${i.label}` })
    if (due.length)
      out.push({
        key: 'maintenance', tone: 'warn', to: `/generation/${last.reportDate}`, toLabel: 'جدول الصيانة',
        title: `${due.length} ${due.length === 1 ? 'صيانة حان' : 'صيانات حان'} موعدها`, detail: due.slice(0, 2).map((l) => l.text).join('، '),
        lines: due,
      })
  }

  // Seals out for long and not recorded.
  if (a.seals) {
    const old = a.seals.filter((s) => s.status === 'issued' && s.issuedOn && daysBetween(s.issuedOn, a.today) > STALE_SEAL_DAYS)
    if (old.length) {
      const by = new Map<string, number>()
      for (const s of old) {
        const who = s.technicianId ? a.names.get(s.technicianId) ?? '—' : 'بدون اسم'
        by.set(who, (by.get(who) ?? 0) + 1)
      }
      out.push({
        key: 'seals', tone: 'warn', to: '/seals/unrecorded', toLabel: 'الأختام غير المسجّلة',
        title: `${old.length} ختم عند الفنيين من أكثر من أسبوعين`, detail: 'ما انسجّل استخدامها',
        lines: [...by].sort((x, y) => x[0].localeCompare(y[0], 'ar')).map(([who, n]) => ({ text: `${who}: ${n} ختم` })),
      })
    }
  }

  // The readings week.
  if (a.readings && a.readings.unassigned.length)
    out.push({
      key: 'readings', tone: 'info', to: '/readings', toLabel: 'صفحة القراءات',
      title: `${a.readings.unassigned.length} ${a.readings.unassigned.length === 1 ? 'منطقة' : 'مناطق'} بدون قارئ`, detail: a.readings.title,
      lines: a.readings.unassigned.map((x) => ({ text: x })),
    })

  // SMS balance.
  if (a.smsBalance !== null && a.smsBalance < SMS_LOW)
    out.push({
      key: 'sms', tone: a.smsBalance < 10 ? 'danger' : 'warn', to: '/settings?tab=sms', toLabel: 'الرسائل',
      title: 'رصيد الرسائل قليل', detail: `باقي ${a.smsBalance} رسالة`,
      lines: [{ text: 'اشحن الرصيد من شركة الرسائل عشان ما توقف رسائل المهام والتنبيهات.' }],
    })

  // Writes the server refused.
  if (a.rejected.length)
    out.push({
      key: 'rejected', tone: 'danger', to: '/account', toLabel: 'حسابي',
      title: `${a.rejected.length} ${a.rejected.length === 1 ? 'تعديل ما انقبل' : 'تعديلات ما انقبلت'} على الخادم`, detail: 'محفوظة على هالجهاز للمراجعة',
      lines: a.rejected.slice(0, 12).map((r) => ({ text: r.label })),
    })

  return out.sort((x, y) => ORDER[x.tone] - ORDER[y.tone])
}
