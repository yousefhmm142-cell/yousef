import { useLiveQuery } from 'dexie-react-hooks'
import { History, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { db } from '../../data/db'
import { useNow } from '../../lib/useNow'
import { durationText, subscriberHistory, taskStatusInfo } from './model'

/**
 * While a task is written: does this subscriber have one open already, or has he called often lately?
 * Only information; saving is never blocked.
 */
export function SubscriberHistoryNote({ name, phone, exceptId }: { name: string; phone: string | null; exceptId?: string }) {
  const now = useNow(60_000)
  const [shown, setShown] = useState(false)
  const data = useLiveQuery(async () => ({ tasks: await db.tasks.toArray(), people: await db.employees.toArray(), types: await db.taskTypes.toArray() }), [])
  if (!data) return null
  const h = subscriberHistory(data.tasks, name, phone, now, exceptId)
  if (!h.open.length && h.lastMonth < 3) return null
  const who = (id: string | null) => data.people.find((p) => p.id === id)?.fullName ?? '—'
  const type = (id: number) => data.types.find((t) => t.id === id)?.name ?? 'مهمة'
  const first = h.open[0]
  const profile = `/subscriber?${new URLSearchParams({ name: name.trim(), ...(phone ? { phone } : {}) })}`
  return (
    <div className="sub-history" role="status">
      {first && (
        <div className="sh-row warn">
          <TriangleAlert size={17} aria-hidden="true" />
          <span>
            له مهمة مفتوحة <b className="num">#{first.number}</b> ({type(first.typeId)}){first.assigneeId ? ` عند ${who(first.assigneeId)}` : ' لسا بدون فني'} من {durationText(Math.max(1, Math.round((now.getTime() - Date.parse(first.createdAt)) / 60_000)))}
            {h.open.length > 1 && <> و{h.open.length - 1} غيرها</>}
          </span>
          <button type="button" className="link-btn" onClick={() => setShown((x) => !x)}>{shown ? 'إخفاء' : 'افتحها'}</button>
        </div>
      )}
      {shown && (
        <ul className="sh-open">
          {h.open.map((t) => (
            <li key={t.id}>
              <b className="num">#{t.number}</b> {type(t.typeId)} · <span className={`sh-st ${taskStatusInfo[t.status].tone}`}>{taskStatusInfo[t.status].label}</span>
              {t.details && <small>{t.details}</small>}
            </li>
          ))}
        </ul>
      )}
      {h.lastMonth >= 3 && (
        <div className="sh-row info">
          <History size={17} aria-hidden="true" />
          <span>مشترك متكرر: <b className="num">{h.lastMonth}</b> مهام بآخر شهر</span>
          <a className="link-btn" href={profile} target="_blank" rel="noreferrer">ملف المشترك</a>
        </div>
      )}
    </div>
  )
}
