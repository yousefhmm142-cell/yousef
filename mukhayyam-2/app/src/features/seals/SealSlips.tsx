import { describeDay } from '../../lib/dates'
import { ordinalWord, type SealBatch, type SealData } from './model'

/**
 * The paper slips (the ones she used to fill by hand): the technician, the date, and the seals
 * numbered 1 to 10. Eight to a page, two across; drawn only when printing.
 */
export function SealSlips({ data, batches }: { data: SealData; batches: SealBatch[] }) {
  return (
    <div className="print-sheet seal-slips" aria-hidden="true">
      <div className="slip-grid">
        {batches.map((b) => {
          const seals = data.seals.filter((s) => s.batchId === b.id).sort((a, c) => (a.batchPos ?? 0) - (c.batchPos ?? 0))
          const rows = Math.max(10, seals.length)
          return (
            <table key={b.id} className="slip">
              <thead>
                <tr><th colSpan={3} className="slip-name">الموظف: <b>{data.names.get(b.technicianId) ?? ''}</b> <small>· الدفعة {ordinalWord(b.batchNo)}</small></th></tr>
                <tr><th className="n">الرقم</th><th>التاريخ: <span className="num">{describeDay(b.issuedOn).date}</span></th><th>الختم</th></tr>
              </thead>
              <tbody>
                {Array.from({ length: rows }, (_, i) => (
                  <tr key={i}>
                    <td className="n num">{i + 1}</td>
                    <td />
                    <td className="num seal-no">{seals[i]?.sealNo ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        })}
      </div>
    </div>
  )
}
