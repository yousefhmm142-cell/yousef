import { X } from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode } from 'react'

interface DialogProps {
  open: boolean
  onClose(): void
  title: string
  children: ReactNode
  footer?: ReactNode
  /** Wide, two-part window: a live summary on one side (dark), the form on the other. */
  aside?: ReactNode
  subtitle?: string
  icon?: ReactNode
  className?: string
}

/** Native modal: focus is trapped, Esc closes, tapping outside closes. */
export function Dialog({ open, onClose, title, children, footer, aside, subtitle, icon, className }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className={`dialog${aside ? ' dialog-split' : ''}${className ? ` ${className}` : ''}`}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
    >
      <div className="dialog-panel">
        <div className="dialog-main">
          <header className="dialog-head">
            {icon && <span className="dialog-icon" aria-hidden="true">{icon}</span>}
            <div className="dialog-titles">
              <h2 id={titleId}>{title}</h2>
              {subtitle && <p>{subtitle}</p>}
            </div>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="إغلاق">
              <X size={18} />
            </button>
          </header>
          <div className="dialog-body">{children}</div>
          {footer && <footer className="dialog-foot">{footer}</footer>}
        </div>
        {aside && <aside className="dialog-aside">{aside}</aside>}
      </div>
    </dialog>
  )
}
