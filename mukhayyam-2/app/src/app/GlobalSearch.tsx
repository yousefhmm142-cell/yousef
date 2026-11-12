import { useLiveQuery } from 'dexie-react-hooks'
import { CornerDownLeft, FileText, Hash, Search, Stamp, UserRound, Users, WifiOff, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useEmployee } from '../auth/AuthProvider'
import { isDemo } from '../config'
import { db } from '../data/db'
import { getSupabase } from '../data/supabase'
import { useOnline } from '../lib/useOnline'
import { taskFromRow } from '../features/tasks/repo'
import { useSubscribers } from '../features/tasks/subscribers'
import type { Task } from '../features/tasks/model'
import { hasPage, isManagerRole } from '../types'
import { navFor } from './nav'
import { GROUPS, searchAll, type Hit } from './searchAll'

const ICON = { pages: FileText, tasks: Hash, subscribers: UserRound, seals: Stamp, people: Users } as const

/** Opens the search window from anywhere (a button, the «…» menu). */
export const openSearch = () => window.dispatchEvent(new Event('m2:search'))

/** The round search button (it only asks the window to open). */
export function SearchButton({ className }: { className?: string }) {
  return (
    <button type="button" className={`search-btn${className ? ` ${className}` : ''}`} onClick={openSearch} aria-label="بحث (Ctrl+K)" title="بحث (Ctrl+K)">
      <Search size={20} aria-hidden="true" />
    </button>
  )
}

/** The search window, mounted once in the shell: Ctrl+K, «/» outside a text box, or openSearch(). */
export function GlobalSearch() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K' || e.code === 'KeyK')) { e.preventDefault(); setOpen(true) }
      else if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); setOpen(true) }
    }
    const onOpen = () => setOpen(true)
    document.addEventListener('keydown', onKey)
    window.addEventListener('m2:search', onOpen)
    return () => { document.removeEventListener('keydown', onKey); window.removeEventListener('m2:search', onOpen) }
  }, [])
  return open ? <SearchWindow onClose={() => setOpen(false)} /> : null
}

function SearchWindow({ onClose }: { onClose(): void }) {
  const me = useEmployee()
  const navigate = useNavigate()
  const online = useOnline()
  const ref = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const manager = isManagerRole(me.role)
  const access = { tasks: hasPage(me, 'tasks'), seals: manager || !!me.canSeals, manager }
  const subscribers = useSubscribers()
  const local = useLiveQuery(async () => ({
    tasks: access.tasks ? await db.tasks.toArray() : [],
    people: access.manager ? await db.employees.toArray() : [],
    types: await db.taskTypes.toArray(),
  }), [access.tasks, access.manager])
  const typeName = (id: number) => local?.types.find((t) => t.id === id)?.name ?? 'مهمة'

  // Free text also asks the server for tasks this device does not hold (after a short pause).
  const [remote, setRemote] = useState<{ q: string; rows: Task[] }>({ q: '', rows: [] })
  const term = query.trim()
  const textual = access.tasks && term.length >= 2 && !/^#?\s*[\d٠-٩]+$/.test(term)
  useEffect(() => {
    if (!textual || !online || isDemo) return
    const sb = getSupabase()
    if (!sb) return
    let alive = true
    const t = window.setTimeout(async () => {
      const res = await sb.rpc('task_search', { p_term: term, p_offset: 0, p_limit: 5 })
      if (alive && !res.error) setRemote({ q: term, rows: (res.data as Parameters<typeof taskFromRow>[0][]).map(taskFromRow) })
    }, 300)
    return () => { alive = false; window.clearTimeout(t) }
  }, [term, textual, online])

  const hits = useMemo(() => {
    if (!local) return []
    const tasks = remote.q === term ? [...local.tasks, ...remote.rows.filter((r) => !local.tasks.some((t) => t.id === r.id))] : local.tasks
    return searchAll(query, { nav: navFor(me), subscribers: access.tasks ? subscribers : [], tasks, people: local.people, typeName }, access)
    // typeName reads local; access is derived from me.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, local, remote, subscribers, me])

  useEffect(() => { ref.current?.showModal(); input.current?.focus() }, [])
  useEffect(() => setActive(0), [query])

  function go(h: Hit | undefined) {
    if (!h) return
    onClose()
    navigate(h.to)
  }
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(hits.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); go(hits[active]) }
  }
  useEffect(() => { document.getElementById(`gs-${active}`)?.scrollIntoView({ block: 'nearest' }) }, [active])

  let n = -1
  return (
    <dialog ref={ref} className="gsearch" aria-label="بحث شامل" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}>
      <div className="gs-panel">
        <div className="gs-field">
          <Search size={22} aria-hidden="true" />
          <input
            ref={input}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={access.tasks ? 'صفحة، رقم مهمة، اسم مشترك، رقم ختم…' : 'اسم الصفحة…'}
            aria-label="بحث"
            role="combobox"
            aria-expanded={hits.length > 0}
            aria-controls="gs-results"
            aria-activedescendant={hits.length ? `gs-${active}` : undefined}
            autoComplete="off"
          />
          <button type="button" className="icon-btn" aria-label="إغلاق" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="gs-results" id="gs-results" role="listbox">
          {GROUPS.map((g) => {
            const list = hits.filter((h) => h.group === g.key)
            if (!list.length) return null
            return (
              <div key={g.key} role="group" aria-label={g.label}>
                <p className="gs-group">{g.label}</p>
                {list.map((h) => {
                  n++
                  const i = n
                  const Icon = ICON[h.group]
                  return (
                    <button key={h.key} id={`gs-${i}`} type="button" role="option" aria-selected={i === active} className="gs-hit" onMouseMove={() => setActive(i)} onClick={() => go(h)}>
                      <Icon size={17} aria-hidden="true" />
                      <span className="gs-text"><b>{h.title}</b>{h.hint && <small>{h.hint}</small>}</span>
                      {i === active && <CornerDownLeft size={15} aria-hidden="true" className="gs-enter" />}
                    </button>
                  )
                })}
              </div>
            )
          })}
          {term && !hits.length && <p className="gs-empty">ما في نتائج لـ«{term}».</p>}
          {!term && <p className="gs-empty">{access.tasks ? 'اكتب اسم صفحة، أو رقم مهمة (35)، أو اسم مشترك، أو رقم ختم.' : 'اكتب اسم الصفحة اللي بدك إياها.'}</p>}
          {textual && !online && <p className="gs-offline"><WifiOff size={15} aria-hidden="true" /> البحث بالنص بالمهام القديمة بدو إنترنت. المعروض من هالجهاز.</p>}
        </div>
        <p className="gs-foot"><kbd>↑</kbd><kbd>↓</kbd> للتنقل · <kbd>Enter</kbd> للفتح · <kbd>Esc</kbd> للإغلاق</p>
      </div>
    </dialog>
  )
}
