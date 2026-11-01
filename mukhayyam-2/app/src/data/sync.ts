import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useSyncExternalStore } from 'react'
import type { EntityTable, Table } from 'dexie'
import { isDemo } from '../config'
import { SHEET_SELECT, sheetFromRow, sheetToRows, type SheetRow } from '../features/distribution/remote'
import type { DistributionSheet, Zone } from '../features/distribution/model'
import { REPORT_SELECT, reportFromRow, reportToRows, type ReportRow } from '../features/generation/remote'
import type { AlertSettings, FuelType, Generator, SiteReport } from '../features/generation/model'
import type { ChildRows } from '../features/sheets/remote'
import type { TaskType } from '../features/tasks/model'
import { scheduleFromRow, type ScheduleRow } from '../features/attendance/remote'
import type { Schedule } from '../features/attendance/rules'
import type { StockItem } from '../features/stock/model'
import { isEditableStatus, type SheetMeta, type SheetStatus } from '../features/sheets/workflow'
import { isManagerRole, SITE_ROLES, type Employee, type Role } from '../types'
import { db, deleteMeta, getMeta, setMeta } from './db'
import { getSupabase } from './supabase'

// Keeps this device and the server in step, so a report typed on the operator's phone appears on
// the manager's laptop and an approval on the laptop appears on the phone.
//
// - Everything is saved on the device first; nothing waits for the network.
// - A sheet changed on this device (updatedAt moved past syncedAt) is sent in the same steps a
//   person takes: lines first while it is a draft, then "sent", or "approved" / "returned". The
//   server checks every step again (sheet_guard), so a phone can never skip one.
// - What changed on the server since the last look is brought back, except sheets that still have
//   unsent changes here.
// - When the server already moved on (for example the report was approved while an old copy was
//   being edited offline), the server's version wins and replaces the copy on this device.

type SheetDoc = SiteReport | DistributionSheet
export type SheetKind = 'generation' | 'distribution'

interface KindSpec {
  kind: SheetKind
  header: 'site_reports' | 'distribution_sheets'
  dateCol: 'report_date' | 'sheet_date'
  dateIndex: 'reportDate' | 'sheetDate'
  /** Who fills this sheet on site; everyone else who reads it is a manager or the admin. */
  fillers: Role[]
  readers: Role[]
  table: Table<SheetDoc, string>
  select: string
  dateOf(doc: SheetDoc): string
  toRows(doc: SheetDoc): { header: Record<string, unknown>; children: ChildRows[] }
  fromRow(row: unknown): SheetDoc
}

const KINDS: KindSpec[] = [
  {
    kind: 'generation',
    header: 'site_reports',
    dateCol: 'report_date',
    dateIndex: 'reportDate',
    fillers: ['admin', 'manager', ...SITE_ROLES],
    readers: ['admin', 'manager', ...SITE_ROLES],
    table: db.siteReports as unknown as Table<SheetDoc, string>,
    select: REPORT_SELECT,
    dateOf: (d) => (d as SiteReport).reportDate,
    toRows: (d) => reportToRows(d as SiteReport),
    fromRow: (r) => reportFromRow(r as ReportRow),
  },
  {
    kind: 'distribution',
    header: 'distribution_sheets',
    dateCol: 'sheet_date',
    dateIndex: 'sheetDate',
    fillers: ['admin', 'manager', ...SITE_ROLES],
    readers: ['admin', 'manager', ...SITE_ROLES],
    table: db.distributionSheets as unknown as Table<SheetDoc, string>,
    select: SHEET_SELECT,
    dateOf: (d) => (d as DistributionSheet).sheetDate,
    toRows: (d) => sheetToRows(d as DistributionSheet),
    fromRow: (r) => sheetFromRow(r as SheetRow),
  },
]

export const hasUnsent = (d: SheetMeta) => d.syncedAt !== d.updatedAt

/** A sent sheet that reaches the server later than this is marked "sent without internet". */
const LATE_SEND_MS = 2 * 60_000
const PAGE = 500
/** How often a sheet being filled is checked while someone watches it (when Realtime is off). */
const LIVE_EVERY_MS = 8_000

// ---------- Errors ----------
export class SyncError extends Error {
  /** True for a lost or slow connection: the same step is simply tried again later. */
  readonly transient: boolean
  readonly code: string
  constructor(message: string, code: string, transient: boolean) {
    super(message)
    this.code = code
    this.transient = transient
  }
}

function toSyncError(error: PostgrestError, status: number): SyncError {
  const code = error.code ?? ''
  const transient = status === 0 || status >= 500 || code === '' || code.startsWith('PGRST3') || code === 'PGRST002'
  return new SyncError(error.message, code, transient)
}

async function run<T>(query: PromiseLike<{ data: T; error: PostgrestError | null; status: number }>): Promise<T> {
  let res: { data: T; error: PostgrestError | null; status: number }
  try {
    res = await query
  } catch (e) {
    throw new SyncError(e instanceof Error ? e.message : String(e), '', true)
  }
  if (res.error) throw toSyncError(res.error, res.status)
  return res.data
}

function client(): SupabaseClient {
  const sb = getSupabase()
  if (!sb) throw new SyncError('demo mode', 'demo', false)
  return sb
}

// ---------- Status for the screen ----------
export interface SyncState {
  phase: 'idle' | 'syncing' | 'error'
  /** Last time everything went through. */
  lastOkAt: string | null
  /** A sheet the server keeps refusing (not a connection problem). */
  problem: string | null
}

let state: SyncState = { phase: 'idle', lastOkAt: null, problem: null }
const listeners = new Set<() => void>()
function setState(next: Partial<SyncState>) {
  state = { ...state, ...next }
  listeners.forEach((l) => l())
}

export function useSyncState(): SyncState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

/** Changes on this device not on the server yet (sheets and queued actions). */
export function usePendingCount(): number {
  return (
    useLiveQuery(async () => {
      if (isDemo) return 0
      const sheets = await Promise.all(KINDS.map((k) => k.table.filter(hasUnsent).count()))
      return sheets.reduce((a, b) => a + b, 0) + (await db.outbox.count())
    }, []) ?? 0
  )
}

// ---------- Sending one sheet ----------
type RemoteHead = { id: string; status: SheetStatus } | null

/** Replaces the lines of one table under a sheet: removes lines deleted here, then saves the rest. */
async function pushChildren(sb: SupabaseClient, sheetId: string, child: ChildRows) {
  const parents = child.parentIds ?? [sheetId]
  if (parents.length === 0) return
  const keep = child.rows.map((r) => r.id)
  let del = sb.from(child.table).delete().in(child.parent, parents)
  if (keep.length) del = del.not('id', 'in', `(${keep.join(',')})`)
  await run(del)
  if (!child.rows.length) return
  try {
    await run(sb.from(child.table).upsert(child.rows, { onConflict: 'id' }))
  } catch (e) {
    // Two lines swapped numbers (run 1 <-> run 2): start this table over for the sheet.
    if (!(e instanceof SyncError) || e.code !== '23505') throw e
    await run(sb.from(child.table).delete().in(child.parent, parents))
    await run(sb.from(child.table).insert(child.rows))
  }
}

/** Brings one sheet back from the server and puts it on this device in place of localId. */
async function takeServerCopy(spec: KindSpec, serverId: string, localId: string, onlyIfUpdatedAt?: string) {
  const sb = client()
  const row = await run(sb.from(spec.header).select(spec.select).eq('id', serverId).maybeSingle())
  await db.transaction('rw', spec.table, async () => {
    const local = await spec.table.get(localId)
    // Typed on more while this was being sent: keep it; the next round sends it.
    if (onlyIfUpdatedAt !== undefined && local && local.updatedAt !== onlyIfUpdatedAt) return
    if (!row) {
      // Nothing on the server: nothing left to send either.
      if (local) await spec.table.put({ ...local, syncedAt: local.updatedAt })
      return
    }
    const doc = spec.fromRow(row)
    if (localId !== serverId) await spec.table.delete(localId)
    await spec.table.put({ ...doc, syncedAt: doc.updatedAt })
  })
}

async function pushSheet(spec: KindSpec, doc: SheetDoc, me: Employee): Promise<void> {
  const sb = client()
  const date = spec.dateOf(doc)
  const remote: RemoteHead = await run(
    sb.from(spec.header).select('id, status').eq(spec.dateCol, date).maybeSingle<{ id: string; status: SheetStatus }>(),
  )
  const filler = spec.fillers.includes(me.role)

  let current = doc
  if (remote && remote.id !== doc.id) {
    // The same day was started on another device.
    if (filler && isEditableStatus(remote.status) && doc.status !== 'approved') {
      current = { ...doc, id: remote.id } as SheetDoc
      await db.transaction('rw', spec.table, async () => {
        await spec.table.delete(doc.id)
        await spec.table.put(current)
      })
    } else {
      return takeServerCopy(spec, remote.id, doc.id)
    }
  }

  const { header, children } = spec.toRows(current)
  const { id, ...fields } = header
  const remoteStatus = remote?.status ?? null

  // A manager both fills sheets and acts on them: approving or reopening a sent sheet is not filling.
  const managerAct =
    isManagerRole(me.role) &&
    ((remoteStatus === 'submitted' && (current.status === 'approved' || current.status === 'returned')) || (remoteStatus === 'approved' && current.status === 'returned'))

  // A manager correcting a sheet the site already sent: the figures go up, the status stays.
  const managerEdit = isManagerRole(me.role) && !!remoteStatus && !isEditableStatus(remoteStatus) && current.status === remoteStatus

  if (filler && !managerAct) {
    if (remoteStatus && !isEditableStatus(remoteStatus) && !managerEdit) {
      // Already sent or approved on the server: the server's copy is the true one.
      return takeServerCopy(spec, current.id, current.id)
    }
    if (!remoteStatus) {
      await run(sb.from(spec.header).insert({ ...header, status: 'draft' }))
    }
    for (const child of children) await pushChildren(sb, current.id, child)
    // Also moves updated_at on, so other devices notice the new lines.
    await run(sb.from(spec.header).update(fields).eq('id', id))
    if (current.status === 'submitted' && !managerEdit) {
      const late = current.submittedAt ? Date.now() - Date.parse(current.submittedAt) > LATE_SEND_MS : false
      await run(
        sb
          .from(spec.header)
          .update({ status: 'submitted', recorded_offline: current.recordedOffline || late, device_time: current.submittedAt })
          .eq('id', id),
      )
    }
  } else if (managerAct) {
    await run(
      sb
        .from(spec.header)
        .update(current.status === 'approved' ? { status: 'approved' } : { status: 'returned', returned_reason: current.returnedReason })
        .eq('id', id),
    )
  }
  // Whatever happened, end with the server's copy: it carries the server times and names.
  await takeServerCopy(spec, current.id, current.id, current.updatedAt)
}

// ---------- Bringing changes back ----------
async function pullSheets(spec: KindSpec) {
  const sb = client()
  const key = `pull:${spec.kind}`
  let cursor = await getMeta<string>(key)
  for (;;) {
    let q = sb.from(spec.header).select(spec.select).order('updated_at', { ascending: true }).limit(PAGE)
    if (cursor) q = q.gte('updated_at', cursor)
    const rows = await run(q) as unknown as Array<{ updated_at: string }>
    for (const row of rows) await applyRemote(spec, spec.fromRow(row))
    const last = rows.at(-1)?.updated_at
    const done = !last || rows.length < PAGE || last === cursor
    if (last) cursor = last
    if (done) break
  }
  if (cursor) await setMeta(key, cursor)
}

async function applyRemote(spec: KindSpec, doc: SheetDoc) {
  await db.transaction('rw', spec.table, async () => {
    const mine = await spec.table.get(doc.id)
    if (mine && (hasUnsent(mine) || mine.syncedAt === doc.updatedAt)) return
    const sameDay = await spec.table.where(spec.dateIndex).equals(spec.dateOf(doc)).first()
    if (sameDay && sameDay.id !== doc.id) {
      if (hasUnsent(sameDay)) return
      await spec.table.delete(sameDay.id)
    }
    await spec.table.put({ ...doc, syncedAt: doc.updatedAt })
  })
}

// ---------- Lists set by the admin: people, generators, zones, alert limits ----------
async function replaceAll<T extends { id: string | number }>(table: EntityTable<T, 'id'>, rows: T[]) {
  await db.transaction('rw', table, async () => {
    const existing = await table.toArray()
    const key = (list: T[]) => JSON.stringify([...list].sort((a, b) => String(a.id).localeCompare(String(b.id))))
    if (key(existing) === key(rows)) return
    const keepIds = new Set(rows.map((r) => r.id))
    await table.bulkDelete(existing.filter((e) => !keepIds.has(e.id)).map((e) => e.id) as Parameters<typeof table.bulkDelete>[0])
    await table.bulkPut(rows)
  })
}

interface EmployeeRow {
  id: string
  full_name: string
  phone: string | null
  role: Role
  is_active: boolean
  tracks_attendance: boolean
  auth_user_id: string | null
  schedule_id: number | null
  /** Only once update 7 is on the database. */
  job_title?: string | null
  wa_code?: 970 | 972
  can_seals?: boolean
  seals_sheet?: string | null
}
interface ListRow { id: number; name: string; is_active: boolean; sort_order: number }
interface GeneratorRow extends ListRow { brand: string; model: string | null; capacity_kva: number | null; liters_per_hour: number | null }

export async function pullReference(): Promise<void> {
  const sb = client()
  const [people, generators, fuel, zones, settings, taskTypes, schedules, items] = await Promise.all([
    // '*' so this keeps working on a database that does not have the newer columns yet.
    run(sb.from('employees').select('*')),
    run(sb.from('generators').select('id, name, brand, model, capacity_kva, liters_per_hour, is_active, sort_order')),
    run(sb.from('fuel_types').select('id, name, is_active, sort_order')),
    run(sb.from('zones').select('id, name, is_active, sort_order')),
    run(sb.from('app_settings').select('*').maybeSingle()),
    run(sb.from('task_types').select('id, name, is_active, sort_order')),
    run(sb.from('work_schedules').select('*')),
    run(sb.from('stock_items').select('id, name, unit, min_qty, is_active, sort_order')),
  ])
  await replaceAll<Employee>(
    db.employees,
    (people as EmployeeRow[]).map((r) => ({
      id: r.id,
      fullName: r.full_name,
      phone: r.phone,
      role: r.role,
      isActive: r.is_active,
      tracksAttendance: r.tracks_attendance,
      hasLogin: r.auth_user_id !== null,
      scheduleId: r.schedule_id,
      jobTitle: r.job_title ?? null,
      waCode: r.wa_code ?? 972,
      canSeals: r.can_seals ?? false,
      sealsSheet: r.seals_sheet ?? null,
    })),
  )
  await replaceAll<Generator>(
    db.generators,
    (generators as GeneratorRow[]).map((g) => ({
      id: g.id,
      name: g.name,
      brand: g.brand,
      model: g.model,
      capacityKva: g.capacity_kva === null ? null : Number(g.capacity_kva),
      litersPerHour: g.liters_per_hour === null ? null : Number(g.liters_per_hour),
      isActive: g.is_active,
      sortOrder: g.sort_order,
    })),
  )
  const list = (rows: ListRow[]) => rows.map((r) => ({ id: r.id, name: r.name, isActive: r.is_active, sortOrder: r.sort_order }))
  await replaceAll<FuelType>(db.fuelTypes, list(fuel as ListRow[]))
  await replaceAll<Zone>(db.zones, list(zones as ListRow[]))
  await replaceAll<TaskType>(db.taskTypes, list(taskTypes as ListRow[]))
  await replaceAll<Schedule>(db.schedules, (schedules as ScheduleRow[]).map(scheduleFromRow))
  await replaceAll<StockItem>(
    db.stockItems,
    (items as Array<ListRow & { unit: string; min_qty: number }>).map((r) => ({ ...list([r])[0]!, unit: r.unit, minQty: Number(r.min_qty) })),
  )
  if (settings) {
    const s = settings as Record<string, number | string>
    const n = (k: string) => Number(s[k])
    await replaceAll<AlertSettings>(db.alertSettings, [
      {
        id: 1,
        fuelDaysWarn: n('fuel_days_warn'),
        fuelDaysDanger: n('fuel_days_danger'),
        consumptionWarnPct: n('consumption_warn_pct'),
        consumptionDangerPct: n('consumption_danger_pct'),
        tempWarnC: n('temp_warn_c'),
        tempDangerC: n('temp_danger_c'),
        oilWarnBar: n('oil_warn_bar'),
        oilDangerBar: n('oil_danger_bar'),
        loadWarnPct: n('load_warn_pct'),
        loadDangerPct: n('load_danger_pct'),
        imbalanceWarnPct: n('imbalance_warn_pct'),
        imbalanceDangerPct: n('imbalance_danger_pct'),
        oilChangeWarnHours: n('oil_change_warn_hours'),
        oilChangeDueHours: n('oil_change_due_hours'),
        phaseVoltage: n('phase_voltage'),
        expectedWarnPct: n('expected_warn_pct') || 15,
        expectedDangerPct: n('expected_danger_pct') || 30,
      },
    ])
  }
}

// ---------- One full round ----------
let me: Employee | null = null
let running: Promise<void> | null = null
let again = false
let timer: number | undefined
let failures = 0
let lastReferenceAt = 0
const REFERENCE_EVERY_MS = 2 * 60_000

async function round(): Promise<void> {
  if (!me) return
  const who = me
  setState({ phase: 'syncing' })
  let problem: string | null = null
  try {
    // 1. Send what changed here, oldest day first.
    for (const spec of KINDS) {
      if (!spec.readers.includes(who.role)) continue
      const unsent = (await spec.table.filter(hasUnsent).toArray()).sort((a, b) => spec.dateOf(a).localeCompare(spec.dateOf(b)))
      for (const doc of unsent) {
        try {
          await pushSheet(spec, doc, who)
        } catch (e) {
          if (e instanceof SyncError && e.transient) throw e
          // Refused by the server for a reason other than the connection: keep it here, report it,
          // and carry on with the rest.
          console.error(`sync: ${spec.kind} ${spec.dateOf(doc)} refused`, e)
          problem = spec.dateOf(doc)
        }
      }
    }
    // 2. Bring back what changed elsewhere. The lists (people, generators, zones...) rarely change and
    //    every edit to them refreshes them at once, so they are re-read every couple of minutes only.
    if (Date.now() - lastReferenceAt > REFERENCE_EVERY_MS) {
      await pullReference()
      lastReferenceAt = Date.now()
    }
    for (const spec of KINDS) if (spec.readers.includes(who.role)) await pullSheets(spec)
    if (await listsMissing()) {
      await pullReference()
      lastReferenceAt = Date.now()
    }
    if (isManagerRole(who.role)) {
      await (await import('../features/tasks/repo')).refreshTasks()
      await (await import('../features/attendance/repo')).refreshAttendance()
      await (await import('../features/stock/repo')).refreshStock()
    }
    failures = 0
    setState({ phase: problem ? 'error' : 'idle', lastOkAt: new Date().toISOString(), problem })
  } catch (e) {
    failures++
    setState({ phase: 'error', problem })
    if (!(e instanceof SyncError && e.transient)) console.error('sync failed', e)
  }
}

/** Runs a round now (or right after the one in progress) and resolves when it is done. */
export function syncNow(): Promise<void> {
  if (isDemo || !me) return Promise.resolve()
  if (running) {
    again = true
    return running
  }
  running = round().finally(() => {
    running = null
    if (again) {
      again = false
      schedule(0)
    } else {
      schedule(nextDelay())
    }
  })
  return running
}

/** Every 30 s while the app is open; after failures, waits longer (up to 2 minutes). */
function nextDelay() {
  return failures === 0 ? 30_000 : Math.min(120_000, 5_000 * 2 ** (failures - 1))
}

function schedule(ms: number) {
  window.clearTimeout(timer)
  if (!me) return
  timer = window.setTimeout(() => {
    if (document.visibilityState === 'visible' || ms < 30_000) void syncNow()
    else schedule(30_000)
  }, ms)
}

/** Called after every change on this device: sends it a moment later (typing) or at once (send, approve). */
export function syncSoon(urgent = false) {
  if (isDemo || !me) return
  if (running) {
    again = true
    return
  }
  schedule(urgent ? 0 : 1500)
}

const wake = () => {
  if (document.visibilityState !== 'visible') return
  lastReferenceAt = 0
  void syncNow()
}

/** Starts keeping this device in step for the signed-in person. */
export function startSync(employee: Employee) {
  if (isDemo) return
  me = employee
  window.addEventListener('online', wake)
  document.addEventListener('visibilitychange', wake)
  void syncNow()
}

export function stopSync() {
  me = null
  lastReferenceAt = 0
  window.clearTimeout(timer)
  window.removeEventListener('online', wake)
  document.removeEventListener('visibilitychange', wake)
  setState({ phase: 'idle', problem: null })
}


/** A sheet may name a generator or zone added on another device since the lists were read. */
async function listsMissing(): Promise<boolean> {
  const [gens, zones, reports, sheets] = await Promise.all([db.generators.toArray(), db.zones.toArray(), db.siteReports.toArray(), db.distributionSheets.toArray()])
  const g = new Set(gens.map((x) => x.id))
  const z = new Set(zones.map((x) => x.id))
  return reports.some((r) => r.generators.some((l) => !g.has(l.generatorId))) || sheets.some((s) => s.zones.some((e) => !z.has(e.zoneId)))
}

// ---------- Live view: a sheet being filled right now ----------
let liveUsers = 0
let liveTimer: number | undefined
let liveBusy = false
let liveChannel: { unsubscribe(): unknown } | null = null

/** Brings back only the sheets (no lists), quickly; used while the manager watches today. */
async function pullLive() {
  if (!me || liveBusy || running || document.visibilityState !== 'visible' || !navigator.onLine) return
  liveBusy = true
  try {
    for (const spec of KINDS) if (spec.readers.includes(me.role)) await pullSheets(spec)
    if (await listsMissing()) await pullReference()
  } catch {
    // The usual round tries again.
  } finally {
    liveBusy = false
  }
}

function startLive() {
  liveTimer = window.setInterval(() => void pullLive(), LIVE_EVERY_MS)
  const sb = getSupabase()
  if (!sb) return
  // Instant when the project has Realtime on for these tables (update-6.sql); the timer covers the rest.
  try {
    const ch = sb.channel('m2-live-sheets')
    for (const spec of KINDS) ch.on('postgres_changes', { event: '*', schema: 'public', table: spec.header }, () => void pullLive())
    ch.subscribe()
    liveChannel = ch
  } catch {
    liveChannel = null
  }
}

function stopLive() {
  window.clearInterval(liveTimer)
  liveTimer = undefined
  if (liveChannel) {
    const sb = getSupabase()
    void (sb ? sb.removeChannel(liveChannel as never) : liveChannel.unsubscribe())
    liveChannel = null
  }
}

/** While a screen showing a day still being filled is open, keeps it up to date within seconds. */
export function useLiveSheets(active: boolean) {
  useEffect(() => {
    if (!active || isDemo) return
    if (liveUsers++ === 0) startLive()
    void pullLive()
    return () => {
      if (--liveUsers === 0) stopLive()
    }
  }, [active])
}

type Parked = Partial<Record<SheetKind, SheetDoc[]>>
const parkedKey = (employeeId: string) => `parked:${employeeId}`

/**
 * Before the first screen after signing in. If someone else used this device before, their sheets
 * are cleared from the screens, but anything of theirs not on the server yet is put aside for them
 * (never deleted) and goes back in when they sign in here again. Then the lists and sheets are
 * loaded once, so the first screen is already complete. Gives up waiting after a few seconds on a
 * slow connection.
 */
export async function prepareDevice(employee: Employee, waitMs = 10_000): Promise<void> {
  if (isDemo) return
  const previous = await getMeta<string>('device-user')
  if (previous !== employee.id) {
    await db.transaction('rw', [db.siteReports, db.distributionSheets, db.outbox, db.meta], async () => {
      if (previous) {
        const parked = (await getMeta<Parked>(parkedKey(previous))) ?? {}
        let any = false
        for (const spec of KINDS) {
          const unsent = await spec.table.filter(hasUnsent).toArray()
          if (!unsent.length) continue
          any = true
          // One copy per day: the newer one wins.
          const byDay = new Map((parked[spec.kind] ?? []).map((d) => [spec.dateOf(d), d]))
          for (const d of unsent) {
            const old = byDay.get(spec.dateOf(d))
            if (!old || old.updatedAt <= d.updatedAt) byDay.set(spec.dateOf(d), d)
          }
          parked[spec.kind] = [...byDay.values()]
        }
        if (any) await setMeta(parkedKey(previous), parked)
      }
      await db.siteReports.clear()
      await db.distributionSheets.clear()
      await db.outbox.clear()
      for (const spec of KINDS) await deleteMeta(`pull:${spec.kind}`)
      // This person's own unsent work from an earlier visit: back in, to be sent now.
      const mine = await getMeta<Parked>(parkedKey(employee.id))
      if (mine) {
        for (const spec of KINDS) if (mine[spec.kind]?.length) await spec.table.bulkPut(mine[spec.kind]!)
        await deleteMeta(parkedKey(employee.id))
      }
      await setMeta('device-user', employee.id)
    })
  }
  me = employee
  await Promise.race([syncNow(), new Promise((r) => setTimeout(r, waitMs))])
}

/** Before signing out: one last try to send what is waiting (a few seconds at most). */
export async function flushBeforeSignOut(waitMs = 8_000): Promise<void> {
  if (isDemo || !me || !navigator.onLine) return
  await Promise.race([syncNow(), new Promise((r) => setTimeout(r, waitMs))])
}
