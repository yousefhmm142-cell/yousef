import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../data/db'
import { dayName } from '../../lib/dates'
import { balances } from '../stock/model'
import { isOpen, isOverdue } from '../tasks/model'

// The manager's home page: what happened lately (from what this device already holds, so it is
// instant and works offline) and what needs attention now.

export type EventKind = 'report' | 'sheet' | 'task' | 'attendance' | 'stock'
export interface FeedEvent {
  id: string
  at: string
  kind: EventKind
  who: string
  text: string
  tone?: 'ok' | 'warn' | 'danger'
}

const SINCE_DAYS = 7

export function useFeed(): FeedEvent[] | undefined {
  return useLiveQuery(async () => {
    const since = new Date(Date.now() - SINCE_DAYS * 86_400_000).toISOString()
    const [people, reports, sheets, tasks, types, punches, moves, items] = await Promise.all([
      db.employees.toArray(),
      db.siteReports.toArray(),
      db.distributionSheets.toArray(),
      db.tasks.toArray(),
      db.taskTypes.toArray(),
      db.punches.where('at').above(since).toArray(),
      db.stockMoves.where('at').above(since).toArray(),
      db.stockItems.toArray(),
    ])
    const name = (id: string | null | undefined) => people.find((p) => p.id === id)?.fullName ?? 'النظام'
    const out: FeedEvent[] = []
    const add = (e: FeedEvent) => e.at > since && out.push(e)

    for (const [kind, noun, rows] of [
      ['report', 'تقرير التوليد', reports.map((r) => ({ r, day: r.reportDate }))],
      ['sheet', 'كشف التوزيع', sheets.map((r) => ({ r, day: r.sheetDate }))],
    ] as const) {
      for (const { r, day } of rows) {
        if (r.submittedAt) add({ id: `${kind}-s-${r.id}`, at: r.submittedAt, kind, who: name(r.submittedBy), text: `أرسل ${noun} ليوم ${dayName(day)}${r.recordedOffline ? ' (سُجّل بدون إنترنت)' : ''}`, tone: 'warn' })
        if (r.approvedAt) add({ id: `${kind}-a-${r.id}`, at: r.approvedAt, kind, who: name(r.approvedBy), text: `اعتمد ${noun} ليوم ${dayName(day)}`, tone: 'ok' })
      }
    }

    const typeName = (id: number) => types.find((t) => t.id === id)?.name ?? 'مهمة'
    for (const t of tasks) {
      const who = name(t.assigneeId)
      const label = `${typeName(t.typeId)} رقم ${t.number}${t.subscriberName ? ` (${t.subscriberName})` : ''}`
      add({ id: `task-c-${t.id}`, at: t.createdAt, kind: 'task', who: name(t.createdBy), text: `أرسل مهمة ${label} إلى ${who}` })
      if (t.startedAt) add({ id: `task-st-${t.id}`, at: t.startedAt, kind: 'task', who, text: `بدأ ${label}` })
      if (t.completedAt) add({ id: `task-d-${t.id}`, at: t.completedAt, kind: 'task', who, text: `أنهى ${label}`, tone: 'ok' })
      if (t.cancelledAt) add({ id: `task-x-${t.id}`, at: t.cancelledAt, kind: 'task', who, text: `أُلغيت ${label}${t.cancelReason ? `: ${t.cancelReason}` : ''}`, tone: 'danger' })
    }

    for (const p of punches) {
      add({ id: `p-${p.id}`, at: p.at, kind: 'attendance', who: name(p.employeeId), text: `${p.kind === 'in' ? 'سجّل حضوره' : 'سجّل انصرافه'}${p.method === 'manual' ? ' (يدوي)' : ''}`, tone: p.kind === 'in' ? 'ok' : undefined })
    }

    const itemOf = (id: number) => items.find((i) => i.id === id)
    for (const m of moves) {
      const it = itemOf(m.itemId)
      add({ id: `m-${m.id}`, at: m.at, kind: 'stock', who: name(m.createdBy), text: `${m.kind === 'in' ? 'أدخل إلى المخزن' : 'أخرج من المخزن'} ${m.qty} ${it?.unit ?? ''} ${it?.name ?? ''}`.replace(/\s+/g, ' ').trim() })
    }
    return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 40)
  }, [])
}

export interface Attention {
  key: string
  to: string
  tone: 'warn' | 'danger' | 'info'
  title: string
  detail: string
}

/** Things that need the manager now: approvals waiting, late tasks, stock running out, unsent work. */
export function useAttention(now: Date): Attention[] | undefined {
  return useLiveQuery(async () => {
    const [reports, sheets, tasks, moves, items] = await Promise.all([
      db.siteReports.where('status').equals('submitted').toArray(),
      db.distributionSheets.where('status').equals('submitted').toArray(),
      db.tasks.toArray(),
      db.stockMoves.toArray(),
      db.stockItems.toArray(),
    ])
    const list: Attention[] = []
    if (reports.length) list.push({ key: 'reports', to: '/generation', tone: 'warn', title: `${reports.length} ${reports.length === 1 ? 'تقرير توليد' : 'تقارير توليد'} بانتظار اعتمادك`, detail: reports.map((r) => dayName(r.reportDate)).join('، ') })
    if (sheets.length) list.push({ key: 'sheets', to: '/distribution', tone: 'warn', title: `${sheets.length} ${sheets.length === 1 ? 'كشف توزيع' : 'كشوف توزيع'} بانتظار اعتمادك`, detail: sheets.map((r) => dayName(r.sheetDate)).join('، ') })
    const open = tasks.filter(isOpen)
    const late = open.filter((t) => isOverdue(t, now))
    if (late.length) list.push({ key: 'late', to: '/tasks', tone: 'danger', title: `${late.length} مهمة تجاوزت وقتها`, detail: `من ${open.length} مفتوحة` })
    const bal = balances(moves)
    const low = items.filter((i) => i.isActive && i.minQty > 0 && (bal.get(i.id) ?? 0) <= i.minQty)
    if (low.length) list.push({ key: 'stock', to: '/stock', tone: 'warn', title: `${low.length} ${low.length === 1 ? 'صنف' : 'أصناف'} في المخزن قاربت على النفاد`, detail: low.slice(0, 3).map((i) => i.name).join('، ') })
    return list
  }, [now.getMinutes()])
}
