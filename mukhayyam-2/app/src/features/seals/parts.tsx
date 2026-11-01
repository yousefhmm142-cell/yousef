import { NavLink } from 'react-router'
import { clock12 } from '../../lib/format'
import { Pill } from '../../ui/primitives'
import { sealStatusInfo, type Seal, type SealGroup, type SealStatus } from './model'

/** The two seals pages, one switch. */
export function SealsTabs({ canIssue = true }: { canIssue?: boolean }) {
  if (!canIssue) return null
  return (
    <nav className="seals-tabs" aria-label="صفحات الأختام">
      <NavLink to="/seals" end>صرف الأختام</NavLink>
      <NavLink to="/seals/log">سجل الأختام والبحث</NavLink>
    </nav>
  )
}

/** A seal number coloured by what happened to it. */
export function SealPill({ seal, hit, dim, onClick }: { seal: Seal; hit?: boolean; dim?: boolean; onClick?(): void }) {
  const info = sealStatusInfo[seal.status]
  const content = (
    <>
      <i aria-hidden="true" />
      <span className="num">{seal.sealNo}</span>
    </>
  )
  const title = `${seal.sealNo} · ${info.label}${seal.details ? ` · ${seal.details}` : ''}`
  return onClick ? (
    <button type="button" className="seal-pill" data-status={seal.status} data-hit={hit || undefined} data-dim={dim || undefined} title={title} onClick={onClick}>{content}</button>
  ) : (
    <span className="seal-pill" data-status={seal.status} data-hit={hit || undefined} data-dim={dim || undefined} title={title}>{content}</span>
  )
}

/** Seals left in stock, used, handed out... as one stacked bar. */
export function StackBar({ parts }: { parts: Array<{ status: SealStatus | 'bad'; n: number }> }) {
  const total = parts.reduce((s, p) => s + p.n, 0) || 1
  return (
    <div className="stackbar" role="img" aria-label={parts.map((p) => `${p.n}`).join(' / ')}>
      {parts.filter((p) => p.n > 0).map((p) => (
        <span key={p.status} data-status={p.status} style={{ flexGrow: p.n / total }} />
      ))}
    </div>
  )
}

export const dayLabel = (iso: string | null) => (iso ? new Intl.DateTimeFormat('ar-EG-u-nu-latn-ca-gregory', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`)) : '—')

export function StatusPill({ status }: { status: SealStatus }) {
  const i = sealStatusInfo[status]
  return <Pill tone={i.tone}>{i.label}</Pill>
}

export const groupTitle = (g: SealGroup, ordinal: (n: number) => string) => (g.batch ? `الدفعة ${ordinal(g.batch.batchNo)}` : 'في المخزن')

export { clock12 }
