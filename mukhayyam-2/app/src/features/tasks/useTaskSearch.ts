import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { isDemo } from '../../config'
import { getActions } from '../../data/actions'
import { getSupabase } from '../../data/supabase'
import type { Employee } from '../../types'
import type { Zone } from '../distribution/model'
import { taskFromRow } from './repo'
import { searchableTask, taskSearchText } from './search'
import type { Task, TaskType } from './model'
export function useTaskSearch(
  query: string,
  cached: Task[] | undefined,
  people: Employee[] | undefined,
  types: TaskType[] | undefined,
  zones: Zone[] | undefined,
) {
  const refreshVersion = useMemo(
    () =>
      (cached ?? [])
        .map((t) =>
          [
            t.id,
            t.number,
            t.status,
            t.assigneeId,
            t.assigneeIds?.join(','),
            t.completedAt,
            t.details,
            t.completionNotes,
          ].join(':'),
        )
        .join('|'),
    [cached],
  )
  const term = taskSearchText(query),
    sequence = useRef(0),
    abort = useRef<AbortController | null>(null)
  const [remote, setRemote] = useState<{ term: string; rows: Task[]; more: boolean; ready: boolean }>({
    term: '',
    rows: [],
    more: false,
    ready: false,
  })
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [localLimit, setLocalLimit] = useState(50)
  const actions = useLiveQuery(getActions, [])
  const names = useMemo(
    () => ({
      people: new Map(people?.map((p) => [p.id, p.fullName])),
      types: new Map(types?.map((t) => [t.id, t.name])),
      zones: new Map(zones?.map((z) => [z.id, z.name])),
    }),
    [people, types, zones],
  )
  const index = useMemo(
    () => (cached ?? []).map((task) => ({ task, text: searchableTask(task, names) })),
    [cached, names],
  )
  const local = useMemo(() => {
    const words = term.split(' ').filter(Boolean)
    return index.filter((r) => words.every((word) => r.text.includes(word))).map((r) => r.task)
  }, [index, term])
  const load = useCallback(
    async (offset: number, version: number) => {
      const sb = getSupabase()
      if (isDemo || !navigator.onLine || !sb) {
        setBusy(false)
        setError(isDemo ? '' : 'بدون إنترنت، البحث بالمهام المحفوظة على هالجهاز.')
        return
      }
      abort.current?.abort()
      const controller = new AbortController()
      abort.current = controller
      setBusy(true)
      setError('')
      try {
        const res = await sb
          .rpc('task_search', { p_term: term, p_offset: offset, p_limit: 51 })
          .abortSignal(controller.signal)
        if (res.error) throw res.error
        if (sequence.current !== version) return
        const rows = (res.data as Parameters<typeof taskFromRow>[0][]).slice(0, 50).map(taskFromRow)
        setRemote((previous) => ({
          term,
          rows: offset && previous.term === term ? [...previous.rows, ...rows] : rows,
          more: res.data.length > 50,
          ready: true,
        }))
      } catch {
        if (!controller.signal.aborted && sequence.current === version)
          setError('تعذّر تحديث البحث. المعروض من المهام المحفوظة على الجهاز.')
      } finally {
        if (sequence.current === version) setBusy(false)
      }
    },
    [term],
  )
  useEffect(() => {
    const version = ++sequence.current
    setLocalLimit(50)
    setRemote({ term, rows: [], more: false, ready: false })
    setError('')
    setBusy(!!term && !isDemo && navigator.onLine)
    if (!term) return
    const retry = () => void load(0, version)
    const timer = window.setTimeout(retry, 250)
    window.addEventListener('online', retry)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('online', retry)
      abort.current?.abort()
    }
  }, [term, load, refreshVersion])
  const ready = remote.term === term && remote.ready
  const pending = new Set((actions ?? []).filter((a) => a.table === 'tasks').map((a) => String(a.row?.id ?? a.rowId)))
  const rows = ready
    ? [...local.filter((t) => pending.has(t.id)), ...remote.rows.filter((t) => !pending.has(t.id))].sort(
        (a, b) => b.number - a.number,
      )
    : local.slice(0, localLimit)
  return {
    rows,
    busy,
    error,
    more: ready ? remote.more : local.length > localLimit,
    loadMore: () => {
      if (ready) void load(remote.rows.length, sequence.current)
      else setLocalLimit((n) => n + 50)
    },
  }
}
