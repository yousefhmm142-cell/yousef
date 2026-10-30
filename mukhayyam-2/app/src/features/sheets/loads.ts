// Three-phase loads, as typed on site for generators and for distribution zones.

export type LoadUnit = 'A' | 'kW'
export type Loads = [number | null, number | null, number | null]

export const LOAD_UNIT_OPTIONS: ReadonlyArray<{ value: LoadUnit; label: string }> = [
  { value: 'A', label: 'أمبير' },
  { value: 'kW', label: 'كيلوواط' },
]

export const PHASES = ['L1', 'L2', 'L3'] as const

export const emptyLoads = (): Loads => [null, null, null]

export const loadsComplete = (loads: Loads): loads is [number, number, number] => loads.every((l) => l !== null)

/** Gap between the strongest and weakest phase, as a percentage of the strongest. Null until all three are typed. */
export function phaseImbalancePct(loads: Loads): number | null {
  if (!loadsComplete(loads)) return null
  const max = Math.max(...loads)
  if (max <= 0) return null
  return ((max - Math.min(...loads)) / max) * 100
}
