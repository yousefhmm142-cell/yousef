import { useCallback, useEffect, useRef, useState } from 'react'

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

const SAVE_DELAY_MS = 350

/**
 * Editing a daily form on the phone: every change is applied at once on screen and saved to the
 * device a moment later; pending typing is saved when the app goes to the background or the
 * screen closes, so nothing typed is lost.
 */
export function useDraft<T>(createInitial: () => T, save: (doc: T) => Promise<void>, alreadyStored: boolean) {
  const [doc, setDoc] = useState<T>(createInitial)
  const latest = useRef(doc)
  const timer = useRef<number | undefined>(undefined)
  const saveRef = useRef(save)
  saveRef.current = save
  const [saveState, setSaveState] = useState<SaveState>(alreadyStored ? 'saved' : 'idle')

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current)
    timer.current = undefined
    try {
      setSaveState('saving')
      await saveRef.current(latest.current)
      setSaveState('saved')
    } catch {
      setSaveState('error')
    }
  }, [])

  const update = useCallback(
    (change: (draft: T) => void) => {
      const next = structuredClone(latest.current)
      change(next)
      latest.current = next
      setDoc(next)
      setSaveState('saving')
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => void flush(), SAVE_DELAY_MS)
    },
    [flush],
  )

  useEffect(() => {
    const onHide = () => {
      if (timer.current !== undefined) void flush()
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onHide)
      onHide()
    }
  }, [flush])

  return { doc, update, flush, saveState, latest }
}

/** A button that asks once ("press again to confirm") and forgets after a few seconds. */
export function useConfirmTap(timeoutMs = 4000): [armed: boolean, arm: () => void, reset: () => void] {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const id = window.setTimeout(() => setArmed(false), timeoutMs)
    return () => window.clearTimeout(id)
  }, [armed, timeoutMs])
  return [armed, () => setArmed(true), () => setArmed(false)]
}
