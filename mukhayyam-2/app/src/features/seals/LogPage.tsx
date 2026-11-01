import { ArrowDownUp, FileSpreadsheet, Search, Stamp, X } from 'lucide-react'
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { isDemo } from '../../config'
import { todayISO } from '../../lib/dates'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { Chip, Segmented } from '../../ui/form'
import { Button } from '../../ui/primitives'
import { useToast } from '../../ui/Toast'
import { UseDialog } from './dialogs'
import { downloadUsageLog } from './excel'
import { hasQuery, noFilters, ordinalWord, searchSeals, totals, type GroupSort, type Seal, type SealData, type SearchFilters } from './model'
import { dayLabel, SealPill, SealsTabs, StatusPill } from './parts'
import { refreshSeals, useSealData, useSealsLive } from './repo'

const GROUP_LIMIT = 30
const TABLE_LIMIT = 300

type View = 'groups' | 'table'
const views = [
  { value: 'groups', label: 'مجموعات' },
  { value: 'table', label: 'جدول' },
] as const
const periods = [
  { value: 'all', label: 'الكل' },
  { value: 'today', label: 'اليوم' },
  { value: 'week', label: 'أسبوع' },
  { value: 'month', label: 'الشهر' },
] as const
const statuses: Array<{ value: SearchFilters['status']; label: string }> = [
  { value: null, label: 'الكل' },
  { value: 'open', label: 'عند الفنيين' },
  { value: 'used', label: 'مستخدم' },
  { value: 'damaged', label: 'تالف' },
  { value: 'lost', label: 'ضائع' },
  { value: 'in_stock', label: 'في المخزن' },
]
const sorts: Array<{ value: GroupSort; label: string }> = [
  { value: 'newest', label: 'الأحدث أولاً' },
  { value: 'oldest', label: 'الأقدم أولاً' },
  { value: 'seal', label: 'رقم الختم' },
  { value: 'technician', label: 'اسم الفني' },
]

/** Page 2: look up any seal (or a whole roll, a tableau, a technician) and record what became of it. */
export function SealLogPage() {
  useDocumentTitle('سجل الأختام')
  useSealsLive()
  const toast = useToast()
  const data = useSealData()
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<SearchFilters>(noFilters)
  const [sort, setSort] = useState<GroupSort>('newest')
  const [view, setView] = useState<View>('groups')
  const [limit, setLimit] = useState(GROUP_LIMIT)
  const [dialog, setDialog] = useState<{ seal?: Seal } | null>(null)
  const [exporting, setExporting] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const deferred = useDeferredValue(query)

  // «/» jumps to the search box from anywhere on the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !(e.target as HTMLElement).closest('input, textarea, select, dialog')) {
        e.preventDefault()
        input.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => setLimit(view === 'table' ? TABLE_LIMIT : GROUP_LIMIT), [deferred, filters, sort, view])

  const today = todayISO()
  const result = useMemo(() => (data ? searchSeals(data, deferred, filters, today, sort) : null), [data, deferred, filters, today, sort])
  const sum = useMemo(() => totals(data?.seals ?? []), [data?.seals])
  const techs = useMemo(() => {
    if (!data) return []
    const ids = new Set(data.seals.flatMap((s) => (s.technicianId ? [s.technicianId] : [])))
    return [...ids].map((id) => ({ id, name: data.names.get(id) ?? '—' })).sort((a, b) => a.name.localeCompare(b.name, 'ar'))
  }, [data])
  const [tableSort, setTableSort] = useState<{ key: 'no' | 'tech' | 'status' | 'date' | 'board'; dir: 1 | -1 }>({ key: 'no', dir: 1 })
  const rows = useMemo(() => {
    if (!result || !data || view !== 'table') return []
    const all = result.groups.flatMap((g) => g.seals.filter((s) => g.matched.has(s.sealNo)))
    const val = (s: Seal) =>
      tableSort.key === 'no' ? s.sealNo : tableSort.key === 'tech' ? data.names.get(s.technicianId ?? '') ?? '' : tableSort.key === 'status' ? s.status : tableSort.key === 'date' ? s.usedOn ?? s.issuedOn ?? '' : s.boardNo
    return all.sort((a, b) => {
      const x = val(a)
      const y = val(b)
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'ar', { numeric: true })) * tableSort.dir
    })
  }, [result, data, view, tableSort])

  if (isDemo) return <div className="empty card"><h3>الأختام تعمل على قاعدة البيانات الحقيقية</h3><p>هذه الصفحة غير متاحة في وضع التجربة.</p></div>
  if (!data || !result) return <div className="loading-block" aria-busy="true" />

  const active = hasQuery(query, filters)
  const set = (patch: Partial<SearchFilters>) => setFilters((f) => ({ ...f, ...patch }))

  async function exportExcel() {
    if (!data) return
    setExporting(true)
    try {
      await refreshSeals()
      await downloadUsageLog(data)
      toast('نُزّل ملف الاستخدام')
    } catch {
      toast('تعذّر تجهيز الملف', 'danger')
    }
    setExporting(false)
  }

  const sortHead = (key: typeof tableSort.key, label: string) => (
    <th key={key}>
      <button type="button" onClick={() => setTableSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }))}>
        {label}
        {tableSort.key === key && <ArrowDownUp size={12} />}
      </button>
    </th>
  )

  return (
    <div className="seals">
      <header className="ph">
        <div>
          <h1>سجل الأختام</h1>
          <p className="muted">ابحث برقم الختم أو أول أرقامه، أو الطبلون، أو الفني، أو المشترك، وسجّل ما صار لكل ختم.</p>
        </div>
        <div className="ph-actions">
          <Button variant="secondary" icon={<FileSpreadsheet size={17} />} busy={exporting} onClick={() => void exportExcel()}>تصدير Excel</Button>
          <Button variant="primary" icon={<Stamp size={17} />} onClick={() => setDialog({})}>تسجيل استخدام</Button>
        </div>
      </header>

      <SealsTabs />

      <div className="search-bar" role="search">
        <Search size={22} aria-hidden="true" />
        <input
          ref={input}
          type="search"
          inputMode="search"
          value={query}
          placeholder="رقم الختم أو أول أرقامه · طبلون 361 · اسم الفني · المشترك"
          aria-label="بحث في الأختام"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
        />
        {query ? (
          <button type="button" className="icon-btn" aria-label="مسح البحث" onClick={() => { setQuery(''); input.current?.focus() }}><X size={18} /></button>
        ) : (
          <kbd aria-hidden="true">/</kbd>
        )}
      </div>

      {!active && (
        <div className="search-hints">
          <span>جرّب:</span>
          {['1813', 'طبلون 361', 'WK206022', 'تالف'].map((h) => <button key={h} type="button" onClick={() => setQuery(h)}>{h}</button>)}
          <span className="muted">أول رقمين أو ثلاثة من الختم يعرضون الرول كله.</span>
        </div>
      )}

      <div className="filters">
        <select className="select" aria-label="الفني" value={filters.technicianId ?? ''} onChange={(e) => set({ technicianId: e.target.value || null })}>
          <option value="">كل الفنيين</option>
          {techs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select className="select" aria-label="الرول" value={filters.rollId ?? ''} onChange={(e) => set({ rollId: e.target.value || null })}>
          <option value="">كل الرولات</option>
          {data.rolls.map((r) => <option key={r.id} value={r.id}>{r.fromNo} - {r.toNo}</option>)}
        </select>
        <Segmented<SearchFilters['period']> label="الفترة" value={filters.period} options={periods} onChange={(p) => set({ period: p })} />
        <span className="grow" />
        <select className="select" aria-label="الفرز" value={sort} onChange={(e) => setSort(e.target.value as GroupSort)}>
          {sorts.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <Segmented<View> label="طريقة العرض" value={view} options={views} onChange={setView} />
      </div>
      <div className="chips" role="group" aria-label="حالة الختم">
        {statuses.map((s) => <Chip key={s.label} pressed={filters.status === s.value} onClick={() => set({ status: s.value })}>{s.label}</Chip>)}
      </div>

      <div className="result-line">
        <span>
          {active ? (
            <><b className="num">{result.matches}</b> ختم في <b className="num">{result.groups.length}</b> {view === 'groups' ? 'مجموعة' : 'مجموعات'}</>
          ) : (
            <>آخر الدفعات المصروفة · <span className="num">{sum.issued}</span> ختم عند الفنيين لم يُسجَّل استخدامها</>
          )}
        </span>
        {active && <Button variant="ghost" onClick={() => { setQuery(''); setFilters(noFilters) }}>مسح الكل</Button>}
      </div>

      {result.groups.length === 0 ? (
        <section className="empty card">
          <span className="halo"><Search size={28} /></span>
          <h3>{active ? 'ما لقيت شيء' : 'ما في أختام مصروفة بعد'}</h3>
          <p>{active ? 'جرّب رقماً أقصر (أول رقمين)، أو امسح الفلاتر.' : 'ابدأ من صفحة «صرف الأختام»، أو استورد ملفاتك القديمة.'}</p>
        </section>
      ) : view === 'groups' ? (
        <div className="group-list">
          {result.groups.slice(0, limit).map((g) => (
            <article key={g.key} className="group-card card">
              <div className="batch-head">
                <b>{g.batch ? `الدفعة ${ordinalWord(g.batch.batchNo)}` : 'في المخزن / تالف قبل الصرف'}</b>
                {g.technicianId && <span className="tech">{data.names.get(g.technicianId) ?? '—'}</span>}
                <span className="muted num">{g.roll.fromNo}–{g.roll.toNo}</span>
                <span className="grow" />
                <span className="muted">{g.batch ? `صُرفت ${dayLabel(g.batch.issuedOn)}` : `رول استُلم ${dayLabel(g.roll.receivedOn)}`}</span>
              </div>
              <div className="group-rows">
                {g.seals.filter((s) => s.status !== 'in_stock').map((s) => (
                  <SealRow key={s.sealNo} seal={s} hit={active && g.matched.has(s.sealNo)} dim={active && !g.matched.has(s.sealNo)} onOpen={() => setDialog({ seal: s })} />
                ))}
              </div>
              {g.seals.some((s) => s.status === 'in_stock') && (
                <div className="stock-strip">
                  <span className="muted">{g.seals.filter((s) => s.status === 'in_stock').length} ختم في المخزن</span>
                  <div className="batch-strip">
                    {g.seals.filter((s) => s.status === 'in_stock').slice(0, 120).map((s) => <SealPill key={s.sealNo} seal={s} hit={active && g.matched.has(s.sealNo)} />)}
                  </div>
                </div>
              )}
            </article>
          ))}
          {result.groups.length > limit && <Button variant="secondary" onClick={() => setLimit(limit + GROUP_LIMIT)}>عرض المزيد ({result.groups.length - limit})</Button>}
        </div>
      ) : (
        <section className="card" style={{ padding: 10, overflowX: 'auto' }}>
          <table className="seal-table">
            <thead>
              <tr>{sortHead('no', 'الختم')}{sortHead('tech', 'الفني')}{sortHead('status', 'الحالة')}{sortHead('date', 'التاريخ')}{sortHead('board', 'الطبلون')}<th>التفاصيل</th></tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((s) => (
                <tr key={s.sealNo} onClick={() => setDialog({ seal: s })}>
                  <td><SealPill seal={s} /></td>
                  <td>{data.names.get(s.technicianId ?? '') ?? '—'}</td>
                  <td><StatusPill status={s.status} /></td>
                  <td className="num">{dayLabel(s.usedOn ?? s.issuedOn)}</td>
                  <td className="num">{s.boardNo || '—'}</td>
                  <td>{s.details || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > limit && <Button variant="secondary" onClick={() => setLimit(limit + TABLE_LIMIT)}>عرض المزيد ({rows.length - limit})</Button>}
        </section>
      )}

      {dialog && <UseDialog key={dialog.seal?.sealNo ?? 'new'} data={data as SealData} seal={dialog.seal} onClose={() => setDialog(null)} />}
    </div>
  )
}

function SealRow({ seal, hit, dim, onOpen }: { seal: Seal; hit: boolean; dim: boolean; onOpen(): void }) {
  const canOpen = seal.technicianId !== null || seal.status !== 'in_stock'
  const Tag = canOpen ? 'button' : 'div'
  return (
    <Tag className="seal-row" data-dim={dim || undefined} {...(canOpen ? { type: 'button' as const, onClick: onOpen } : {})}>
      <SealPill seal={seal} hit={hit} />
      <StatusPill status={seal.status} />
      <span className="when num">{dayLabel(seal.usedOn ?? seal.issuedOn)}</span>
      <span className="what">
        {seal.boardNo && <span className="board-tag">طبلون {seal.boardNo}</span>}
        {seal.details ? seal.details.replace(/^طبلون(?:ات)?\s*(?:رقم\s*)?\S+\s*/, '') : seal.status === 'issued' ? <small>لم يُسجَّل استخدامه بعد، اضغط لتسجيله</small> : null}
      </span>
    </Tag>
  )
}
