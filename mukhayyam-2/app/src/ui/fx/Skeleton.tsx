import { usePageVisible } from '../../lib/motion'

export function Skeleton({ kind = 'list', rows = 5, cols = 5 }: { kind?: 'cards' | 'list' | 'table'; rows?: number; cols?: number }) {
  const visible = usePageVisible()
  return <div className={`fx-skeleton fx-skeleton-${kind}`} aria-busy="true" role="status" aria-label="جاري التحميل" data-paused={!visible || undefined}>
    <span className="sr-only">جاري التحميل…</span>
    {Array.from({ length: kind === 'cards' ? 4 : rows }, (_, i) => <div className="fx-skeleton-row" key={i} aria-hidden="true">
      {kind === 'list' && <i className="fx-skeleton-avatar" />}
      <div className="fx-skeleton-lines">{Array.from({ length: kind === 'table' ? cols : 2 }, (_, j) => <i key={j} />)}</div>
    </div>)}
  </div>
}
