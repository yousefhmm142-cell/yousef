import { useSyncExternalStore } from 'react'

// The person's own text size and font. Saved on this device, painted before the page (public/theme.js).

export type TextSize = 'sm' | 'md' | 'lg' | 'xl'
export type FontChoice = 'almarai' | 'system'

export const TEXT_SIZES: ReadonlyArray<{ value: TextSize; label: string }> = [
  { value: 'sm', label: 'أصغر' },
  { value: 'md', label: 'عادي' },
  { value: 'lg', label: 'كبير' },
  { value: 'xl', label: 'كبير جداً' },
]

export const FONTS: ReadonlyArray<{ value: FontChoice; label: string; css: string }> = [
  { value: 'almarai', label: 'المرح', css: "'Almarai', system-ui, sans-serif" },
  { value: 'system', label: 'خط الجهاز', css: 'system-ui, Tahoma, Arial, sans-serif' },
]

const read = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
  try {
    const v = localStorage.getItem(key) as T | null
    return v && allowed.includes(v) ? v : fallback
  } catch {
    return fallback
  }
}

const listeners = new Set<() => void>()
let size: TextSize = read('m2-size', ['sm', 'md', 'lg', 'xl'], 'md')
let font: FontChoice = read('m2-font', ['almarai', 'system'], 'almarai')

function apply() {
  const root = document.documentElement
  if (size === 'md') delete root.dataset.size
  else root.dataset.size = size
  if (font === 'almarai') delete root.dataset.font
  else root.dataset.font = font
  listeners.forEach((l) => l())
}

export function setTextSize(v: TextSize) {
  size = v
  try {
    localStorage.setItem('m2-size', v)
  } catch {
    // Only on this visit.
  }
  apply()
}

export function setFont(v: FontChoice) {
  font = v
  try {
    localStorage.setItem('m2-font', v)
  } catch {
    // Only on this visit.
  }
  apply()
}

const subscribe = (cb: () => void) => {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export const useTextSize = () => useSyncExternalStore(subscribe, () => size)
export const useFont = () => useSyncExternalStore(subscribe, () => font)

// ---------- A short buzz on the phone when something is saved (plan 2, V8) ----------
let haptics: boolean = read('m2-haptics', ['on', 'off'], 'on') === 'on'

export function setHaptics(on: boolean) {
  haptics = on
  try {
    localStorage.setItem('m2-haptics', on ? 'on' : 'off')
  } catch {
    // Only on this visit.
  }
  listeners.forEach((l) => l())
}

export const useHaptics = () => useSyncExternalStore(subscribe, () => haptics)

/** 10ms on a touch phone, when the person has not turned it off. Nothing on a computer. */
export function buzz() {
  try {
    if (haptics && 'vibrate' in navigator && matchMedia('(pointer: coarse)').matches) navigator.vibrate(10)
  } catch {
    // Not supported: nothing to do.
  }
}
