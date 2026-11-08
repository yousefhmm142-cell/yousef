import { useLiveQuery } from 'dexie-react-hooks'
import { Check, CheckCircle2, ChevronDown, CloudOff, Download, FileUp, Gauge, Lock, MoreHorizontal, Printer, RefreshCw, Search, Trash2, Unlock } from 'lucide-react'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useEmployee } from '../../auth/AuthProvider'
import { getActions, onActionsSent } from '../../data/actions'
import { db } from '../../data/db'
import { toLatinDigits } from '../../lib/phone'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { saveFile } from '../../lib/saveFile'
import { useOnline } from '../../lib/useOnline'
import { useConfirm } from '../../ui/Confirm'
import { Dialog } from '../../ui/Dialog'
import { Button, Pill } from '../../ui/primitives'
import { fold } from '../tasks/subscribers'
import { exportReadings, readReadingsFile, type ReadFile } from './excel'
import { BIG_USE, cleanReading, isDone, parseCode, parseReading, sortRows, STATES, stateLabel, summarizeAreas, type ReadingBatch, type ReadingRow, type ReadingState } from './model'
import {
  assignArea, batchSaved, batchSource, createBatch, deleteBatch, flushReadings, listBatches, loadBatchRows, moveBoard, myReadingsSaved, refreshMyReadings, saveReading, setBatchStatus,
} from './repo'

const say = (text: string, tone: 'ok' | 'danger' = 'ok') => window.dispatchEvent(new CustomEvent('m2-toast', { detail: { text, tone } }))
const fmt = (v: number | null) => (v === null ? '—' : String(Math.round(v * 10) / 10))

/** «القراءات»: the office runs the week; a reader (technician) types his readings, with or without internet. */
export function ReadingsPage() {
  useDocumentTitle('القراءات')
  const me = useEmployee()
  const admin = me.role === 'admin' || me.role === 'manager' || !!me.pages?.includes('readings-admin')
  return admin ? <AdminReadings /> : <ReaderReadings />
}

// ---------- «جاري المزامنة» ----------
function useWaitingReadings(): number {
  return useLiveQuery(async () => (await getActions()).filter((a) => a.table === 'reading_rows').length, []) ?? 0
}

function SyncBanner() {
  const online = useOnline()
  const waiting = useWaitingReadings()
  const [justSent, setJustSent] = useState(false)
  const before = useRef(waiting)
  useEffect(() => {
    if (before.current > 0 && waiting === 0 && online) {
      setJustSent(true)
      const t = window.setTimeout(() => setJustSent(false), 3500)
      before.current = waiting
      return () => window.clearTimeout(t)
    }
    before.current = waiting
  }, [waiting, online])
  useEffect(() => { if (online && waiting) void flushReadings() }, [online, waiting])

  if (waiting && online) return <p className="rd-sync busy" role="status"><RefreshCw size={16} className="spin" /> جاري المزامنة… <b className="num">{waiting}</b></p>
  if (waiting) return <p className="rd-sync off" role="status"><CloudOff size={16} /> بدون إنترنت · <b className="num">{waiting}</b> {waiting === 1 ? 'قراءة محفوظة' : 'قراءات محفوظة'} على جهازك، وبتنرسل لحالها لما يرجع النت</p>
  if (justSent) return <p className="rd-sync ok" role="status"><CheckCircle2 size={16} /> تمت المزامنة · كل القراءات وصلت</p>
  if (!online) return <p className="rd-sync off" role="status"><CloudOff size={16} /> بدون إنترنت · اشتغل عادي، كل قراءة بتنحفظ على جهازك</p>
  return null
}

// ---------- The list: one big box per subscriber ----------
type Saver = (row: ReadingRow, v: { reading: number | null; state: ReadingState | null; note: string | null }) => Promise<void>

function ReadingList({ rows, onSave, showPhone = false }: { rows: ReadingRow[]; onSave: Saver; showPhone?: boolean }) {
  const [onlyLeft, setOnlyLeft] = useState(true)
  const [q, setQ] = useState('')
  // Rows done while the list is open stay where they are (nothing jumps under the finger).
  const [touched, setTouched] = useState<Set<string>>(() => new Set())
  const done = rows.filter(isDone).length
  const visible = useMemo(() => {
    const words = fold(toLatinDigits(q)).split(' ').filter(Boolean)
    return sortRows(rows).filter((r) => {
      if (onlyLeft && isDone(r) && !touched.has(r.id)) return false
      if (!words.length) return true
      const hay = fold(`${r.subscriber} ${r.board} ${r.code} ${r.fak ?? ''}`)
      return words.every((w) => hay.includes(w))
    })
  }, [rows, onlyLeft, q, touched])
  const listRef = useRef<HTMLDivElement>(null)
  const save: Saver = async (row, v) => {
    setTouched((t) => new Set(t).add(row.id))
    await onSave(row, v)
  }
  const pct = rows.length ? Math.round((done / rows.length) * 100) : 0

  let lastBoard = ''
  let lastArea = ''
  const manyAreas = new Set(rows.map((r) => r.area)).size > 1
  return (
    <>
      <section className="card rd-head">
        <div className="rd-count">
          <b className="num">{rows.length - done}</b>
          <span>{rows.length - done === 0 ? 'خلصت كل القراءات 👏' : `باقي من ${rows.length}`}</span>
        </div>
        <div className="rd-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="المنجز"><i style={{ width: `${pct}%` }} /></div>
        <div className="rd-tools">
          <div className="rd-seg" role="group" aria-label="العرض">
            <button type="button" aria-pressed={onlyLeft} onClick={() => { setOnlyLeft(true); setTouched(new Set()) }}>الباقي</button>
            <button type="button" aria-pressed={!onlyLeft} onClick={() => setOnlyLeft(false)}>الكل <span className="num">{rows.length}</span></button>
          </div>
          <label className="rd-search"><Search size={16} /><input type="search" placeholder="ابحث بالاسم أو الطبلون" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        </div>
      </section>

      <div className="rd-list" ref={listRef}>
        {visible.length === 0 && <p className="card card-empty">{q ? 'ما في نتائج للبحث.' : 'ما في قراءات باقية هون.'}</p>}
        {visible.map((r) => {
          const area = r.area !== lastArea ? r.area : null
          const board = r.board !== lastBoard || area ? r.board : null
          lastArea = r.area
          lastBoard = r.board
          return (
            <Fragment key={r.id}>
              {area && manyAreas && <h2 className="rd-area">{area}</h2>}
              {board && <h3 className="rd-board">طبلون {board}<span className="num">{rows.filter((x) => x.board === board && isDone(x)).length}/{rows.filter((x) => x.board === board).length}</span></h3>}
              <ReadingLine row={r} onSave={save} listRef={listRef} showPhone={showPhone} />
            </Fragment>
          )
        })}
      </div>
    </>
  )
}

function focusNext(listRef: React.RefObject<HTMLDivElement | null>, from: HTMLInputElement) {
  const boxes = [...(listRef.current?.querySelectorAll<HTMLInputElement>('input.rd-input') ?? [])]
  const i = boxes.indexOf(from)
  const next = boxes.slice(i + 1).find((b) => !b.value) ?? boxes[i + 1]
  if (next) { next.focus({ preventScroll: true }); next.scrollIntoView({ block: 'center', behavior: 'smooth' }) }
  else from.blur()
}

function ReadingLine({ row, onSave, listRef, showPhone }: { row: ReadingRow; onSave: Saver; listRef: React.RefObject<HTMLDivElement | null>; showPhone: boolean }) {
  const shown = row.reading === null ? '' : String(row.reading)
  const [draft, setDraft] = useState(shown)
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState(row.note ?? '')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { setDraft(row.reading === null ? '' : String(row.reading)) }, [row.reading])
  const value = parseReading(draft)
  const use = value !== null && row.prev !== null ? Math.round((value - row.prev) * 10) / 10 : null
  const seq = parseCode(row.code).seq

  async function commit(): Promise<boolean> {
    const v = parseReading(draft)
    if (v === row.reading) { setError(null); return true }
    if (v !== null && row.prev !== null && v < row.prev) { setError(`أقل من السابقة (${fmt(row.prev)})`); return false }
    setError(null)
    await onSave(row, { reading: v, state: v === null ? row.state : null, note: row.note })
    return true
  }
  async function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const box = e.currentTarget
    if (await commit()) focusNext(listRef, box)
  }
  async function pick(state: ReadingState | null) {
    setDraft('')
    setError(null)
    await onSave(row, { reading: null, state, note: state === 'other' ? note : null })
    if (state !== 'other') setOpen(false)
  }

  return (
    <div className={`rd-row${isDone(row) ? ' done' : ''}${error ? ' bad' : ''}`}>
      <div className="rd-who">
        <b>{row.subscriber || '—'}</b>
        <small>
          {seq !== null && <span className="num">#{seq}</span>}
          {row.fak && <span className="num">({row.fak})</span>}
          {showPhone && row.phone && <span className="num ltr">{row.phone}</span>}
          <span>السابقة <b className="num">{fmt(row.prev)}</b></span>
        </small>
      </div>
      <div className="rd-entry">
        {row.state ? (
          <button type="button" className="rd-state" onClick={() => setOpen((o) => !o)}>{stateLabel(row.state)}</button>
        ) : (
          <input
            className="rd-input num"
            inputMode="decimal"
            enterKeyHint="next"
            autoComplete="off"
            aria-label={`قراءة ${row.subscriber}`}
            placeholder="القراءة"
            value={draft}
            onChange={(e) => { setDraft(cleanReading(e.target.value)); setError(null) }}
            onKeyDown={(e) => void onKey(e)}
            onBlur={() => void commit()}
          />
        )}
        <button type="button" className="rd-more" aria-label="حالة أخرى" aria-expanded={open} onClick={() => setOpen((o) => !o)}><MoreHorizontal size={18} /></button>
      </div>
      {(error || use !== null) && (
        <p className={`rd-use${error ? ' err' : use !== null && use > BIG_USE ? ' warn' : ''}`}>
          {error ?? (use !== null && use > BIG_USE ? `استهلاك كبير: ${use} · تأكد من القراءة` : `الاستهلاك ${use}`)}
        </p>
      )}
      {open && (
        <div className="rd-states">
          {STATES.map((s) => (
            <button key={s.value} type="button" aria-pressed={row.state === s.value} onClick={() => void pick(s.value)}>{s.label}</button>
          ))}
          {row.state && <button type="button" onClick={() => void pick(null)}>رجوع للقراءة</button>}
          {row.state === 'other' && (
            <input className="input" placeholder="شو المشكلة؟" value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== (row.note ?? '') && void onSave(row, { reading: null, state: 'other', note })} />
          )}
        </div>
      )}
    </div>
  )
}

// ---------- The reader ----------
function ReaderReadings() {
  const me = useEmployee()
  const online = useOnline()
  const [data, setData] = useState<{ batches: ReadingBatch[]; rows: ReadingRow[] } | null>(null)
  const [batchId, setBatchId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const fresh = await refreshMyReadings(me.id)
    if (fresh) setData(fresh)
  }, [me.id])
  useEffect(() => {
    let live = true
    void myReadingsSaved(me.id).then((d) => live && setData((x) => x ?? d))
    void load()
    const off = onActionsSent(load)
    return () => { live = false; off() }
  }, [me.id, load])
  useEffect(() => { if (online) void load() }, [online, load])

  const batch = data?.batches.find((b) => b.id === batchId) ?? data?.batches[0]
  const rows = useMemo(() => (data && batch ? data.rows.filter((r) => r.batchId === batch.id) : []), [data, batch])

  const onSave: Saver = async (row, v) => {
    const patch = await saveReading(row, v, { me: me.id })
    setData((d) => d && { ...d, rows: d.rows.map((r) => (r.id === row.id ? { ...r, ...patch, enteredAt: new Date().toISOString() } : r)) })
  }

  return (
    <div className="report-page readings">
      <header className="ph">
        <div>
          <h1>القراءات</h1>
          <p className="muted">{batch ? batch.title : 'قراءات العدادات الأسبوعية'}</p>
        </div>
        {data && data.batches.length > 1 && (
          <select className="select" aria-label="الأسبوع" value={batch?.id} onChange={(e) => setBatchId(e.target.value)}>
            {data.batches.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
          </select>
        )}
      </header>
      <SyncBanner />
      {!data ? <div className="loading-block" aria-busy="true" />
        : !batch ? <p className="card card-empty">ما في قراءات عليك هالأسبوع. لما يوزّع مسؤول القراءات المناطق بتظهر هون.</p>
        : <ReadingList rows={rows} onSave={onSave} />}
    </div>
  )
}

// ---------- The office ----------
function AdminReadings() {
  const me = useEmployee()
  const online = useOnline()
  const confirm = useConfirm()
  const [batches, setBatches] = useState<ReadingBatch[] | null>(null)
  const [batchId, setBatchId] = useState<string | null>(null)
  const [rows, setRows] = useState<ReadingRow[] | null>(null)
  const [upload, setUpload] = useState<{ file: ReadFile; name: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [openArea, setOpenArea] = useState<string | null>(null)
  const [printArea, setPrintArea] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const people = useLiveQuery(async () => (await db.employees.toArray()).filter((e) => e.isActive && !e.deletedAt && (e.role === 'technician' || e.pages?.includes('readings'))).sort((a, b) => a.fullName.localeCompare(b.fullName, 'ar')), []) ?? []

  const loadBatches = useCallback(async () => {
    try {
      const list = await listBatches()
      setBatches(list)
      setBatchId((id) => id ?? list[0]?.id ?? null)
    } catch {
      setBatches((b) => b ?? [])
    }
  }, [])
  const loadRows = useCallback(async (id: string) => {
    const saved = await batchSaved(id)
    if (saved) setRows(saved)
    try { setRows(await loadBatchRows(id)) } catch { if (!saved) setRows([]) }
  }, [])
  useEffect(() => { void loadBatches() }, [loadBatches, online])
  useEffect(() => { setRows(null); if (batchId) void loadRows(batchId) }, [batchId, loadRows])
  useEffect(() => onActionsSent(() => batchId && loadRows(batchId)), [batchId, loadRows])

  const batch = batches?.find((b) => b.id === batchId) ?? null
  const areas = useMemo(() => (rows ? summarizeAreas(rows) : []), [rows])
  const done = rows?.filter(isDone).length ?? 0

  async function pickFile(f: File | undefined) {
    if (!f) return
    setBusy('read')
    try {
      setUpload({ file: await readReadingsFile(f), name: f.name })
    } catch {
      say('ما قدرت أقرأ الملف. لازم يكون ملف Excel الأسبوعي من الشركة (xlsx).', 'danger')
    } finally {
      setBusy(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function run(key: string, job: () => Promise<unknown>, ok?: string) {
    setBusy(key)
    try {
      await job()
      if (ok) say(ok)
    } catch {
      say(navigator.onLine ? 'ما زبطت، جرّب مرة ثانية.' : 'هاي بدها إنترنت.', 'danger')
    } finally {
      setBusy(null)
    }
  }

  async function exportFile() {
    if (!batch || !rows) return
    await run('export', async () => {
      const src = await batchSource(batch.id)
      const blob = await exportReadings(src.source, src.sheetName, src.col, rows)
      await saveFile(blob, (src.fileName ?? 'القراءات.xlsx').replace(/\.xls[xm]?$/i, '') + ' - معبأ.xlsx', blob.type)
    })
  }

  const onSave: Saver = async (row, v) => {
    const patch = await saveReading(row, v, { batch: row.batchId })
    setRows((rs) => rs && rs.map((r) => (r.id === row.id ? { ...r, ...patch, enteredAt: new Date().toISOString() } : r)))
  }

  const printRows = printArea ? sortRows((rows ?? []).filter((r) => r.area === printArea)) : []

  return (
    <div className="report-page readings">
      <header className="ph">
        <div>
          <h1>القراءات</h1>
          <p className="muted">ارفع ملف الأسبوع، وزّع المناطق على الفنيين أو الورق، وبالآخر صدّر الملف للشركة معبّأ.</p>
        </div>
        <div className="ph-actions">
          <input ref={fileRef} type="file" accept=".xlsx,.xlsm" hidden onChange={(e) => void pickFile(e.target.files?.[0])} />
          <Button variant="primary" icon={<FileUp size={18} />} busy={busy === 'read'} disabled={!online} onClick={() => fileRef.current?.click()}>رفع ملف الأسبوع</Button>
        </div>
      </header>
      <SyncBanner />

      {batches && batches.length > 0 && (
        <div className="rd-batches" role="tablist" aria-label="الأسابيع">
          {batches.map((b) => (
            <button key={b.id} type="button" role="tab" aria-selected={b.id === batchId} onClick={() => { setBatchId(b.id); setOpenArea(null) }}>
              <b>{b.title}</b>
              <small className="num">{new Date(b.createdAt).toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'short' })}{b.status === 'approved' ? ' · معتمد' : ''}</small>
            </button>
          ))}
        </div>
      )}

      {!batches ? <div className="loading-block" aria-busy="true" />
        : !batch ? <p className="card card-empty">ما في ولا أسبوع لسا. اضغط «رفع ملف الأسبوع» واختار ملف Excel اللي بتبعته الشركة.</p>
        : (
          <>
            <section className="card rd-summary">
              <div className="rd-count"><b className="num">{done}</b><span>من {rows?.length ?? '…'} قراءة</span></div>
              <div className="rd-bar"><i style={{ width: `${rows?.length ? Math.round((done / rows.length) * 100) : 0}%` }} /></div>
              <div className="rd-actions">
                <Pill tone={batch.status === 'approved' ? 'ok' : 'info'}>{batch.status === 'approved' ? 'معتمد' : 'مفتوح'}</Pill>
                <Button icon={<Download size={17} />} busy={busy === 'export'} disabled={!online || !rows} onClick={() => void exportFile()}>تصدير ملف الشركة</Button>
                {batch.status === 'open'
                  ? <Button icon={<Lock size={17} />} busy={busy === 'status'} disabled={!online} onClick={async () => { if (await confirm({ title: 'اعتماد قراءات الأسبوع؟', message: done < (rows?.length ?? 0) ? `في ${(rows?.length ?? 0) - done} مشترك بدون قراءة.` : 'بعد الاعتماد ما حدا من الفنيين بيقدر يعدّل.' })) void run('status', async () => { await setBatchStatus(batch.id, 'approved'); await loadBatches() }, 'انعتمد الأسبوع') }}>اعتماد</Button>
                  : <Button icon={<Unlock size={17} />} busy={busy === 'status'} disabled={!online} onClick={() => void run('status', async () => { await setBatchStatus(batch.id, 'open'); await loadBatches() }, 'انفتح الأسبوع للتعديل')}>إعادة فتح</Button>}
                <Button variant="ghost" icon={<Trash2 size={17} />} disabled={!online || busy !== null} onClick={async () => { if (await confirm({ title: `حذف «${batch.title}»؟`, message: 'بتنحذف كل قراءاته. ما في رجوع.', danger: true, confirmLabel: 'حذف' })) void run('del', async () => { await deleteBatch(batch.id); setBatchId(null); setRows(null); await loadBatches() }, 'انحذف') }}>حذف</Button>
              </div>
            </section>

            {!rows ? <div className="loading-block" aria-busy="true" /> : (
              <div className="rd-areas">
                {areas.map((a) => {
                  const pct = Math.round((a.done / a.total) * 100)
                  const value = a.mixed ? '' : a.mode === 'paper' ? 'paper' : a.mode === 'app' && a.assigneeId ? a.assigneeId : ''
                  const isOpen = openArea === a.area
                  const person = people.find((p) => p.id === a.assigneeId)
                  return (
                    <section key={a.area} className={`card rd-area-card${isOpen ? ' open' : ''}`}>
                      <div className="rd-area-h">
                        <button type="button" className="rd-area-name" aria-expanded={isOpen} onClick={() => setOpenArea(isOpen ? null : a.area)}>
                          <span className="ico-round brand"><Gauge size={16} /></span>
                          <span><b>{a.area}</b><small>{a.boards.length} {a.boards.length === 1 ? 'طبلون' : 'طبالين'} · <span className="num">{a.total}</span> مشترك</small></span>
                          <ChevronDown size={18} className="chev" />
                        </button>
                        <div className="rd-area-prog"><span className="num">{a.done}/{a.total}</span><div className="rd-bar sm"><i style={{ width: `${pct}%` }} /></div></div>
                        <select
                          className="select"
                          aria-label={`مين يقرأ ${a.area}`}
                          value={value}
                          disabled={!online || batch.status === 'approved' || busy === `as-${a.area}`}
                          onChange={(e) => {
                            const v = e.target.value
                            void run(`as-${a.area}`, async () => {
                              await assignArea(batch.id, a.area, v === '' ? null : v === 'paper' ? 'paper' : 'app', v && v !== 'paper' ? v : null)
                              await loadRows(batch.id)
                            })
                          }}
                        >
                          <option value="">{a.mixed ? 'مقسومة…' : 'لمين؟'}</option>
                          <option value="paper">ورق (بتنعبى من المكتب)</option>
                          {people.map((p) => <option key={p.id} value={p.id}>{p.fullName}{p.pages?.includes('readings') ? '' : ' (بدها صلاحية القراءات)'}</option>)}
                        </select>
                      </div>
                      {person && !person.pages?.includes('readings') && <p className="rd-warn">{person.fullName} ما عنده صفحة «القراءات»: افتحها له من الإعدادات › الصلاحيات عشان يشوف المنطقة على جواله.</p>}
                      {isOpen && (
                        <div className="rd-area-body">
                          <div className="rd-area-tools">
                            <Button icon={<Printer size={16} />} onClick={() => { setPrintArea(a.area); setTimeout(() => window.print(), 50) }}>طباعة ورقة المنطقة</Button>
                            <label className="rd-move">
                              <span>نقل طبلون لمنطقة ثانية:</span>
                              <select className="select" defaultValue="" disabled={!online} onChange={(e) => {
                                const board = e.target.value
                                e.target.value = ''
                                if (!board) return
                                const to = window.prompt(`طبلون ${board} لأي منطقة؟`, a.area)?.trim()
                                if (to && to !== a.area) void run('move', async () => { await moveBoard(batch.id, board, to); await loadRows(batch.id) }, `انتقل طبلون ${board} لمنطقة ${to}`)
                              }}>
                                <option value="">اختار الطبلون</option>
                                {a.boards.map((b) => <option key={b} value={b}>{b}</option>)}
                              </select>
                            </label>
                          </div>
                          <ReadingList rows={rows.filter((r) => r.area === a.area)} onSave={onSave} showPhone />
                        </div>
                      )}
                    </section>
                  )
                })}
              </div>
            )}
          </>
        )}

      {printArea && (
        <div className="print-sheet rd-print" aria-hidden="true">
          <header className="ps-head">
            <img src="/logo.webp" alt="" className="ps-logo" />
            <div className="ps-title"><b>القراءات الأسبوعية · {printArea}</b><span>{batch?.title}</span></div>
            <div className="ps-date">القارئ: ............</div>
          </header>
          {[...new Set(printRows.map((r) => r.board))].map((b) => (
            <Fragment key={b}>
              <h2>طبلون {b}</h2>
              <table>
                <thead><tr><th>#</th><th className="wide">الاسم</th><th>الجوال</th><th>السابقة</th><th>الحالية</th><th>ملاحظة</th></tr></thead>
                <tbody>
                  {printRows.filter((r) => r.board === b).map((r) => (
                    <tr key={r.id}><td>{parseCode(r.code).seq}{r.fak ? ` (${r.fak})` : ''}</td><td>{r.subscriber}</td><td>{r.phone}</td><td>{fmt(r.prev)}</td><td>{r.reading ?? ''}</td><td>{stateLabel(r.state)}</td></tr>
                  ))}
                </tbody>
              </table>
            </Fragment>
          ))}
        </div>
      )}

      {upload && (
        <UploadDialog
          upload={upload}
          onClose={() => setUpload(null)}
          onSave={async (title) => {
            setBusy('save')
            try {
              const id = await createBatch(upload.file, upload.name, title, me.id)
              setUpload(null)
              await loadBatches()
              setBatchId(id)
              say(`انحفظ الأسبوع: ${upload.file.rows.length} مشترك`)
            } catch {
              say('ما انحفظ. تأكد من الإنترنت وجرّب مرة ثانية.', 'danger')
            } finally {
              setBusy(null)
            }
          }}
          busy={busy === 'save'}
        />
      )}
    </div>
  )
}

function UploadDialog({ upload, onClose, onSave, busy }: { upload: { file: ReadFile; name: string }; onClose(): void; onSave(title: string): void; busy: boolean }) {
  const f = upload.file
  const today = new Date().toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'long' })
  const [title, setTitle] = useState(`${f.title.replace(/\s+/g, ' ').trim() || 'القراءات'} · أسبوع ${today}`)
  const areas = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const r of f.rows) m.set(r.area, (m.get(r.area) ?? new Set()).add(r.board))
    return [...m].map(([area, boards]) => ({ area, boards: [...boards], count: f.rows.filter((r) => r.area === area).length }))
  }, [f])
  return (
    <Dialog
      open
      onClose={onClose}
      title="ملف القراءات الجديد"
      subtitle={upload.name}
      footer={<><Button variant="ghost" onClick={onClose}>إلغاء</Button><Button variant="primary" icon={<Check size={18} />} busy={busy} disabled={!title.trim()} onClick={() => onSave(title.trim())}>حفظ الأسبوع</Button></>}
    >
      <div className="rd-upload">
        <label className="field"><span className="label">اسم الأسبوع</span><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <p className="rd-upload-n"><b className="num">{f.rows.length}</b> مشترك · <b className="num">{areas.length}</b> منطقة · <b className="num">{new Set(f.rows.map((r) => r.board)).size}</b> طبلون</p>
        {f.skipped.length > 0 && <p className="rd-warn">في {f.skipped.length} سطر ما قدرت أقرأ رقمه (السطور: {f.skipped.slice(0, 8).join('، ')}{f.skipped.length > 8 ? '…' : ''}). باقي الملف تمام.</p>}
        <ul className="rd-upload-areas">
          {areas.map((a) => <li key={a.area}><b>{a.area}</b><span className="num">{a.count}</span><small>{a.boards.join('، ')}</small></li>)}
        </ul>
        <p className="muted">الطبالين اللي أسماؤها متشابهة صارت منطقة وحدة (مثلاً «المقبرة» و«شمال المقبرة»). بتقدر تنقل أي طبلون لمنطقة ثانية بعد الحفظ.</p>
      </div>
    </Dialog>
  )
}
