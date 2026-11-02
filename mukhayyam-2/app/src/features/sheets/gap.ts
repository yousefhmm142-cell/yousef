import { addDays, type ISODate } from '../../lib/dates'

/**
 * The site fills its days in order: today's form opens only when the day before was sent. After the
 * last sent day, the next day is the one to do first. Null when nothing stands in the way (or nothing
 * was ever sent: the very first day is free). The manager is never held by this.
 */
export function firstMissingDay(sentDays: ISODate[], date: ISODate): ISODate | null {
  const before = sentDays.filter((d) => d < date).sort()
  const last = before[before.length - 1]
  if (!last) return null
  const next = addDays(last, 1)
  return next < date ? next : null
}
