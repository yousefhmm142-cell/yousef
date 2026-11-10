// Small helpers shared by the translators between device documents and server rows.

/** Empty text is stored as null on the server and comes back as ''. */
export const text = (s: string) => (s.trim() ? s : null)

/** "06:00" -> "06:00" for the server, '' -> null (a draft may leave times empty). */
export const toTime = (hhmm: string) => (hhmm ? hhmm : null)

/** "06:00:00" from the server -> "06:00" as the time boxes use it. */
export const fromTime = (t: string | null) => (t ? t.slice(0, 5) : '')

/** The server sends numeric columns as numbers; this also accepts numeric text, just in case. */
export const num = (v: number | string | null | undefined): number | null =>
  v === null || v === undefined || v === '' ? null : Number(v)

/** One table of lines under a sheet, e.g. the fuel lines of a report. */
export interface ChildRows {
  table: string
  /** The column pointing at the parent, e.g. report_id. */
  parent: string
  /** Parents of these rows when they are not the sheet itself (runs under generator lines). */
  parentIds?: string[]
  rows: Array<{ id: string }>
}
