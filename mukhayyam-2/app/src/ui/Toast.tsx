import { CircleAlert, CircleCheck } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'

type ToastTone = 'ok' | 'danger'
/** A button in the toast, e.g. «تراجع» after something that can be taken back. */
export interface ToastAction { label: string; run(): void | Promise<void> }
interface ToastItem {
  id: number
  text: string
  tone: ToastTone
  action?: ToastAction
  ms: number
}

const ToastContext = createContext<(text: string, tone?: ToastTone, action?: ToastAction) => void>(() => undefined)

/** Short confirmations ("اعتُمد التقرير") that fade by themselves and are read out by screen readers. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useRef(1)

  const show = useCallback((text: string, tone: ToastTone = 'ok', action?: ToastAction) => {
    const id = nextId.current++
    // With a button it stays longer, so there is time to press it.
    const ms = action ? 6000 : 3200
    setItems((all) => [...all.slice(-2), { id, text, tone, action, ms }])
    window.setTimeout(() => setItems((all) => all.filter((t) => t.id !== id)), ms)
  }, [])

  // Code outside React (the offline queue) speaks through this event.
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ text: string; tone?: ToastTone }>).detail
      if (d?.text) show(d.text, d.tone)
    }
    window.addEventListener('m2-toast', on)
    return () => window.removeEventListener('m2-toast', on)
  }, [show])

  const value = useMemo(() => show, [show])
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`} style={{ '--toast-ms': `${t.ms}ms` } as CSSProperties}>
            {t.tone === 'ok' ? <CircleCheck size={18} /> : <CircleAlert size={18} />}
            <span className="toast-text">{t.text}</span>
            {t.action && (
              <button type="button" className="toast-action" onClick={() => { setItems((all) => all.filter((x) => x.id !== t.id)); void t.action!.run() }}>
                {t.action.label}
              </button>
            )}
            <i className="toast-time" aria-hidden="true" />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)
