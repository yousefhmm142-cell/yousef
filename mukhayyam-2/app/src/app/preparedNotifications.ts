export interface PreparedNotice { id: number; at: string; taskNumber: number; who: string }

/** RPC responses and old device caches are untrusted inputs, never render them directly. */
export function preparedNotices(value: unknown): PreparedNotice[] {
  if (!Array.isArray(value)) return []
  const ids = new Set<number>()
  return value.flatMap((row: unknown) => {
    if (!row || typeof row !== 'object') return []
    const r = row as Record<string, unknown>
    if (typeof r.id !== 'number' || !Number.isSafeInteger(r.id) || r.id < 1 || ids.has(r.id)
      || typeof r.at !== 'string' || !Number.isFinite(Date.parse(r.at))
      || typeof r.task_number !== 'number' || !Number.isSafeInteger(r.task_number) || r.task_number < 1) return []
    ids.add(r.id)
    return [{ id: r.id, at: r.at, taskNumber: r.task_number,
      who: typeof r.who === 'string' && r.who.trim() ? r.who.trim().slice(0, 160) : 'النظام' }]
  }).sort((a, b) => b.id - a.id).slice(0, 80)
}
export function readNoticeIds(value: unknown): number[] {
  return Array.isArray(value) ? [...new Set(value.filter((v): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0))].sort((a, b) => b - a).slice(0, 500) : []
}
