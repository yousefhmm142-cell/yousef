import type { Tone } from '../../ui/primitives'

// Seals: a roll holds ~100 numbered seals; they are handed out in batches of ~10 to technicians,
// and each one ends up used (with the tableau it was fitted on), damaged or lost.

export type SealStatus = 'in_stock' | 'issued' | 'used' | 'damaged' | 'lost'

export interface SealRoll {
  id: string
  fromNo: number
  toNo: number
  receivedOn: string
  note: string
}

export interface SealBatch {
  id: string
  rollId: string
  batchNo: number
  technicianId: string
  issuedOn: string
  note: string
}

export interface Seal {
  sealNo: number
  rollId: string
  status: SealStatus
  batchId: string | null
  batchPos: number | null
  technicianId: string | null
  issuedOn: string | null
  usedOn: string | null
  details: string
  boardNo: string
}

export const sealStatusInfo: Record<SealStatus, { label: string; tone: Tone }> = {
  in_stock: { label: 'في المخزن', tone: 'neutral' },
  issued: { label: 'عند الفني', tone: 'warn' },
  used: { label: 'مستخدم', tone: 'ok' },
  damaged: { label: 'تالف', tone: 'danger' },
  lost: { label: 'ضائع', tone: 'danger' },
}

const ORDINALS = [
  '', 'الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة', 'السابعة', 'الثامنة', 'التاسعة', 'العاشرة',
  'الحادية عشرة', 'الثانية عشرة', 'الثالثة عشرة', 'الرابعة عشرة', 'الخامسة عشرة', 'السادسة عشرة', 'السابعة عشرة', 'الثامنة عشرة', 'التاسعة عشرة', 'العشرون',
]
/** 1 -> «الأولى», 10 -> «العاشرة» (the words used in her Excel files). */
export const ordinalWord = (n: number) => ORDINALS[n] || `رقم ${n}`

// ---------- Typing and pasting numbers ----------
const DIGITS = /[٠-٩۰-۹]/g
/** Arabic-Indic digits to 0-9. */
export const latinDigits = (text: string) =>
  text.replace(DIGITS, (d) => String(d.charCodeAt(0) >= 0x06f0 ? d.charCodeAt(0) - 0x06f0 : d.charCodeAt(0) - 0x0660))

export interface ParsedSeals {
  numbers: number[]
  duplicates: number[]
  bad: string[]
}

/**
 * Every seal number in a typed or pasted text: «181365-181388 181355», one per line, with the
 * letters printed on the seal («WK206022»). A number is 5 to 7 digits.
 */
export function parseSealNumbers(text: string): ParsedSeals {
  const tokens = latinDigits(text).match(/\d+/g) ?? []
  const seen = new Set<number>()
  const numbers: number[] = []
  const duplicates: number[] = []
  const bad: string[] = []
  for (const t of tokens) {
    if (t.length < 5 || t.length > 7) {
      bad.push(t)
      continue
    }
    const n = Number(t)
    if (seen.has(n)) duplicates.push(n)
    else {
      seen.add(n)
      numbers.push(n)
    }
  }
  return { numbers, duplicates, bad }
}

// ---------- The details line ----------
export interface UseDetails {
  board: string
  work: string
  subscriber: string
}

/** «طبلون 361 إعادة شبك (حمزة الداية)», the way her Excel sheet reads. */
export function composeDetails({ board, work, subscriber }: UseDetails): string {
  return [board.trim() ? `طبلون ${board.trim()}` : '', work.trim(), subscriber.trim() ? `(${subscriber.trim()})` : ''].filter(Boolean).join(' ')
}

/** Splits a saved details line back into the three boxes (best effort, for editing). */
export function splitDetails(details: string, boardNo: string): UseDetails {
  let rest = details.trim()
  const sub = /\(([^()]*)\)\s*$/.exec(rest)
  const subscriber = sub ? sub[1]!.trim() : ''
  if (sub) rest = rest.slice(0, sub.index).trim()
  let board = boardNo
  if (board) {
    const m = new RegExp(`^طبلون(?:ات)?\\s*(?:رقم\\s*)?${board.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`).exec(rest)
    if (m) rest = rest.slice(m[0].length).trim()
    else board = ''
  }
  return { board, work: rest, subscriber }
}

export const WORK_CHOICES = [
  'تفتيش', 'تركيب اشتراك', 'إضافة مشترك', 'إعادة شبك', 'فك ساعة فحص', 'تركيب ساعة فحص',
  'فصل خط', 'نقل مشترك', 'تبديل ساعة', 'رفع قدرة', 'صيانة', 'تغذية طبلون',
]

// ---------- Searching ----------
/** Arabic text compared without diacritics, hamza, taa marbuta and spaces. */
export const fold = (text: string) =>
  latinDigits(text)
    .toLowerCase()
    .replace(/[ً-ٟـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim()

export interface SealData {
  rolls: SealRoll[]
  batches: SealBatch[]
  seals: Seal[]
  names: Map<string, string>
}

export interface SearchFilters {
  technicianId: string | null
  /** 'open' = handed out and not used yet. */
  status: SealStatus | 'open' | null
  rollId: string | null
  period: 'all' | 'today' | 'week' | 'month'
}
export const noFilters: SearchFilters = { technicianId: null, status: null, rollId: null, period: 'all' }

export interface SealGroup {
  key: string
  kind: 'batch' | 'stock'
  roll: SealRoll
  batch: SealBatch | null
  technicianId: string | null
  /** Every seal of the batch (or just the matches, for stock). */
  seals: Seal[]
  matched: Set<number>
  date: string
}

export const hasQuery = (query: string, f: SearchFilters) => query.trim() !== '' || f.technicianId !== null || f.status !== null || f.rollId !== null || f.period !== 'all'

interface Token {
  kind: 'num' | 'board' | 'text'
  value: string
}

/** «1813 طبلون 361 أحمد» -> a seal prefix, a tableau, a word. */
export function tokenize(query: string): Token[] {
  const q = latinDigits(query).replace(/\bwk\s*/gi, '')
  const out: Token[] = []
  const withoutBoards = q.replace(/طبلون(?:ات)?\s*(?:رقم\s*)?(\S+)/g, (_m, b: string) => {
    out.push({ kind: 'board', value: fold(b) })
    return ' '
  })
  for (const w of withoutBoards.split(/\s+/).filter(Boolean)) out.push(/^\d+$/.test(w) ? { kind: 'num', value: w } : { kind: 'text', value: fold(w) })
  return out
}

interface Indexed {
  seal: Seal
  no: string
  board: string
  hay: string
  date: string
}

function indexSeals(data: SealData): Indexed[] {
  return data.seals.map((seal) => ({
    seal,
    no: String(seal.sealNo),
    board: fold(seal.boardNo),
    hay: fold(`${data.names.get(seal.technicianId ?? '') ?? ''} ${seal.details} ${sealStatusInfo[seal.status].label}`),
    date: seal.usedOn ?? seal.issuedOn ?? '',
  }))
}

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

function inPeriod(date: string, period: SearchFilters['period'], today: string): boolean {
  if (period === 'all') return true
  if (!date) return false
  if (period === 'today') return date === today
  if (period === 'week') return date >= addDays(today, -6)
  return date >= `${today.slice(0, 8)}01`
}

function matchesToken(x: Indexed, t: Token): boolean {
  if (t.kind === 'board') return x.board === t.value || x.board.split(' ').includes(t.value)
  if (t.kind === 'num') {
    // The first digits of a seal (the whole roll), a whole number, or the tableau number.
    if (t.value.length >= 2 && x.no.startsWith(t.value)) return true
    if (t.value.length >= 4 && x.no.includes(t.value)) return true
    return x.board === t.value || x.board.split(' ').includes(t.value)
  }
  return x.hay.includes(t.value)
}

export type GroupSort = 'newest' | 'oldest' | 'seal' | 'technician'

/**
 * The groups (batches) that hold a seal matching the search words and filters, with all their
 * seals so the whole batch shows. With nothing typed, the latest batches.
 */
export function searchSeals(data: SealData, query: string, filters: SearchFilters, today: string, sort: GroupSort = 'newest'): { groups: SealGroup[]; matches: number } {
  const tokens = tokenize(query)
  const idx = indexSeals(data)
  const matched = idx.filter((x) => {
    if (filters.technicianId && x.seal.technicianId !== filters.technicianId) return false
    if (filters.rollId && x.seal.rollId !== filters.rollId) return false
    if (filters.status === 'open' ? x.seal.status !== 'issued' : filters.status && x.seal.status !== filters.status) return false
    if (!inPeriod(x.date, filters.period, today)) return false
    return tokens.every((t) => matchesToken(x, t))
  })
  const active = hasQuery(query, filters)
  const rollById = new Map(data.rolls.map((r) => [r.id, r]))
  const batchById = new Map(data.batches.map((b) => [b.id, b]))
  const bySeals = new Map<string, Seal[]>()
  for (const s of data.seals) if (s.batchId) (bySeals.get(s.batchId) ?? bySeals.set(s.batchId, []).get(s.batchId)!).push(s)

  const groups = new Map<string, SealGroup>()
  let matches = 0
  for (const x of matched) {
    const s = x.seal
    const roll = rollById.get(s.rollId)
    if (!roll) continue
    if (s.batchId && batchById.has(s.batchId)) {
      const batch = batchById.get(s.batchId)!
      const g =
        groups.get(batch.id) ??
        (groups
          .set(batch.id, {
            key: batch.id,
            kind: 'batch',
            roll,
            batch,
            technicianId: batch.technicianId,
            seals: (bySeals.get(batch.id) ?? []).sort((a, b) => (a.batchPos ?? 0) - (b.batchPos ?? 0)),
            matched: new Set(),
            date: batch.issuedOn,
          })
          .get(batch.id)!)
      g.matched.add(s.sealNo)
      matches++
    } else {
      // Not handed out (or damaged straight from stock): one group per roll, matches only.
      const key = `stock:${roll.id}`
      const g = groups.get(key) ?? (groups.set(key, { key, kind: 'stock', roll, batch: null, technicianId: null, seals: [], matched: new Set(), date: roll.receivedOn }).get(key)!)
      g.seals.push(s)
      g.matched.add(s.sealNo)
      matches++
    }
  }
  let list = [...groups.values()]
  for (const g of list) if (g.kind === 'stock') g.seals.sort((a, b) => a.sealNo - b.sealNo)
  const name = (g: SealGroup) => data.names.get(g.technicianId ?? '') ?? ''
  const minSeal = (g: SealGroup) => Math.min(...g.seals.map((s) => s.sealNo))
  const cmp: Record<GroupSort, (a: SealGroup, b: SealGroup) => number> = {
    newest: (a, b) => b.date.localeCompare(a.date) || (b.batch?.batchNo ?? 0) - (a.batch?.batchNo ?? 0),
    oldest: (a, b) => a.date.localeCompare(b.date) || (a.batch?.batchNo ?? 0) - (b.batch?.batchNo ?? 0),
    seal: (a, b) => minSeal(a) - minSeal(b),
    technician: (a, b) => name(a).localeCompare(name(b), 'ar') || b.date.localeCompare(a.date),
  }
  list.sort(cmp[sort])
  if (!active) list = list.filter((g) => g.kind === 'batch')
  return { groups: list, matches }
}

// ---------- Counting ----------
export interface RollStats {
  total: number
  inStock: number
  issued: number
  used: number
  damaged: number
  lost: number
  batches: number
}

export function rollStats(roll: SealRoll, seals: Seal[], batches: SealBatch[]): RollStats {
  const mine = seals.filter((s) => s.rollId === roll.id)
  const count = (st: SealStatus) => mine.filter((s) => s.status === st).length
  return {
    total: mine.length || roll.toNo - roll.fromNo + 1,
    inStock: count('in_stock'),
    issued: count('issued'),
    used: count('used'),
    damaged: count('damaged'),
    lost: count('lost'),
    batches: batches.filter((b) => b.rollId === roll.id).length,
  }
}

export function totals(seals: Seal[]) {
  const c = { inStock: 0, issued: 0, used: 0, lost: 0, damaged: 0 }
  for (const s of seals) {
    if (s.status === 'in_stock') c.inStock++
    else if (s.status === 'issued') c.issued++
    else if (s.status === 'used') c.used++
    else if (s.status === 'damaged') c.damaged++
    else c.lost++
  }
  return c
}
