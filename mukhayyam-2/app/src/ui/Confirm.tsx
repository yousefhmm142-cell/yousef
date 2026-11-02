import { TriangleAlert } from 'lucide-react'
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { Dialog } from './Dialog'
import { Button } from './primitives'

export interface ConfirmOptions {
  title: string
  /** What will happen, in a sentence or two. */
  message?: ReactNode
  /** The word on the button that goes ahead (default «تأكيد»). */
  confirmLabel?: string
  /** A step that cannot be taken back: the button is red. */
  danger?: boolean
}

type Ask = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<Ask>(() => Promise.resolve(false))

/**
 * «هل أنت متأكد؟» as a proper window instead of pressing the same button twice:
 * `if (await confirm({ title: 'تسجيل الخروج؟' })) …`. Cancel, Esc or a tap outside answers no.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  const answer = useRef<((yes: boolean) => void) | null>(null)

  const ask = useCallback<Ask>((o) => {
    // A second question while one is open cancels the first.
    answer.current?.(false)
    return new Promise<boolean>((resolve) => {
      answer.current = resolve
      setOptions(o)
    })
  }, [])

  const close = (yes: boolean) => {
    const done = answer.current
    answer.current = null
    setOptions(null)
    done?.(yes)
  }

  const value = useMemo(() => ask, [ask])
  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {options && (
        <Dialog
          open
          onClose={() => close(false)}
          title={options.title}
          footer={
            <>
              <Button variant="ghost" onClick={() => close(false)}>إلغاء</Button>
              <Button variant={options.danger ? 'danger' : 'primary'} onClick={() => close(true)} autoFocus>
                {options.confirmLabel ?? 'تأكيد'}
              </Button>
            </>
          }
        >
          <div className="confirm-body">
            <span className={`confirm-ico${options.danger ? ' danger' : ''}`} aria-hidden="true"><TriangleAlert size={22} /></span>
            <div>
              <b>هل أنت متأكد؟</b>
              {options.message && <p>{options.message}</p>}
            </div>
          </div>
        </Dialog>
      )}
    </ConfirmContext.Provider>
  )
}

export const useConfirm = () => useContext(ConfirmContext)
