import { NavLink } from 'react-router'
import { clock12 } from '../../lib/format'
import { Pill } from '../../ui/primitives'
import { Avatar } from '../../ui/primitives'
import { sealStatusInfo, type Seal, type SealData, type SealGroup, type SealStatus } from './model'

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

/** Shown while the seals are being read from the server for the first time on this device. */
export function SealsLoading() {
  return (
    <div className="seals-loading card" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <b>جاري تحميل الأختام…</b>
      <span className="muted">أول مرة على هذا الجهاز فقط، وبعدها تفتح الصفحة فوراً.</span>
      {!navigator.onLine && <span className="muted">لا يوجد اتصال بالإنترنت الآن.</span>}
    </div>
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

/**
 * The technicians as a vertical list at the side (laptops): tap one to see only theirs. Each shows
 * what is still with them, so the busy ones stand out.
 */
export function TechNav({ data, value, onChange }: { data: SealData; value: string | null; onChange(id: string | null): void }) {
  const rows = (() => {
    const by = new Map<string, { open: number; total: number }>()
    for (const s of data.seals) {
      if (!s.technicianId) continue
      const r = by.get(s.technicianId) ?? by.set(s.technicianId, { open: 0, total: 0 }).get(s.technicianId)!
      r.total++
      if (s.status === 'issued') r.open++
    }
    return [...by.entries()].map(([id, r]) => ({ id, name: data.names.get(id) ?? '—', ...r })).sort((a, b) => a.name.localeCompare(b.name, 'ar'))
  })()
  const all = rows.reduce((n, r) => n + r.open, 0)
  return (
    <nav className="tech-nav" aria-label="الفنيون">
      <button type="button" className="tech-item" aria-current={value === null ? 'true' : undefined} onClick={() => onChange(null)}>
        <span className="tech-dot all">الكل</span>
        <span className="tech-text"><b>كل الفنيين</b><small className="num">{all} عندهم لم تُستخدم</small></span>
      </button>
      {rows.map((r) => (
        <button key={r.id} type="button" className="tech-item" aria-current={value === r.id ? 'true' : undefined} onClick={() => onChange(value === r.id ? null : r.id)}>
          <Avatar name={r.name} size={34} />
          <span className="tech-text">
            <b>{r.name}</b>
            <small className="num">{r.open ? `${r.open} عنده الآن` : 'لا شيء عنده'} · {r.total} ختم</small>
          </span>
          {r.open > 0 && <span className="tech-badge num">{r.open}</span>}
        </button>
      ))}
    </nav>
  )
}
