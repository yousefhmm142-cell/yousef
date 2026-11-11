import { taskAssignees, isSharedTask } from './model'
import { toISODate } from '../../lib/dates'
import type { Task, TaskType } from './model'
import type { SealWorkLine } from './sealWork'
import { fold } from './subscribers'

export interface ArchiveLine {
  id: string
  date: string
  techId: string
  reference: string
  work: string
  subscriber: string
  notes: string
  seals: number[]
}
/** Completion day, rather than the day the order was created. Seal work is included once. */
export function buildArchive(tasks: Task[], seals: SealWorkLine[], types: TaskType[]): ArchiveLine[] {
  return [
    ...tasks
      .filter((t) => t.status === 'done' && t.completedAt && t.assigneeId)
      .flatMap((t) => taskAssignees(t).map(techId => ({
        id: isSharedTask(t) ? `${t.id}:${techId}` : t.id,
        date: toISODate(new Date(t.completedAt!)),
        techId,
        reference: `مهمة${isSharedTask(t) ? ' مشتركة' : ''} #${t.number}`,
        work: [types.find((x) => x.id === t.typeId)?.name ?? 'مهمة', t.details].filter(Boolean).join(' · '),
        subscriber: t.subscriberName,
        notes: t.completionNotes,
        seals: [] as number[],
      }))),
    ...seals.map((s) => ({
      id: `seal-${s.date}-${s.techId}-${s.seals.join('-')}`,
      date: s.date,
      techId: s.techId,
      reference:
        s.seals.length === 1
          ? `ختم ${s.seals[0]}`
          : `أختام (${s.seals.length}) · ${s.seals[0]}…${s.seals[s.seals.length - 1]}`,
      work: s.work || 'أعمال أختام',
      subscriber: s.subscriber,
      notes: s.board ? `طبلون ${s.board}` : '',
      seals: s.seals,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date) || a.reference.localeCompare(b.reference, 'ar', { numeric: true }))
}
export function filterArchive(
  rows: ArchiveLine[],
  from: string,
  to: string,
  tech: string,
  search: string,
): ArchiveLine[] {
  const q = fold(search)
  return rows.filter(
    (r) =>
      r.date >= from &&
      r.date <= to &&
      (!tech || r.techId === tech) &&
      (!q || fold(`${r.reference} ${r.work} ${r.subscriber} ${r.notes} ${r.seals.join(' ')}`).includes(q)),
  )
}
