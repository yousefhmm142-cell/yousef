import { db } from '../data/db'
import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router'
import { useEmployee } from '../auth/AuthProvider'
import { rejectedWrites, dismissRejected } from '../data/rejected'
import { saveFile } from '../lib/saveFile'
import { useConfirm } from './Confirm'
import { Button } from './primitives'
import { stamp } from '../features/sheets/ui'
import { useToast } from './Toast'
const fields: Record<string, string> = {
  details: 'التفاصيل',
  subscriber_name: 'المشترك',
  subscriber_phone: 'جوال المشترك',
  board_no: 'الطبلون',
  p_details: 'تفاصيل الشغل',
  p_board: 'الطبلون',
  p_numbers: 'أرقام الأختام',
  p_seals: 'أرقام الأختام',
  p_technician: 'الفني',
  p_seal: 'رقم الختم',
  p_text: 'التفاصيل',
  p_from: 'من',
  p_to: 'إلى',
  reading: 'القراءة',
  note: 'الملاحظة',
  p_used_on: 'يوم الاستخدام',
  p_issued_on: 'يوم الصرف',
  completion_notes: 'ملاحظات الإنجاز',
}
export function RejectedWrites() {
  const me = useEmployee(),
    confirm = useConfirm(),
    toast = useToast()
  const [limit, setLimit] = useState(20)
  const people = useLiveQuery(() => db.employees.toArray(), [])
  const rows = useLiveQuery(() => rejectedWrites(me.id), [me.id])
  if (!rows?.length) return null
  return (
    <section className="card rejected-writes">
      <header className="card-h">
        <h2>عمليات بدها مراجعة</h2>
        <span className="meta num">{rows.length}</span>
      </header>
      <div className="backup-body">
        <p>
          هاي العمليات انحفظت على جهازك، بس الخادم ما قبلها. تفاصيلها هون لحد ما تراجعها. ما بتنرسل مرة ثانية من حالها.
        </p>
        <Button
          onClick={() =>
            void saveFile(
              JSON.stringify({ app: 'mukhayyam2', kind: 'rejected-writes', rows }),
              `عمليات-للمراجعة.json`,
              'application/json',
            ).catch(() => toast('تعذّر تنزيل الملف', 'danger'))
          }
        >
          تنزيل نسخة من التفاصيل
        </Button>
        {rows
          .slice()
          .reverse()
          .slice(0, limit)
          .map((row) => {
            const values = (row.payload.row ?? row.payload.args ?? row.payload) as Record<string, unknown>
            const table = String(row.payload.table ?? '')
            const route =
              row.source === 'seals'
                ? '/seals'
                : table === 'reading_rows'
                  ? '/readings'
                  : table === 'attendance_punches' || table === 'leaves'
                    ? '/attendance'
                    : me.role === 'technician'
                      ? '/my-tasks'
                      : '/tasks'
            return (
              <article key={`${row.source}-${row.id}`} className="rejected-write">
                <b>{row.label}</b>
                <small>{stamp(row.at)}</small>
                <p className="muted">البيانات أو الصلاحية تغيّرت. افتح الصفحة وراجع العملية قبل ما تكتبها من جديد.</p>
                <dl>
                  {Object.entries(values)
                    .filter(([k, v]) => fields[k] && v !== null && v !== '')
                    .map(([k, v]) => (
                      <div key={k}>
                        <dt>{fields[k]}</dt>
                        <dd>
                          {k === 'p_technician'
                            ? (people?.find((p) => p.id === v)?.fullName ?? 'فني سابق')
                            : typeof v === 'object'
                              ? JSON.stringify(v)
                              : String(v)}
                        </dd>
                      </div>
                    ))}
                </dl>
                <details>
                  <summary>تفاصيل المتابعة</summary>
                  <span className="num">
                    {row.code} · {row.id}
                  </span>
                </details>
                <div className="task-actions">
                  <Link className="btn" to={route}>
                    افتح الصفحة
                  </Link>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      void (async () => {
                        if (
                          await confirm({
                            title: 'خلصت مراجعة العملية؟',
                            message: 'ستنحذف من سجل هذا الجهاز. نزّل نسخة إذا بدك تحتفظ فيها.',
                            confirmLabel: 'خلصت مراجعتها',
                          })
                        )
                          await dismissRejected(me.id, row.id, row.source)
                      })()
                    }
                  >
                    خلصت مراجعتها
                  </Button>
                </div>
              </article>
            )
          })}
        {rows.length > limit && <Button onClick={() => setLimit((n) => n + 20)}>عرض المزيد</Button>}
      </div>
    </section>
  )
}
