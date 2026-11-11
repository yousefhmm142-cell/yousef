import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
/** Only show the swipe hint when this table really has hidden columns. */
export function ScrollTable({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [overflow, setOverflow] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    let alive = true
    const check = () => {
      if (alive) setOverflow(el.scrollWidth > el.clientWidth + 1)
    }
    check()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(check)
    observer?.observe(el)
    const table = el.querySelector('table')
    if (table) observer?.observe(table)
    window.addEventListener('resize', check)
    void document.fonts?.ready.then(check)
    return () => {
      alive = false
      observer?.disconnect()
      window.removeEventListener('resize', check)
    }
  }, [])
  return (
    <>
      {overflow && (
        <div className="report-scroll-hint" aria-hidden="true">
          اسحب الجدول يمين ويسار لعرض باقي الأعمدة
        </div>
      )}
      <div
        ref={ref}
        className="table-wrap"
        tabIndex={overflow ? 0 : -1}
        role="region"
        aria-label={`جدول ${label}${overflow ? '، مرّر لعرض باقي الأعمدة' : ''}`}
      >
        {children}
      </div>
    </>
  )
}
