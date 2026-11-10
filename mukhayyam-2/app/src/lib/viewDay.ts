import { useSyncExternalStore } from 'react'
import { toISODate, todayISO, type ISODate } from './dates'
import { useNow } from './useNow'

// The day the manager is looking at, shared by the generation, distribution and reports pages, so
// moving between them keeps the same day. Until someone picks an earlier day it simply follows
// today (and moves on by itself after midnight). Kept for this browser tab only.

const KEY = 'm2-view-day'
let pinned: ISODate | null = read()
const listeners = new Set<() => void>()

function read(): ISODate | null {
  try {
    return sessionStorage.getItem(KEY)
  } catch {
    return null
  }
}

/** Picks a day; picking today (or later) goes back to following today. */
export function setViewDay(day: ISODate) {
  const next = day >= todayISO() ? null : day
  if (next === pinned) return
  pinned = next
  try {
    if (next) sessionStorage.setItem(KEY, next)
    else sessionStorage.removeItem(KEY)
  } catch {
    // Only a convenience.
  }
  listeners.forEach((l) => l())
}

/** Today in Gaza, refreshed every minute so an open page rolls over at midnight. */
export function useToday(): ISODate {
  return toISODate(useNow(60_000))
}

export function useViewDay(): ISODate {
  const today = useToday()
  const day = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => pinned,
  )
  return day && day < today ? day : today
}
