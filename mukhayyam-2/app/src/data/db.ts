import Dexie, { type EntityTable } from 'dexie'
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

  constructor() {
    super('mukhayyam2')
    this.version(1).stores({
      employees: 'id, phone, role',
      meta: 'key',
      outbox: '++seq, clientId',
      demoAccounts: 'phone',
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
