import { useEffect, useState } from 'react'
import { getSupabase } from '../../data/supabase'
import { readClientIssues } from '../../lib/clientErrors'
import { Button } from '../../ui/primitives'
interface Issue {
  id: string
  at: string
  kind: string
  code: string
  route: string
  location: string
  build: string
  who?: string
}
export function ClientIssues() {
  const [rows, setRows] = useState<Issue[]>([]),
    [error, setError] = useState(false),
    [reload, setReload] = useState(0),
    [all, setAll] = useState(false)
  useEffect(() => {
    let live = true
    const sb = getSupabase()
    if (!sb) {
      setRows(readClientIssues())
      return
    }
    void sb.rpc('recent_client_issues').then((r) => {
      if (!live) return
      if (r.error) {
        setError(true)
        setRows(readClientIssues())
      } else {
        setError(false)
        setRows(r.data ?? [])
      }
    })
    return () => {
      live = false
    }
  }, [reload])
  return (
    <section className="card personal-history">
      <div className="card-h">
        <h2>أعطال النظام</h2>
        <Button onClick={() => setReload((n) => n + 1)}>تحديث</Button>
      </div>
      <p className="muted">آخر الأعطال المسجّلة، لمدة 30 يوم. ما بنحفظ نصوص الموظفين أو رموز الدخول.</p>
      {error && <p role="status">تعذّر جلب سجل المكتب. المعروض هو سجل هالجهاز.</p>}
      {!rows.length ? (
        <p className="card-empty">ما في أعطال مسجّلة.</p>
      ) : (
        (all ? rows : rows.slice(0, 5)).map((r) => (
          <article className="personal-task" key={r.id}>
            <b>
              {r.who ?? 'هذا الجهاز'} · {r.code}
            </b>
            <span>{new Date(r.at).toLocaleString('ar-EG-u-nu-latn', { timeZone: 'Asia/Gaza' })}</span>
            <span className="num">
              مرجع {r.id.slice(0, 8)} · {r.route}
            </span>
            <details>
              <summary>تفاصيل الفحص</summary>
              <small className="num ltr">
                {r.location} · {r.build}
              </small>
            </details>
          </article>
        ))
      )}
      {rows.length > 5 && (
        <Button onClick={() => setAll((v) => !v)}>{all ? 'عرض أقل' : `عرض الكل (${rows.length})`}</Button>
      )}
    </section>
  )
}
