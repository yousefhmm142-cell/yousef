import type { ISODate } from '../../lib/dates'
import { splitDetails } from '../seals/model'

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
    lines.set(key, { date, techId: r.technician_id, tech: names.get(r.technician_id) ?? '—', seals: [r.seal_no], board: d.board, work: d.work, subscriber: d.subscriber })
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
