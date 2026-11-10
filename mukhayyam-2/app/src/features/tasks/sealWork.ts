import { useEffect, useMemo, useState } from 'react'
import { isDemo } from '../../config'
import { getSupabase } from '../../data/supabase'
import type { ISODate } from '../../lib/dates'
import { splitDetails } from '../seals/model'
import type { Task, TaskType } from './model'

/** The words a job starts with; whatever follows is the subscriber (longest first, so «فك ساعة فحص» wins over «فك ساعة»). */
const WORK_STARTS = [
  'فك ساعة فحص', 'تركيب ساعة فحص', 'فك ساعة', 'تركيب ساعة', 'تبديل ساعة', 'فصل خدمة', 'فصل خط', 'فصل', 'إعادة خدمة', 'إعادة شبك', 'إعادة', 'اعادة',
  'إضافة مشترك', 'اضافة مشترك', 'تركيب اشتراك', 'نقل مشترك', 'رفع قدرة', 'تنزيل قدرة', 'تغذية طبلون', 'شد كابل', 'تفتيش', 'صيانة',
].sort((a, b) => b.length - a.length)

/** «فك ساعة نوح كلاب» written without brackets: the job, and the subscriber who follows it. */
export function splitWorkSubscriber(work: string, subscriber: string): { work: string; subscriber: string } {
  if (subscriber || work.includes('+')) return { work, subscriber }
  const w = work.trim().replace(/\s+/g, ' ')
  for (const start of WORK_STARTS) {
    if (w === start) break
    if (w.startsWith(`${start} `)) return { work: start, subscriber: w.slice(start.length).trim() }
  }
  return { work, subscriber }
}

/** A seal as the server returns it for the statement. */
export interface SealWorkRow {
  seal_no: number
  technician_id: string
  used_on: string | null
  issued_on: string | null
  details: string
  board_no: string
}

/** One line of the statement: who, which day, which seals, and what he did with them. */
export interface SealWorkLine {
  date: ISODate
  techId: string
  tech: string
  seals: number[]
  board: string
  work: string
  subscriber: string
}

/** Search names without making spelling variants of Arabic letters or vowel marks a barrier. */
const searchName = (s: string) => s.normalize('NFKC').replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim().toLocaleLowerCase('ar')

export function filterSealWork(lines: SealWorkLine[], filters: { from?: ISODate | null; to?: ISODate | null; technician?: string; subscriber?: string }): SealWorkLine[] {
  const subscriber = searchName(filters.subscriber ?? '')
  return lines.filter((l) => (!filters.from || l.date >= filters.from) && (!filters.to || l.date <= filters.to)
    && (!filters.technician || l.techId === filters.technician)
    && (!subscriber || searchName(l.subscriber).includes(subscriber)))
}

/**
 * Lines in date order. The same technician on the same day with the same written work is one line
 * (several seals); everything else is its own line, and a name may come back as often as needed.
 */
export function buildSealWork(rows: SealWorkRow[], names: Map<string, string>): SealWorkLine[] {
  const lines = new Map<string, SealWorkLine>()
  for (const r of rows) {
    const date = (r.used_on ?? r.issued_on) as ISODate | null
    if (!date) continue
    const key = `${date}|${r.technician_id}|${r.details.trim()}`
    const hit = lines.get(key)
    if (hit) {
      hit.seals.push(r.seal_no)
      continue
    }
    const d = splitDetails(r.details, r.board_no)
    const ws = splitWorkSubscriber(d.work, d.subscriber)
    lines.set(key, { date, techId: r.technician_id, tech: names.get(r.technician_id) ?? '—', seals: [r.seal_no], board: d.board, work: ws.work, subscriber: ws.subscriber })
  }
  const out = [...lines.values()]
  for (const l of out) l.seals.sort((a, b) => a - b)
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.tech.localeCompare(b.tech, 'ar') || a.seals[0]! - b.seals[0]!)
}

/** Seals per technician, most first. */
export function sealWorkTotals(lines: SealWorkLine[]): { tech: string; seals: number; jobs: number }[] {
  const m = new Map<string, { tech: string; seals: number; jobs: number }>()
  for (const l of lines) {
    const t = m.get(l.techId) ?? { tech: l.tech, seals: 0, jobs: 0 }
    t.seals += l.seals.length
    t.jobs += 1
    m.set(l.techId, t)
  }
  return [...m.values()].sort((a, b) => b.seals - a.seals || a.tech.localeCompare(b.tech, 'ar'))
}

// ---------- Seal work counted as tasks ----------
/** The «type» for seal work that matches none of the task types. */
export const SEAL_TYPE_ID = -1
const norm = (t: string) => t.replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/\s+/g, ' ').trim()

/**
 * Every line of the statement is one finished task for its technician on its day, of the type whose
 * name matches the work («تفتيش», «فك ساعة»…), or of «أعمال الأختام» when none does.
 */
export function sealWorkAsTasks(lines: SealWorkLine[], types: TaskType[]): { tasks: Task[]; types: TaskType[] } {
  const tasks: Task[] = []
  let used = false
  for (const l of lines) {
    const parts = (l.work.split(/\s*\+\s*/).map((p) => p.trim()).filter(Boolean))
    for (const part of parts.length ? parts : ['']) {
      const p = norm(part)
      const hit = p ? types.find((t) => norm(t.name) === p) ?? types.find((t) => p.includes(norm(t.name)) || norm(t.name).includes(p)) : undefined
      if (!hit) used = true
      tasks.push({
        id: `seal-${l.date}-${l.techId}-${l.seals[0]}-${tasks.length}`, number: 0, typeId: hit?.id ?? SEAL_TYPE_ID, assigneeId: l.techId, createdBy: null,
        details: part, subscriberName: l.subscriber, subscriberPhone: null, zoneId: null, location: '', priority: 'normal', expectedMinutes: 0, status: 'done',
        sentAt: null, seenAt: null, startedAt: null, completedAt: `${l.date}T12:00:00+02:00`, cancelledAt: null, completionNotes: '', cancelReason: '', linkToken: '', createdAt: `${l.date}T12:00:00+02:00`,
      })
    }
  }
  return { tasks, types: used ? [...types, { id: SEAL_TYPE_ID, name: 'أعمال الأختام', isActive: true, sortOrder: 9999 }] : types }
}

/** The seal work of a period (or of everything), refreshed while the page is open. Empty when the server cannot be reached. */
export function useSealWork(from: ISODate | null, to: ISODate | null, names: Map<string, string> | undefined): SealWorkLine[] {
  const [rows, setRows] = useState<SealWorkRow[]>([])
  useEffect(() => {
    const sb = getSupabase()
    if (isDemo || !sb) return
    let live = true
    const load = () => {
      if (!navigator.onLine) return
      void sb.rpc('seal_work_statement', { p_from: from, p_to: to }).then((res) => {
        if (live && !res.error) setRows((res.data ?? []) as SealWorkRow[])
      })
    }
    load()
    const id = window.setInterval(load, 60_000)
    window.addEventListener('online', load)
    return () => {
      live = false
      window.clearInterval(id)
      window.removeEventListener('online', load)
    }
  }, [from, to])
  return useMemo(() => (names ? buildSealWork(rows, names) : []), [rows, names])
}
