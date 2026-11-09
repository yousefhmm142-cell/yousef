import { describeDay } from '../../lib/dates'
import { SignFooter } from '../sheets/signers'
import { formatAmount } from '../../lib/numbers'
import { RUN_NAMES, type DistributionSheet, type ZoneEntry } from './model'
import { clock12 } from '../../lib/format'
import { BANDS, bandAverage, bandsDayAverage, hasBandReadings, readingsAverage } from '../sheets/loads'

const loadsText = (z: ZoneEntry, i: number) => {
  const r = z.runs[i]
  if (!r || hasBandReadings(z.bands)) return ''
  const all = [...r.loads, ...(r.extra ?? [])].filter((l, k) => k < 3 || l !== null)
  if (all.every((l) => l === null)) return ''
  const avg = readingsAverage(r.loads, r.extra)
  return (
    <>
      <span className="ps-readings">{all.map((l) => formatAmount(l)).join(' · ')}</span>
      {avg !== null && <b className="ps-avg">المتوسط {formatAmount(avg)} {r.loadUnit}</b>}
    </>
  )
}
const timeText = (z: ZoneEntry, i: number) => {
  const r = z.runs[i]
  return r && (r.start || r.end) ? `${clock12(r.start)} / ${clock12(r.end)}` : ''
}

/** The sheet laid out like the paper form (landscape, runs 1–3 then 4–6), shown only when printing. */
export function PrintSheet({ sheet, zoneNames }: { sheet: DistributionSheet; zoneNames: Map<number, string> }) {
  const { weekday, date } = describeDay(sheet.sheetDate)
  // With the hourly table the runs keep their times only; the loads are in the table under them.
  const hourly = sheet.zones.some((z) => z.supplied && hasBandReadings(z.bands))
  const block = (from: number, withHours: boolean) => (
    <table>
      <thead>
        <tr>
          {withHours && <th className="narrow">الساعات</th>}
          <th>المنطقة</th>
          {[from, from + 1, from + 2].map((i) => [
            <th key={`t${i}`}>التشغيلة {RUN_NAMES[i]}</th>,
            !hourly && <th key={`l${i}`}>الأحمال</th>,
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
              !hourly && <td key={`l${i}`} className="num">{z.supplied ? loadsText(z, i) : ''}</td>,
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
      {hourly && (
        <>
          <h2 className="ps-sub">الأحمال حسب الساعة</h2>
          <table className="ps-hr">
            <thead>
              <tr>
                <th className="narrow">المنطقة</th>
                {BANDS.map((b, i) => <th key={i}>{b.label}<small dir="ltr">{b.range}</small></th>)}
                <th className="narrow">متوسط اليوم</th>
              </tr>
            </thead>
            <tbody>
              {sheet.zones.filter((z) => z.supplied).map((z) => (
                <tr key={z.id}>
                  <td>{zoneNames.get(z.zoneId)}<small>{(z.runs[0]?.loadUnit ?? 'A') === 'A' ? 'أمبير' : 'كيلوواط'}</small></td>
                  {z.bands.map((b, i) => (
                    <td key={i} className="num">
                      {b.every((x) => x === null) ? '—' : (
                        <>
                          <span className="ps-readings">{b.map((x) => (x === null ? '—' : formatAmount(x))).join(' / ')}</span>
                          {bandAverage(b) !== null && <b className="ps-avg">{formatAmount(bandAverage(b))}</b>}
                        </>
                      )}
                    </td>
                  ))}
                  <td className="num"><b>{bandsDayAverage(z.bands) === null ? '—' : formatAmount(bandsDayAverage(z.bands))}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {sheet.notes && <div className="ps-notes small">{sheet.notes}</div>}
      <SignFooter approval={{ submittedAt: sheet.submittedAt, approvedAt: sheet.approvedAt }} />
    </div>
  )
}
