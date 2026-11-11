import { isAssignedTo } from '../tasks/model'
import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { Link } from 'react-router'
import { db } from '../../data/db'
import { todayISO } from '../../lib/dates'
import { Avatar } from '../../ui/primitives'
import { gazaDate } from '../attendance/rules'
import { isOpen } from '../tasks/model'
import { sealWorkAsTasks, useSealWork } from '../tasks/sealWork'
export function TechniciansToday() {
  const today = todayISO()
  const data = useLiveQuery(async () => ({ people: await db.employees.toArray(), tasks: await db.tasks.toArray(), types: await db.taskTypes.toArray() }), [])
  const names = useMemo(() => data ? new Map(data.people.map(p => [p.id,p.fullName])) : undefined, [data])
  const lines = useSealWork(today,today,names)
  if (!data) return null
  const sealed = sealWorkAsTasks(lines,data.types).tasks
  const people = data.people.filter(p => p.role === 'technician' && p.isActive && !p.deletedAt).sort((a,b) => a.fullName.localeCompare(b.fullName,'ar'))
  return <section className="card fx-techs fx-decoration"><header className="card-h"><h2>الفنيين اليوم</h2><span className="meta">كل فني وشغله اليوم</span></header>
    {!people.length ? <p className="card-empty">ما في فنيين فعّالين بعد.</p> : <div className="fx-tech-grid">{people.map(p => {
      const own = data.tasks.filter(t => isAssignedTo(t, p.id))
      const done = own.filter(t => t.status === 'done' && t.completedAt && gazaDate(t.completedAt) === today).length + sealed.filter(t => isAssignedTo(t, p.id)).length
      const open = own.filter(isOpen).length
      const pct = done + open ? done / (done + open) * 100 : 0
      return <Link key={p.id} to="/tasks" className="fx-tech" aria-label={`${p.fullName}، خلص ${done}، معه ${open}`}>
        <span className="fx-tech-avatar"><svg viewBox="0 0 68 68" aria-hidden="true"><circle cx="34" cy="34" r="30" fill="none" stroke="var(--track)" strokeWidth="3" /><circle className="fx-tech-ring" cx="34" cy="34" r="30" fill="none" stroke="var(--ok)" strokeWidth="3" pathLength="100" strokeDasharray={`${pct} 100`} transform="rotate(-90 34 34)" /></svg><Avatar name={p.fullName} size={48} /></span>
        <b>{p.fullName}</b><small>خلص {done} · معه {open}</small>
      </Link>
    })}</div>}
  </section>
}
