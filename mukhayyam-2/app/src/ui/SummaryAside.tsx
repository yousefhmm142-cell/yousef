import type { ReactNode } from 'react'

type Row = [label: string, value: ReactNode]

/** The dark live summary beside a form (see Dialog's `aside`). */
export function SummaryAside({ title, tag = 'قبل الحفظ', bigLabel, big, rows, more, note }: {
  title: string
  tag?: string
  bigLabel: string
  big: ReactNode
  rows: Row[]
  more?: Row[]
  note?: ReactNode
}) {
  const box = (r: Row[], cls = '') => (
    <div className={`aside-box ${cls}`}>
      {r.map(([l, v]) => <div key={l} className="aside-row"><span>{l}</span><b>{v === '' || v === null || v === undefined ? '—' : v}</b></div>)}
    </div>
  )
  return (
    <>
      <h3>{title} <span className="aside-tag">{tag}</span></h3>
      <div>
        <span className="aside-label">{bigLabel}</span>
        <div className="aside-big">{big || '—'}</div>
      </div>
      {box(rows)}
      {more && more.length > 0 && box(more, 'aside-hide-sm')}
      <div className="aside-note">
        {note}
        <span><span className="kbd">Ctrl</span> + <span className="kbd">Enter</span> للحفظ</span>
      </div>
    </>
  )
}

export const FootHint = () => <span className="foot-hint"><span className="kbd">Ctrl</span> + <span className="kbd">Enter</span> للحفظ</span>

/** Ctrl+Enter anywhere in the form saves. */
export const saveOnCtrlEnter = (save: () => void) => (e: React.KeyboardEvent) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save() }
}
