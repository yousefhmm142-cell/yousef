import { useEffect, useMemo, useState } from 'react'
import { Archive, ArrowRight, Printer, RefreshCw } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useEmployee } from '../../auth/AuthProvider'
import { db } from '../../data/db'
import { getSupabase } from '../../data/supabase'
import { isDemo } from '../../config'
import { addDays, todayISO } from '../../lib/dates'
import { Button } from '../../ui/primitives'
import { SignFooter } from '../sheets/signers'
import { buildSealWork, type SealWorkRow } from './sealWork'
import { taskFromRow, useTaskTypes } from './repo'
import type { Task } from './model'
import { buildArchive, filterArchive, type ArchiveLine } from './archive'

export function TaskArchive({ onClose }: { onClose(): void }) {
  const me = useEmployee()
  const people = useLiveQuery(() => db.employees.toArray(), []) ?? []
  const types = useTaskTypes() ?? []
  const [from, setFrom] = useState(addDays(todayISO(), -29))
  const [to, setTo] = useState(todayISO())
  const [tech, setTech] = useState('')
  const [search, setSearch] = useState('')
  const [data, setData] = useState<{ tasks: Parameters<typeof taskFromRow>[0][]; seals: SealWorkRow[] } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const invalid = !from || !to || from > to
  useEffect(() => {
    let live = true
    setData(null)
    setError('')
    if (invalid) return
    const key = `task-archive:${me.id}:${from}:${to}`
    const load = async () => {
      setLoading(true)
      const cached = await db.meta.get(key)
      if (live && cached) setData(cached.value as NonNullable<typeof data>)
      try {
        if (isDemo) {
          if (live) setData({ tasks: [], seals: [] })
          return
        }
        const sb = getSupabase()
        if (!navigator.onLine || !sb) throw new Error('offline')
        const tasks: Parameters<typeof taskFromRow>[0][] = []
        const seals: SealWorkRow[] = []
        // Explicit pagination: archives must not silently stop at the API's row limit.
        for (let offset = 0; ; offset += 500) {
          const r = await sb
            .from('tasks')
            .select('*')
            .eq('status', 'done')
            .gte('completed_at', addDays(from, -1))
            .lt('completed_at', addDays(to, 2))
            .order('completed_at')
            .order('id')
            .range(offset, offset + 499)
          if (r.error) throw r.error
          tasks.push(...(r.data ?? []))
          if ((r.data?.length ?? 0) < 500) break
        }
        for (let offset = 0; ; offset += 500) {
          const r = await sb.rpc('seal_work_statement', { p_from: from, p_to: to }).range(offset, offset + 499)
          if (r.error) throw r.error
          seals.push(...(r.data ?? []))
          if ((r.data?.length ?? 0) < 500) break
        }
        if (!live) return
        const value = { tasks, seals }
        setData(value)
        // Keep just the latest viewed period on this device.
        const old = await db.meta.where('key').startsWith(`task-archive:${me.id}:`).primaryKeys()
        await db.meta.bulkDelete(old.filter((k) => k !== key))
        await db.meta.put({ key, value })
      } catch {
        if (live)
          setError(
            cached
              ? 'تُعرض آخر نسخة محفوظة. تعذّر التحديث، جرّب لما يرجع الإنترنت.'
              : 'تعذّر تحميل السجل. اتصل بالإنترنت وحاول مرة ثانية.',
          )
      } finally {
        if (live) setLoading(false)
      }
    }
    void load()
    return () => {
      live = false
    }
  }, [from, to, me.id, reload, invalid])
  const local = useLiveQuery(() => (isDemo ? db.tasks.toArray() : Promise.resolve([] as Task[])), [])
  const rows = useMemo(
    () =>
      buildArchive(
        isDemo ? (local ?? []) : (data?.tasks ?? []).map(taskFromRow),
        buildSealWork(data?.seals ?? [], new Map(people.map((p) => [p.id, p.fullName]))),
        types,
      ),
    [data, people, types, local],
  )
  const inPeriod = filterArchive(rows, from, to, '', '')
  const techs = people
    .filter((p) => p.role === 'technician' || inPeriod.some((r) => r.techId === p.id))
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ar'))
  const shown = filterArchive(rows, from, to, tech, search)
  const name = people.find((p) => p.id === tech)?.fullName ?? ''
  return (
    <>
      <header className="ph">
        <div>
          <h1>أرشيف الفنيين</h1>
          <p className="muted">كل شغل الفني المنجز، من المهام والأختام، ببحث وكشف مستقل.</p>
        </div>
        <Button variant="secondary" icon={<ArrowRight size={17} />} onClick={onClose}>
          المهام اليومية
        </Button>
      </header>
      <section className="card archive-filters">
        <label>
          من تاريخ
          <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          إلى تاريخ
          <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label>
          الفني
          <select aria-label="الفني" className="select" value={tech} onChange={(e) => setTech(e.target.value)}>
            <option value="">كل الفنيين</option>
            {techs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName}
                {!p.isActive ? ' (غير نشط)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="archive-search">
          بحث بالاسم أو العمل أو المرجع
          <input
            className="input"
            type="search"
            placeholder="اسم المشترك، رقم المهمة أو الختم…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <Button
          variant="secondary"
          icon={<RefreshCw size={16} />}
          busy={loading}
          onClick={() => setReload((n) => n + 1)}
        >
          تحديث
        </Button>
        <Button
          variant="primary"
          icon={<Printer size={17} />}
          disabled={!shown.length || loading || (!data && !isDemo) || invalid}
          onClick={() => window.print()}
        >
          {tech ? 'طباعة سجل الفني' : 'طباعة سجل الكل'}
        </Button>
      </section>
      {invalid && (
        <p className="banner warn" role="alert">
          اختار فترة صحيحة: تاريخ البداية قبل النهاية.
        </p>
      )}
      {error && (
        <p className="banner warn" role="status">
          {error}
        </p>
      )}
      <section className="card archive-results" aria-busy={loading}>
        <div className="card-h">
          <span className="ico-round brand">
            <Archive size={18} />
          </span>
          <h2>{name || 'كل الفنيين'}</h2>
          <span className="meta num">
            {shown.length} عمل · {shown.reduce((n, r) => n + r.seals.length, 0)} ختم
          </span>
        </div>
        {!tech && (
          <p className="card-empty">
            اختار فني لسجله لحاله، أو اترك «كل الفنيين» لطباعة الكل. البحث يشمل اسم المشترك والعمل والمرجع.
          </p>
        )}
        {loading && !data ? (
          <p className="card-empty" role="status">
            جاري تحميل السجل…
          </p>
        ) : (
          <ArchiveTable rows={shown} people={new Map(people.map((p) => [p.id, p.fullName]))} showTech={!tech} />
        )}
      </section>
      {
        <div className="print-sheet landscape archive-print" aria-hidden="true">
          <header className="ps-head">
            <img src="/logo.webp" alt="" className="ps-logo" />
            <div className="ps-title">
              <b>سجل أعمال الفني</b>
              <span>مخيم (2) · {name || 'كل الفنيين'}</span>
            </div>
          </header>
          <p>
            من {from} إلى {to} · {shown.length} عمل{search && ` · البحث: ${search}`}
          </p>
          <ArchiveTable rows={shown} people={new Map(people.map((p) => [p.id, p.fullName]))} showTech={!tech} />
          <SignFooter />
        </div>
      }
    </>
  )
}
function ArchiveTable({
  rows,
  people,
  showTech,
}: {
  rows: ArchiveLine[]
  people: Map<string, string>
  showTech: boolean
}) {
  return rows.length ? (
    <div className="table-wrap">
      <table className="archive-table">
        <thead>
          <tr>
            <th>التاريخ</th>
            {showTech && <th>الفني</th>}
            <th>المرجع</th>
            <th>العمل المنجز</th>
            <th>المشترك</th>
            <th>ملاحظات</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="num">{r.date}</td>
              {showTech && <td>{people.get(r.techId) ?? '—'}</td>}
              <td className="num" title={r.seals.join('، ')}>
                {r.reference}
              </td>
              <td>{r.work}</td>
              <td>{r.subscriber || '—'}</td>
              <td>{r.notes || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <p className="card-empty">لا أعمال منجزة تطابق البحث في هالفترة.</p>
  )
}
