import { describeDay } from '../../lib/dates'
import { SignFooter } from '../sheets/signers'
import { formatAmount } from '../../lib/numbers'
import { RUN_NAMES, type DistributionSheet, type ZoneEntry } from './model'
import { clock12 } from '../../lib/format'
import { loadAverage } from '../sheets/loads'

const loadsText = (z: ZoneEntry, i: number) => {
  const r = z.runs[i]
  const avg = r ? loadAverage(r.loads) : null
  return r && avg !== null ? `${formatAmount(avg)} ${r.loadUnit}` : ''
}
const timeText = (z: ZoneEntry, i: number) => {
  const r = z.runs[i]
  return r && (r.start || r.end) ? `${clock12(r.start)} / ${clock12(r.end)}` : ''
}

/** The sheet laid out like the paper form (landscape, runs 1–3 then 4–6), shown only when printing. */
export function PrintSheet({ sheet, zoneNames }: { sheet: DistributionSheet; zoneNames: Map<number, string> }) {
  const { weekday, date } = describeDay(sheet.sheetDate)
  const block = (from: number, withHours: boolean) => (
    <table>
      <thead>
        <tr>
          {withHours && <th className="narrow">الساعات</th>}
          <th>المنطقة</th>
          {[from, from + 1, from + 2].map((i) => [
            <th key={`t${i}`}>التشغيلة {RUN_NAMES[i]}</th>,
            <th key={`l${i}`}>الأحمال</th>,
          ])}
        </tr>
      </thead>
      <tbody>
        {sheet.zones.map((z) => (
          <tr key={z.id}>
            {withHours && <td>{z.supplied ? formatAmount(z.supplyHours) : '0'}</td>}
            <td>{zoneNames.get(z.zoneId)}</td>
            {[from, from + 1, from + 2].map((i) => [
              <td key={`t${i}`} className="num">{z.supplied ? timeText(z, i) : withHours && i === from ? 'لم تُغذَّ' : ''}</td>,
              <td key={`l${i}`} className="num">{z.supplied ? loadsText(z, i) : ''}</td>,
            ])}
          </tr>
        ))}
      </tbody>
    </table>
  )

  return (
    <div className="print-sheet landscape" aria-hidden="true">
      <header className="ps-head">
        <img src="/logo.webp" alt="" className="ps-logo" />
        <div className="ps-title">
          <b>كشف متابعة التوزيع والأحمال فرع مخيم (2)</b>
          <span>شركة أبناء فارس أبو زايد</span>
        </div>
        <div className="ps-date">
          <div>اليوم / {weekday}</div>
          <div>التاريخ / <span className="num">{date}</span></div>
        </div>
      </header>
      {block(0, true)}
      <div className="ps-gap" />
      {block(3, false)}
      {sheet.notes && <div className="ps-notes small">{sheet.notes}</div>}
      <SignFooter approval={{ submittedAt: sheet.submittedAt, approvedAt: sheet.approvedAt }} />
    </div>
  )
}
