import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useEmployee } from '../../auth/AuthProvider'
import { db } from '../../data/db'
import { getSupabase } from '../../data/supabase'
import { isDemo } from '../../config'
import { addDays, todayISO, describeDay } from '../../lib/dates'
import { formatTime } from '../../lib/format'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { punchFromRow, leaveFromRow, type PunchRow, type LeaveRow } from './remote'
import { gazaDate } from './rules'
import { Button } from '../../ui/primitives'

export function MyAttendancePage() {
  const me = useEmployee(),
    [error, setError] = useState(false),
    [busy, setBusy] = useState(false),
    [reload, setReload] = useState(0)
  useDocumentTitle('حضوري')
  const punches = useLiveQuery(() => db.punches.where('employeeId').equals(me.id).toArray(), [me.id])
  const leaves = useLiveQuery(() => db.leaves.where('employeeId').equals(me.id).toArray(), [me.id])
  useEffect(() => {
    let live = true
    const load = async () => {
      if (isDemo) return
      const sb = getSupabase()
      if (!sb || !navigator.onLine) {
        if (live) setError(true)
        return
      }
      setBusy(true)
      try {
        const [p, l] = await Promise.all([
          sb
            .from('attendance_punches')
            .select('id,employee_id,kind,at,method,reason,recorded_by')
            .eq('employee_id', me.id)
            .gte('at', addDays(todayISO(), -30))
            .order('at', { ascending: false }),
          sb
            .from('leaves')
            .select('id,employee_id,from_date,to_date,type,notes')
            .eq('employee_id', me.id)
            .gte('to_date', addDays(todayISO(), -30)),
        ])
        if (p.error || l.error) throw new Error('load')
        if (!live) return
        await db.transaction('rw', db.punches, db.leaves, async () => {
          await db.punches.where('employeeId').equals(me.id).delete()
          await db.punches.bulkPut((p.data as PunchRow[]).map(punchFromRow))
          await db.leaves.where('employeeId').equals(me.id).delete()
          await db.leaves.bulkPut((l.data as LeaveRow[]).map(leaveFromRow))
        })
        setError(false)
      } catch {
        if (live) setError(true)
      } finally {
        if (live) setBusy(false)
      }
    }
    void load()
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, 30000)
    window.addEventListener('online', load)
    return () => {
      live = false
      window.clearInterval(id)
      window.removeEventListener('online', load)
    }
  }, [me.id, reload])
  const days = Array.from({ length: 30 }, (_, i) => addDays(todayISO(), -i))
  return (
    <div className="personal-page">
      <header className="ph">
        <div>
          <h1>حضوري</h1>
          <p className="muted">تسجيل الحضور والانصراف من ورقة QR بالمكتب. افتح كاميرا جوالك وصوّر الرمز.</p>
        </div>
        <Button busy={busy} onClick={() => setReload((n) => n + 1)}>
          تحديث السجل
        </Button>
      </header>
      <section className="card personal-empty">
        <b>التسجيل من ورقة المكتب</b>
        <p>الصفحة هاي لعرض سجلك؛ فتحها أو تحديثها ما بسجّل حضور أو انصراف.</p>
      </section>
      {error && (
        <p className="banner warn" role="status">
          تعذّر التحديث. المعروض هو آخر سجل محفوظ على هالجهاز.
        </p>
      )}
      <section className="card personal-history">
        <h2>آخر 30 يوم</h2>
        {!punches || !leaves ? (
          <p role="status">جاري التحميل…</p>
        ) : (
          days.map((day) => {
            const list = punches.filter((p) => gazaDate(p.at) === day).sort((a, b) => a.at.localeCompare(b.at))
            const enter = list.find((p) => p.kind === 'in'),
              out = list.filter((p) => p.kind === 'out').pop()
            const leave = leaves.find((l) => l.from <= day && l.to >= day)
            return (
              <div className="personal-day" key={day}>
                <b>
                  {describeDay(day).weekday}
                  <small className="num">{day}</small>
                </b>
                <span>{enter ? `حضور ${formatTime(new Date(enter.at))}` : '—'}</span>
                <span>
                  {out
                    ? `انصراف ${formatTime(new Date(out.at))}`
                    : leave
                      ? 'إجازة'
                      : enter
                        ? 'ما تسجّل انصراف'
                        : 'لا تسجيل'}
                </span>
              </div>
            )
          })
        )}
      </section>
    </div>
  )
}
