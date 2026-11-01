import { useSyncExternalStore } from 'react'
import { isDemo } from '../config'
import type { Employee } from '../types'
import { getSupabase } from './supabase'

// Who has the site open right now. Each signed-in device joins one shared channel and says who it
// is; the manager's home page lists them. Nothing is stored: when a tab closes, the person leaves
// the list within seconds. (Works on any Supabase project; no table or setting needed.)

export interface Present {
  id: string
  name: string
  role: string
  title: string
  since: string
}

let channel: { unsubscribe(): unknown } | null = null
let people: Present[] = []
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function startPresence(employee: Employee) {
  mine = { id: employee.id, name: employee.fullName, role: employee.role, title: employee.jobTitle ?? '', since: new Date().toISOString() }
  mergedFrom = null
  emit()
  if (isDemo) return
  const sb = getSupabase()
  if (!sb || channel) return
  try {
    const ch = sb.channel('m2-presence', { config: { presence: { key: employee.id } } })
    const sync = () => {
      const state = ch.presenceState() as Record<string, Present[]>
      // One line per person, even with several devices open.
      people = Object.values(state)
        .map((metas) => metas[0])
        .filter((m): m is Present => !!m)
        .sort((a, b) => a.name.localeCompare(b.name, 'ar'))
      emit()
    }
    ch.on('presence', { event: 'sync' }, sync)
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        void ch.track({ id: employee.id, name: employee.fullName, role: employee.role, title: employee.jobTitle ?? '', since: new Date().toISOString() })
      }
    })
    channel = ch
  } catch {
    channel = null
  }
}

export function stopPresence() {
  if (channel) {
    const sb = getSupabase()
    void (sb ? sb.removeChannel(channel as never) : channel.unsubscribe())
    channel = null
  }
  people = []
  mine = null
  mergedFrom = null
  emit()
}

let mine: Present | null = null
const withMe = (list: Present[]) => (mine && !list.some((p) => p.id === mine!.id) ? [mine, ...list] : list)
let merged: Present[] = []
let mergedFrom: Present[] | null = null
const snapshot = () => {
  if (mergedFrom !== people) {
    mergedFrom = people
    merged = withMe(people)
  }
  return merged
}

/** The people who have the site open now (always including this device's person). */
export function usePresent(): Present[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    snapshot,
  )
}
