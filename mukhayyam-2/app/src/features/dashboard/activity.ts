import { createContext, useContext, useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../data/db'
import { dayName, todayISO } from '../../lib/dates'
import { useEmployee } from '../../auth/AuthProvider'
import { isDemo } from '../../config'
import { rejectedWrites } from '../../data/rejected'
import { defaultAlertSettings } from '../generation/model'
import { batchSaved, listBatches } from '../readings/repo'
import { smsInfo } from '../sms/repo'
import { buildAttention, type Attention, type AttentionInput } from './attention'

// The manager's home page: what happened lately (from what this device already holds, so it is
// instant and works offline) and what needs attention now.

export type EventKind = 'report' | 'sheet' | 'task' | 'attendance' | 'stock' | 'seal' | 'reading' | 'settings'
export interface FeedEvent {
  id: string
  at: string
  kind: EventKind
  who: string
  text: string
  reference?: string
  route?: string
  tone?: 'ok' | 'warn' | 'danger'
}

const SINCE_DAYS = 7

export const ActivityContext = createContext<{ feed?: FeedEvent[]; connected: boolean }>({ connected: false })
export const useFeed = () => useContext(ActivityContext).feed
export const useActivityConnection = () => useContext(ActivityContext).connected

export function useCachedFeed(): FeedEvent[] | undefined {
  return useLiveQuery(async () => {
    const since = new Date(Date.now() - SINCE_DAYS * 86_400_000).toISOString()
    const [people, reports, sheets, tasks, types, punches] = await Promise.all([
      db.employees.toArray(),
      db.siteReports.toArray(),
      db.distributionSheets.toArray(),
      db.tasks.toArray(),
      db.taskTypes.toArray(),
      db.punches.where('at').above(since).toArray(),
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

    return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 40)
  }, [])
}

export type { Attention } from './attention'

/**
 * Everything that waits for the manager now (see attention.ts). Live from this device; the SMS balance,
 * the readings week and the refused writes are looked up every 30 minutes.
 */
export function useAttention(now: Date): Attention[] | undefined {
  const me = useEmployee()
  const manager = me.role === 'admin' || me.role === 'manager'
  const [extra, setExtra] = useState<{ sms: number | null; readings: AttentionInput['readings']; rejected: AttentionInput['rejected'] }>({ sms: null, readings: null, rejected: [] })
  useEffect(() => {
    let alive = true
    async function look() {
      const rejected = (await rejectedWrites(me.id).catch(() => [])).map((r) => ({ label: r.label, code: r.code }))
      let sms: number | null = null
      let readings: AttentionInput['readings'] = null
      if (manager && navigator.onLine && !isDemo) {
        try {
          const b = (await smsInfo(true)).balance
          if (b && /^-?\d+(\.\d+)?$/.test(b) && Number(b) >= 0) sms = Number(b)
        } catch { /* no SMS account yet */ }
        try {
          const open = (await listBatches()).find((b) => b.status === 'open')
          const rows = open ? await batchSaved(open.id) : null
          if (open && rows) {
            const areas = new Map<string, boolean>()
            for (const r of rows) areas.set(r.area, (areas.get(r.area) ?? false) || !!r.mode)
            readings = { title: open.title, unassigned: [...areas].filter(([, has]) => !has).map(([area]) => area).sort((a, b) => a.localeCompare(b, 'ar')) }
          }
        } catch { /* readings not reachable now */ }
      }
      if (alive) setExtra({ sms, readings, rejected })
    }
    void look()
    const t = window.setInterval(() => void look(), 30 * 60_000)
    return () => { alive = false; window.clearInterval(t) }
  }, [me.id, manager])

  const minute = Math.floor(now.getTime() / 60_000)
  return useLiveQuery(async () => {
    const [reports, sheets, tasks, generators, settings, people, types, seals] = await Promise.all([
      db.siteReports.toArray(),
      db.distributionSheets.toArray(),
      db.tasks.toArray(),
      db.generators.toArray(),
      db.alertSettings.get(1),
      db.employees.toArray(),
      db.taskTypes.toArray(),
      manager || me.canSeals ? db.seals.where('status').equals('issued').toArray() : Promise.resolve(null),
    ])
    const at = new Date(minute * 60_000)
    return buildAttention({
      now: at,
      today: todayISO(),
      gazaHour: Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Gaza' }).format(at)),
      reports, sheets, tasks, generators,
      settings: settings ?? defaultAlertSettings,
      names: new Map(people.map((p) => [p.id, p.fullName])),
      seals,
      readings: extra.readings,
      smsBalance: extra.sms,
      rejected: extra.rejected,
      typeName: (id) => types.find((t) => t.id === id)?.name ?? 'مهمة',
    })
  }, [minute, extra, manager, me.canSeals])
}
