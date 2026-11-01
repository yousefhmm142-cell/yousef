import Dexie, { type EntityTable } from 'dexie'
import type { DistributionSheet, Zone } from '../features/distribution/model'
import type { AlertSettings, FuelType, Generator, SiteReport } from '../features/generation/model'
import type { Leave, Punch, Schedule } from '../features/attendance/rules'
import type { Task, TaskType } from '../features/tasks/model'
import type { StockItem, StockMove } from '../features/stock/model'
import type { Seal, SealBatch, SealRoll } from '../features/seals/model'
import type { Employee } from '../types'

/** Small key-value rows: the signed-in session, cached profile, last sync time. */
export interface MetaRow {
  key: string
  value: unknown
}

/**
 * Changes made on this device that the server has not received yet.
 * Each one carries a client id so sending it twice still saves it once.
 */
export interface OutboxRow {
  seq?: number
  clientId: string
  table: string
  payload: unknown
  deviceTime: string
  offline: boolean
  attempts: number
  lastError?: string
}

export interface Holiday {
  date: string
  name: string
}

/** The printed QR sheet: its code is the last part of the address it opens. */
export interface AttendancePoint {
  id: number
  name: string
  code: string
  isActive: boolean
}

/** A phone allowed to record attendance for one person. tokenHash is used in demo mode only. */
export interface AttendanceDevice {
  id: string
  employeeId: string
  label: string
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
  tokenHash?: string
}

/** Demo mode only: sample logins that never leave this device. */
export interface DemoAccount {
  phone: string
  pin: string
  employeeId: string
}

class AppDatabase extends Dexie {
  employees!: EntityTable<Employee, 'id'>
  meta!: EntityTable<MetaRow, 'key'>
  outbox!: EntityTable<OutboxRow, 'seq'>
  demoAccounts!: EntityTable<DemoAccount, 'phone'>
  generators!: EntityTable<Generator, 'id'>
  fuelTypes!: EntityTable<FuelType, 'id'>
  alertSettings!: EntityTable<AlertSettings, 'id'>
  siteReports!: EntityTable<SiteReport, 'id'>
  zones!: EntityTable<Zone, 'id'>
  distributionSheets!: EntityTable<DistributionSheet, 'id'>
  taskTypes!: EntityTable<TaskType, 'id'>
  tasks!: EntityTable<Task, 'id'>
  schedules!: EntityTable<Schedule, 'id'>
  punches!: EntityTable<Punch, 'id'>
  leaves!: EntityTable<Leave, 'id'>
  holidays!: EntityTable<Holiday, 'date'>
  attendancePoints!: EntityTable<AttendancePoint, 'id'>
  attendanceDevices!: EntityTable<AttendanceDevice, 'id'>
  stockItems!: EntityTable<StockItem, 'id'>
  stockMoves!: EntityTable<StockMove, 'id'>
  sealRolls!: EntityTable<SealRoll, 'id'>
  sealBatches!: EntityTable<SealBatch, 'id'>
  seals!: EntityTable<Seal, 'sealNo'>

  constructor() {
    super('mukhayyam2')
    this.version(1).stores({
      employees: 'id, phone, role',
      meta: 'key',
      outbox: '++seq, clientId',
      demoAccounts: 'phone',
    })
    this.version(2).stores({
      generators: 'id',
      fuelTypes: 'id',
      alertSettings: 'id',
      siteReports: 'id, &reportDate, status',
    })
    this.version(3).stores({
      zones: 'id',
      distributionSheets: 'id, &sheetDate, status',
    })
    this.version(4).stores({
      taskTypes: 'id',
      tasks: 'id, number, status, assigneeId, &linkToken',
    })
    this.version(5).stores({
      schedules: 'id',
      punches: 'id, employeeId, at',
      leaves: 'id, employeeId',
      holidays: 'date',
      attendancePoints: 'id',
      attendanceDevices: 'id, employeeId, tokenHash',
    })
    this.version(6).stores({
      stockItems: 'id',
      stockMoves: 'id, itemId, taskId, at',
    })
    this.version(7).stores({
      sealRolls: 'id, fromNo',
      sealBatches: 'id, rollId, technicianId',
      seals: 'sealNo, rollId, batchId, technicianId, status, boardNo',
    })
  }
}

export const db = new AppDatabase()

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value })
}

export async function deleteMeta(key: string): Promise<void> {
  await db.meta.delete(key)
}
