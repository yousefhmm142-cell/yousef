import { useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark'

const KEY = 'm2-theme'
const listeners = new Set<() => void>()
const barColor: Record<Theme, string> = { light: '#F3F1EE', dark: '#07080A' }

const read = (): Theme => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')

export function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', barColor[theme])
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // Not saved, still applied.
  }
  listeners.forEach((fn) => fn())
}

export function useTheme(): [Theme, () => void] {
  const theme = useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    read,
  )
  return [theme, () => setTheme(theme === 'dark' ? 'light' : 'dark')]
}
