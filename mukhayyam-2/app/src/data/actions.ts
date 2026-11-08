// Writes made without internet (tasks, attendance corrections, the warehouse): kept on this device,
// shown at once, and sent to the server in the same order as soon as the internet is back.
// Every row carries its own id, so sending the same thing twice cannot make it twice.
import { isDemo } from '../config'
import { getMeta, setMeta } from './db'
import { getSupabase } from './supabase'

export interface Action {
  id: string
  table: string
  op: 'insert' | 'update' | 'delete'
  /** insert/update: the columns */
  row?: Record<string, unknown>
  /** update/delete: which row */
  rowId?: string
  /** What it was, for the message if the server refuses it. */
  label: string
}

const KEY = 'actions:queue'
const LIMIT_MS = 12_000
export const getActions = async () => (await getMeta<Action[]>(KEY)) ?? []
let lock: Promise<unknown> = Promise.resolve()
const locked = <T,>(job: () => Promise<T>): Promise<T> => {
  const run = lock.then(job, job)
  lock = run.catch(() => undefined)
  return run
}
const say = (text: string, tone: 'ok' | 'danger' = 'ok') => window.dispatchEvent(new CustomEvent('m2-toast', { detail: { text, tone } }))

/** Pages that must read again after what was waiting has gone up (tasks, attendance, warehouse). */
const refreshers = new Set<() => unknown>()
export const onActionsSent = (f: () => unknown) => { refreshers.add(f); return () => void refreshers.delete(f) }

type Outcome = 'done' | 'offline' | 'refused'
async function send(a: Action, ms = LIMIT_MS): Promise<Outcome> {
  const sb = getSupabase()
  if (!sb) return 'offline'
  const t = sb.from(a.table)
  const q = a.op === 'insert' ? t.insert(a.row!) : a.op === 'update' ? t.update(a.row!).eq('id', a.rowId!) : t.delete().eq('id', a.rowId!)
  const res = await q.abortSignal(AbortSignal.timeout(ms))
  if (!res.error) return 'done'
  if (res.status === 0 || !res.error.code) return 'offline'
  // Already there (sent before, the answer got lost on the way): nothing more to do.
  if (res.error.code === '23505') return 'done'
  return 'refused'
}

/**
 * Sends now when there is internet; otherwise (or when the line drops on the way) the change is made
 * on this device with `local` and kept to send later. Throws only when the server refuses it.
 */
export async function runOrQueue(a: Omit<Action, 'id'>, local: () => Promise<void>, opts: { background?: boolean } = {}): Promise<'sent' | 'queued'> {
  const action: Action = { ...a, id: crypto.randomUUID() }
  const waiting = (await getActions()).length > 0
  // background: kept here at once and sent behind the scenes (typing many readings never waits on the line).
  if (opts.background) {
    await local()
    await locked(async () => setMeta(KEY, [...(await getActions()), action]))
    if (!isDemo && navigator.onLine) void flushActions()
    return 'queued'
  }
  if (!isDemo && navigator.onLine && !waiting) {
    const r = await send(action)
    if (r === 'done') return 'sent'
    if (r === 'refused') throw new Error('refused')
  }
  await local()
  await locked(async () => setMeta(KEY, [...(await getActions()), action]))
  if (navigator.onLine && waiting) void flushActions()
  else say('انحفظ على جهازك · بانتظار الإنترنت، وبينرسل لحاله لما يرجع')
  return 'queued'
}

let flushing: Promise<void> | null = null
export function flushActions(): Promise<void> {
  if (flushing) return flushing
  flushing = (async () => {
    if (isDemo || !getSupabase() || !navigator.onLine) return
    let sent = 0
    const refused: string[] = []
    for (;;) {
      const a = (await getActions())[0]
      if (!a) break
      const r = await send(a, LIMIT_MS * 2)
      if (r === 'offline') break
      if (r === 'refused') refused.push(a.label)
      else sent++
      await locked(async () => setMeta(KEY, (await getActions()).filter((x) => x.id !== a.id)))
    }
    if (sent + refused.length > 0) {
      for (const f of refreshers) { try { await f() } catch { /* the page reads again on its next look */ } }
      if (sent) say(`وصل للخادم ${sent} ${sent > 10 ? 'تعديلاً' : 'تعديلات'} انعملت بدون نت`)
      if (refused.length) say(`ما انقبل: ${refused.slice(0, 3).join('، ')}${refused.length > 3 ? '…' : ''}. راجعها.`, 'danger')
    }
  })().finally(() => { flushing = null })
  return flushing
}

export function startActions() {
  const go = () => void flushActions()
  window.addEventListener('online', go)
  window.setInterval(() => navigator.onLine && go(), 20_000)
  go()
}
