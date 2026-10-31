import { describeDay } from '../../lib/dates'
import { formatAmount } from '../../lib/numbers'
import { maintenanceLabel, type FuelType, type Generator, type SiteReport } from './model'
import { stamp } from '../sheets/ui'
import { clock12 } from '../../lib/format'

const runHeaders = ['التشغيلة الأولى', 'التشغيلة الثانية', 'التشغيلة الثالثة']

/** The report laid out like the paper form, shown only when printing. */
export function PrintSheet({ report, generators, fuelTypes, names }: {
  report: SiteReport
  generators: Generator[]
  fuelTypes: FuelType[]
  names: Map<string, string>
}) {
  const { weekday, date } = describeDay(report.reportDate)
  const gen = (id: number | null) => generators.find((g) => g.id === id)
  const loads = (l: SiteReport['generators'][number]) =>
    l.loads.every((v) => v === null) ? '' : `${l.loads.map((v) => formatAmount(v)).join(' / ')} ${l.loadUnit}`

  return (
    <div className="print-sheet" aria-hidden="true">
      <header className="ps-head">
        <img src="/logo.webp" alt="" className="ps-logo" />
        <div className="ps-title">
          <b>شركة أبناء فارس أبو زايد</b>
          <span>موقع توليد مخيم 2</span>
        </div>
        <div className="ps-date">
          <div>اليوم / {weekday}</div>
          <div>التاريخ / <span className="num">{date}</span></div>
        </div>
      </header>

      <h2>المحروقات</h2>
      <table>
        <thead>
          <tr><th>نوع الوقود</th><th>الرصيد الموجود</th><th>الكمية الواردة</th><th>المجموع</th><th>الرصيد المتبقي</th><th>الاستهلاك</th><th>رقم الإرسالية</th><th>ملاحظات</th></tr>
        </thead>
        <tbody>
          {report.fuel.map((f) => (
            <tr key={f.id}>
              <td>{fuelTypes.find((t) => t.id === f.fuelTypeId)?.name}</td>
              <td>{formatAmount(f.openingBalance)}</td>
              <td>{formatAmount(f.receivedQty)}</td>
              <td>{formatAmount(f.totalQty)}</td>
              <td>{formatAmount(f.closingBalance)}</td>
              <td>{formatAmount(f.consumption)}</td>
              <td>{f.shipmentNo}</td>
              <td>{f.notes}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>التشغيل والأحمال</h2>
      <table>
        <thead>
          <tr><th>نوع المولد</th>{runHeaders.map((h) => <th key={h}>{h}</th>)}<th>ساعات التشغيل</th><th>الأحمال</th><th>الحرارة</th><th>ضغط الزيت</th></tr>
        </thead>
        <tbody>
          {report.generators.map((l) => (
            <tr key={l.id}>
              <td>{gen(l.generatorId)?.name}</td>
              {runHeaders.map((h, i) => {
                const run = l.didRun ? l.runs[i] : undefined
                return <td key={h} className="num">{run && (run.start || run.end) ? `${clock12(run.start)} / ${clock12(run.end)}` : l.didRun ? '/' : i === 0 ? 'لم يعمل' : ''}</td>
              })}
              <td>{l.didRun ? formatAmount(l.runHours) : ''}</td>
              <td className="num">{l.didRun ? loads(l) : ''}</td>
              <td>{l.didRun && l.temperatureC !== null ? `${formatAmount(l.temperatureC)}°` : ''}</td>
              <td className="num">{l.didRun && l.oilPressure !== null ? `${formatAmount(l.oilPressure)} ${l.oilPressureUnit}` : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>الصيانات</h2>
      <table>
        <thead>
          <tr><th>اسم المولد</th><th>زيت جديد</th><th>زيت محروق</th><th className="wide">نوع الصيانة</th></tr>
        </thead>
        <tbody>
          {(report.maintenance.length ? report.maintenance : [null]).map((m, i) => (
            <tr key={m?.id ?? i}>
              <td>{m ? gen(m.generatorId)?.name : ''}</td>
              <td>{m ? formatAmount(m.oilNewLiters) : ''}</td>
              <td>{m ? formatAmount(m.oilUsedLiters) : ''}</td>
              <td>{m ? [m.types.map(maintenanceLabel).join('، '), m.description].filter(Boolean).join(' · ') : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>الملاحظات</h2>
      <div className="ps-notes">{report.generalNotes}</div>

      <footer className="ps-foot">
        <div>
          <b>توقيع مدير الموقع</b>
          <span>{report.submittedAt ? `أرسله ${names.get(report.submittedBy ?? '') ?? ''} · ${stamp(report.submittedAt)}` : '—'}</span>
        </div>
        <div>
          <b>اعتماد المدير</b>
          <span>{report.approvedAt ? `${names.get(report.approvedBy ?? '') ?? ''} · ${stamp(report.approvedAt)}` : '—'}</span>
        </div>
      </footer>
    </div>
  )
}
