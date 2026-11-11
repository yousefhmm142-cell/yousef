import { useEffect, useMemo, useState } from 'react'
import { useEmployee } from '../../auth/AuthProvider'
import { getSupabase } from '../../data/supabase'
import { db } from '../../data/db'
import { isDemo } from '../../config'
import { useLiveQuery } from 'dexie-react-hooks'
import { getActions } from '../../data/actions'
import { toISODate } from '../../lib/dates'
import type { Task } from './model'
import { taskFromRow } from './repo'
const onDay = (t: Task, day: string) =>
  [t.createdAt, t.completedAt, t.cancelledAt].some((at) => at && toISODate(new Date(at)) === day)
export function useDayTasks(day: string, cached: Task[] | undefined) {
  const refreshVersion = useMemo(
    () =>
      (cached ?? [])
        .map((t) =>
          [
            t.id,
            t.number,
            t.typeId,
            t.status,
            t.assigneeId,
            t.assigneeIds?.join(','),
            t.completedAt,
            t.cancelledAt,
          ].join(':'),
        )
        .join('|'),
    [cached],
  )
  const me = useEmployee(),
    actions = useLiveQuery(getActions, [])
  const [data, setData] = useState<{ day: string; rows: Task[]; complete: boolean }>({
      day: '',
      rows: [],
      complete: false,
    }),
    [busy, setBusy] = useState(true),
    [error, setError] = useState('')
  useEffect(() => {
    let live = true
    const controller = new AbortController(),
      key = `tasks:day:${me.id}:${day}`
    setData({ day, rows: [], complete: false })
    setBusy(true)
    setError('')
    const load = async () => {
      const stored = await db.meta.get(key)
      if (live && stored) setData({ day, rows: stored.value as Task[], complete: true })
      try {
        if (isDemo) {
          if (live) setData({ day, rows: (await db.tasks.toArray()).filter((t) => onDay(t, day)), complete: true })
          return
        }
        const sb = getSupabase()
        if (!sb || !navigator.onLine) throw new Error('offline')
        const rows: Task[] = []
        for (let offset = 0; ; offset += 500) {
          const res = await sb
            .rpc('tasks_for_day', { p_day: day, p_offset: offset, p_limit: 500 })
            .abortSignal(controller.signal)
          if (res.error) throw res.error
          rows.push(...(res.data as Parameters<typeof taskFromRow>[0][]).map(taskFromRow))
          if (res.data.length < 500) break
        }
        if (!live) return
        setData({ day, rows, complete: true })
        setError('')
        await db.meta.put({ key, value: rows })
        const keys = await db.meta.where('key').startsWith(`tasks:day:${me.id}:`).primaryKeys()
        const old = keys
          .filter((k) => k !== key)
          .sort()
          .reverse()
          .slice(6)
        if (old.length) await db.meta.bulkDelete(old)
      } catch {
        if (live) setError('تعذّر تحديث كشف هاليوم. المعروض هو المحفوظ على الجهاز.')
      } finally {
        if (live) setBusy(false)
      }
    }
    void load()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine) void load()
    }, 30000)
    window.addEventListener('online', load)
    return () => {
      live = false
      controller.abort()
      window.clearInterval(timer)
      window.removeEventListener('online', load)
    }
  }, [day, me.id, refreshVersion])
  const pending = useMemo(
    () => new Set((actions ?? []).filter((a) => a.table === 'tasks').map((a) => String(a.row?.id ?? a.rowId))),
    [actions],
  )
  const local = (cached ?? []).filter((t) => onDay(t, day)),
    current = data.day === day
  const rows =
    current && data.complete
      ? [...data.rows.filter((t) => !pending.has(t.id)), ...local.filter((t) => pending.has(t.id))]
      : local
  return { rows, busy, error, ready: current && data.complete }
}
