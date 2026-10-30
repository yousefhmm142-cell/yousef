import { CircleAlert, CircleCheck } from 'lucide-react'
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'

type ToastTone = 'ok' | 'danger'
interface ToastItem {
  id: number
  text: string
  tone: ToastTone
}

const ToastContext = createContext<(text: string, tone?: ToastTone) => void>(() => undefined)

/** Short confirmations ("اعتُمد التقرير") that fade by themselves and are read out by screen readers. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useRef(1)

  const show = useCallback((text: string, tone: ToastTone = 'ok') => {
    const id = nextId.current++
    setItems((all) => [...all.slice(-2), { id, text, tone }])
    window.setTimeout(() => setItems((all) => all.filter((t) => t.id !== id)), 3200)
  }, [])

  const value = useMemo(() => show, [show])
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            {t.tone === 'ok' ? <CircleCheck size={18} /> : <CircleAlert size={18} />}
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)
