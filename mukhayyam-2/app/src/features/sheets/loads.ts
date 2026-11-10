// Three-phase loads, as typed on site for generators and for distribution zones.

export type LoadUnit = 'A' | 'kW'
export type Loads = [number | null, number | null, number | null]

export const LOAD_UNIT_OPTIONS: ReadonlyArray<{ value: LoadUnit; label: string }> = [
  { value: 'A', label: 'أمبير' },
  { value: 'kW', label: 'كيلوواط' },
]

export const PHASES = ['L1', 'L2', 'L3'] as const

/** The mean of every reading typed: the three phases first, then any extra reading added on site. Null until the three phases are typed. */
export function readingsAverage(loads: Loads, extra: ReadonlyArray<number | null> = []): number | null {
  if (!loadsComplete(loads)) return null
  const all = [...loads, ...extra.filter((x): x is number => x !== null)]
  return Math.round((all.reduce((a, b) => a + b, 0) / all.length) * 10) / 10
}

export const emptyLoads = (): Loads => [null, null, null]

export const loadsComplete = (loads: Loads): loads is [number, number, number] => loads.every((l) => l !== null)

/** The mean of the three phases, to one decimal: the single figure the paper sheet carries. Null until all three are typed. */
export function loadAverage(loads: Loads): number | null {
  if (!loadsComplete(loads)) return null
  return Math.round(((loads[0] + loads[1] + loads[2]) / 3) * 10) / 10
}

/** Gap between the strongest and weakest phase, as a percentage of the strongest. Null until all three are typed. */
export function phaseImbalancePct(loads: Loads): number | null {
  if (!loadsComplete(loads)) return null
  const max = Math.max(...loads)
  if (max <= 0) return null
  return ((max - Math.min(...loads)) / max) * 100
}

// ---------- Loads by hour (the paper's table: 9 · 12 · 3 · 6 · 9 · 12) ----------

/** The six bands of the day. «9» is 7→9, «12» is 9→12, «3» is 12→3 … the last «12» is 9 at night → midnight. */
export const BANDS = [
  { label: '9', range: '7–9', from: 7 * 60, to: 9 * 60 },
  { label: '12', range: '9–12', from: 9 * 60, to: 12 * 60 },
  { label: '3', range: '12–3', from: 12 * 60, to: 15 * 60 },
  { label: '6', range: '3–6', from: 15 * 60, to: 18 * 60 },
  { label: '9', range: '6–9', from: 18 * 60, to: 21 * 60 },
  { label: '12', range: '9–12', from: 21 * 60, to: 24 * 60 },
] as const

/** Distribution: three readings in every band (a zone). */
export type BandReadings = Loads[]
/** Generation: one reading in every band (a generator). */
export type BandValues = Array<number | null>

export const emptyBandReadings = (): BandReadings => BANDS.map(() => emptyLoads())
export const emptyBandValues = (): BandValues => BANDS.map(() => null)

const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
/** From what the server or an older draft holds (nothing, or a list that may be short). */
export const readBandReadings = (raw: unknown): BandReadings =>
  BANDS.map((_, i) => {
    const row = Array.isArray(raw) && Array.isArray(raw[i]) ? (raw[i] as unknown[]) : []
    return [toNum(row[0]), toNum(row[1]), toNum(row[2])]
  })
export const readBandValues = (raw: unknown): BandValues => BANDS.map((_, i) => (Array.isArray(raw) ? toNum(raw[i]) : null))

export const hasBandReadings = (b: BandReadings | undefined): boolean => !!b && b.some((l) => l.some((x) => x !== null))
export const hasBandValues = (b: BandValues | undefined): boolean => !!b && b.some((x) => x !== null)

const round1 = (n: number) => Math.round(n * 10) / 10

/** The mean of a band's three readings, once all three are typed. */
export const bandAverage = (l: Loads): number | null => loadAverage(l)

/** The mean of the whole day: of the bands that have all three readings. */
export function bandsDayAverage(b: BandReadings | undefined): number | null {
  const avgs = (b ?? []).map(bandAverage).filter((x): x is number => x !== null)
  return avgs.length ? round1(avgs.reduce((s, x) => s + x, 0) / avgs.length) : null
}

/** The mean of the bands' single readings (generation), skipping the empty ones. */
export function valuesDayAverage(b: BandValues | undefined): number | null {
  const xs = (b ?? []).filter((x): x is number => x !== null)
  return xs.length ? round1(xs.reduce((s, x) => s + x, 0) / xs.length) : null
}

/** Which bands a piece of the day [a, b] (minutes from midnight) touches. */
export const bandsInSpan = (a: number, b: number): number[] => BANDS.flatMap((band, i) => (Math.max(a, band.from) < Math.min(b, band.to) ? [i] : []))
