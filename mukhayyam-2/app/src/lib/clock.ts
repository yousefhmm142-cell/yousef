/**
 * Server time without trusting the phone clock.
 * Every time we reach the server we measure the gap between its clock and ours,
 * and from then on "now" means the phone clock corrected by that gap, even offline.
 */
const KEY = 'm2-clock-offset'

let offsetMs = readOffset()

function readOffset(): number {
  try {
    const v = Number(localStorage.getItem(KEY))
    return Number.isFinite(v) ? v : 0
  } catch {
    return 0
  }
}

export function serverNow(): Date {
  return new Date(Date.now() + offsetMs)
}

export function clockOffsetMs(): number {
  return offsetMs
}

/** fetchServerTime must return the server's current time; the round trip is split in half. */
export async function syncClock(fetchServerTime: () => Promise<Date>): Promise<void> {
  const sentAt = Date.now()
  const server = await fetchServerTime()
  const receivedAt = Date.now()
  offsetMs = Math.round(server.getTime() - (sentAt + receivedAt) / 2)
  try {
    localStorage.setItem(KEY, String(offsetMs))
  } catch {
    // Private mode: the offset still applies for this session.
  }
}
